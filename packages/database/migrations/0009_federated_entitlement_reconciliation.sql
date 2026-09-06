-- Edutex production schema - reconcile directory-managed entitlements at every federated sign-in.

create or replace function app.establish_identity_session(
  target_tenant_id uuid,
  cognito_subject_value text,
  verified_email citext,
  display_name_value text,
  provider_key_value text,
  identity_claims jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  matched_user app.users%rowtype;
  mapped_category text;
  mapped_role record;
  permission_values text[];
  role_values text[];
  campus_values uuid[];
begin
  if octet_length(coalesce(identity_claims, '{}'::jsonb)::text) > 65536 then
    raise exception 'Identity claim set is too large' using errcode = '22001';
  end if;
  if not exists (
    select 1 from app.tenants where id = target_tenant_id and status = 'active'
  ) then
    raise exception 'Tenant is not active' using errcode = '28000';
  end if;
  perform set_config('app.tenant_id', target_tenant_id::text, true);

  select * into matched_user
  from app.users
  where tenant_id = target_tenant_id
    and cognito_subject = cognito_subject_value
  limit 1;

  -- Every federated sign-in must still match an enabled, provider-scoped mapping. This prevents a
  -- mover from retaining directory-managed access merely because an Edutex user row already exists.
  if provider_key_value <> 'local' then
    select directory_role_mappings.user_category into mapped_category
    from app.directory_role_mappings
    join app.identity_providers
      on identity_providers.tenant_id = directory_role_mappings.tenant_id
     and identity_providers.id = directory_role_mappings.identity_provider_id
    where directory_role_mappings.tenant_id = target_tenant_id
      and identity_providers.provider_key = provider_key_value::public.citext
      and identity_providers.enabled
      and app.claim_contains(
        coalesce(identity_claims, '{}'::jsonb),
        directory_role_mappings.claim_name,
        directory_role_mappings.claim_value
      )
    order by directory_role_mappings.priority, directory_role_mappings.id
    limit 1;

    if mapped_category is null then
      raise exception 'No approved directory role mapping matched this identity'
        using errcode = '42501';
    end if;
  end if;

  if matched_user.id is null then
    -- Local users are provisioned explicitly; only an approved federated mapping may create a user.
    if provider_key_value = 'local' then
      raise exception 'Local user has not been provisioned' using errcode = '42501';
    end if;
    insert into app.users (
      tenant_id, cognito_subject, email, display_name, category, status, last_login_at
    ) values (
      target_tenant_id,
      cognito_subject_value,
      verified_email,
      left(display_name_value, 160),
      mapped_category,
      'active',
      clock_timestamp()
    )
    returning * into matched_user;
  end if;

  if matched_user.status <> 'active' then
    raise exception 'User account is not active' using errcode = '28000';
  end if;

  if provider_key_value <> 'local' then
    -- Null assigned_by is reserved for directory-managed grants. Explicit human grants retain the
    -- assigning user and are not silently removed by a provider claim change.
    delete from app.user_roles
    where user_roles.tenant_id = target_tenant_id
      and user_roles.user_id = matched_user.id
      and user_roles.assigned_by is null
      and not exists (
        select 1
        from app.directory_role_mappings
        join app.identity_providers
          on identity_providers.tenant_id = directory_role_mappings.tenant_id
         and identity_providers.id = directory_role_mappings.identity_provider_id
        where directory_role_mappings.tenant_id = target_tenant_id
          and identity_providers.provider_key = provider_key_value::public.citext
          and identity_providers.enabled
          and directory_role_mappings.role_id = user_roles.role_id
          and app.claim_contains(
            coalesce(identity_claims, '{}'::jsonb),
            directory_role_mappings.claim_name,
            directory_role_mappings.claim_value
          )
      );

    for mapped_role in
      select distinct directory_role_mappings.role_id
      from app.directory_role_mappings
      join app.identity_providers
        on identity_providers.tenant_id = directory_role_mappings.tenant_id
       and identity_providers.id = directory_role_mappings.identity_provider_id
      where directory_role_mappings.tenant_id = target_tenant_id
        and identity_providers.provider_key = provider_key_value::public.citext
        and identity_providers.enabled
        and app.claim_contains(
          coalesce(identity_claims, '{}'::jsonb),
          directory_role_mappings.claim_name,
          directory_role_mappings.claim_value
        )
    loop
      insert into app.user_roles (tenant_id, user_id, role_id, campus_id, assigned_by)
      values (target_tenant_id, matched_user.id, mapped_role.role_id, null, null)
      on conflict do nothing;
    end loop;

    update app.users
    set category = mapped_category,
        identity_version = identity_version + 1
    where tenant_id = target_tenant_id and id = matched_user.id;
  end if;

  perform set_config('app.user_id', matched_user.id::text, true);

  update app.users
  set last_login_at = clock_timestamp(),
      display_name = left(display_name_value, 160),
      email = verified_email
  where tenant_id = target_tenant_id and id = matched_user.id
  returning * into matched_user;

  select coalesce(array_agg(distinct roles.name order by roles.name), array[]::text[])
    into role_values
  from app.user_roles
  join app.roles
    on roles.tenant_id = user_roles.tenant_id and roles.id = user_roles.role_id
  where user_roles.tenant_id = target_tenant_id
    and user_roles.user_id = matched_user.id
    and user_roles.valid_from <= clock_timestamp()
    and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp());

  select coalesce(
    array_agg(distinct role_permissions.permission_key order by role_permissions.permission_key),
    array[]::text[]
  ) into permission_values
  from app.user_roles
  join app.role_permissions
    on role_permissions.tenant_id = user_roles.tenant_id
   and role_permissions.role_id = user_roles.role_id
  where user_roles.tenant_id = target_tenant_id
    and user_roles.user_id = matched_user.id
    and user_roles.valid_from <= clock_timestamp()
    and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp());

  select coalesce(
    array_agg(user_campuses.campus_id order by user_campuses.campus_id),
    array[]::uuid[]
  ) into campus_values
  from app.user_campuses
  where user_campuses.tenant_id = target_tenant_id
    and user_campuses.user_id = matched_user.id;

  if cardinality(permission_values) = 0 then
    raise exception 'User has no active Edutex permissions' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', matched_user.id,
    'tenantId', matched_user.tenant_id,
    'displayName', matched_user.display_name,
    'email', matched_user.email,
    'category', matched_user.category,
    'campusIds', campus_values,
    'roleNames', role_values,
    'permissions', permission_values,
    'identityVersion', matched_user.identity_version
  );
end
$$;

revoke all on function app.establish_identity_session(uuid, text, citext, text, text, jsonb)
  from public;
grant execute on function app.establish_identity_session(uuid, text, citext, text, text, jsonb)
  to edutex_app;
