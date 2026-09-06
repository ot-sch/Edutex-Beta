-- RC6: replay only corrected final function definitions for already deployed RC5 databases.


create or replace function audit.append_event(
  target_tenant_id uuid,
  target_actor_user_id uuid,
  event_action text,
  event_resource_type text,
  event_resource_id text,
  event_outcome text,
  event_before_state jsonb,
  event_after_state jsonb,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, audit, app
as $$
declare
  new_id uuid := gen_random_uuid();
  prior_hash bytea;
  calculated_hash bytea;
  event_time timestamptz := clock_timestamp();
begin
  if target_tenant_id is null then
    raise exception 'Audit event tenant is required';
  end if;
  if not app.has_permission('platform:manage') and (
    app.current_tenant_id() is null or target_tenant_id <> app.current_tenant_id()
  ) then
    raise exception 'Audit tenant mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text, 914583));
  select event_hash into prior_hash
  from audit.events
  where tenant_id = target_tenant_id
  order by sequence_number desc
  limit 1;

  calculated_hash := public.digest(
    coalesce(encode(prior_hash, 'hex'), '') || '|' ||
    new_id::text || '|' || event_time::text || '|' ||
    coalesce(target_actor_user_id::text, '') || '|' || event_action || '|' ||
    event_resource_type || '|' || coalesce(event_resource_id, '') || '|' ||
    event_outcome || '|' || coalesce(audit.redact_state(event_before_state)::text, '') || '|' ||
    coalesce(audit.redact_state(event_after_state)::text, '') || '|' ||
    coalesce(event_metadata, '{}'::jsonb)::text,
    'sha256'
  );

  insert into audit.events (
    id, tenant_id, occurred_at, actor_user_id, action, resource_type, resource_id,
    request_id, outcome, before_state, after_state, metadata, previous_hash, event_hash
  ) values (
    new_id, target_tenant_id, event_time, target_actor_user_id, event_action,
    event_resource_type, event_resource_id, app.current_request_id(), event_outcome,
    audit.redact_state(event_before_state), audit.redact_state(event_after_state),
    coalesce(event_metadata, '{}'::jsonb), prior_hash, calculated_hash
  );
  return new_id;
end
$$;

create or replace function app.resolve_public_tenant(requested_hostname text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'tenantId', tenants.id,
    'slug', tenants.slug,
    'name', tenants.display_name,
    'logoUrl', coalesce('/api/v1/public/branding/' || tenants.logo_file_id::text, '/auth/edutex-logo.png'),
    'primaryColour', tenants.primary_colour,
    'enabledMethods', to_jsonb(array_remove(array[
      case when authentication_policies.password_enabled then 'password' end,
      case when authentication_policies.passkey_enabled then 'passkey' end,
      case when authentication_policies.microsoft_enabled then 'microsoft' end,
      case when authentication_policies.google_enabled then 'google' end,
      case when authentication_policies.saml_enabled then 'saml' end
    ], null)),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', identity_providers.id,
        'type', identity_providers.provider_type,
        'key', identity_providers.provider_key,
        'displayName', identity_providers.display_name,
        'buttonLabel', identity_providers.button_label,
        'enabled', identity_providers.enabled
      ) order by identity_providers.display_name)
      from app.identity_providers
      where identity_providers.tenant_id = tenants.id
        and identity_providers.enabled
        and case identity_providers.provider_type
          when 'microsoft' then authentication_policies.microsoft_enabled
          when 'google' then authentication_policies.google_enabled
          when 'saml' then authentication_policies.saml_enabled
          else true
        end
    ), '[]'::jsonb),
    'maintenanceMessage', null
  )
  from app.tenant_domains
  join app.tenants on tenants.id = tenant_domains.tenant_id
  join app.authentication_policies on authentication_policies.tenant_id = tenants.id
  where tenant_domains.hostname = lower(trim(trailing '.' from requested_hostname))::public.citext
    and tenant_domains.verified_at is not null
    and tenants.status = 'active'
  limit 1
$$;

create or replace function app.resolve_public_branding(
  requested_hostname text,
  requested_file_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'storageBucket', files.storage_bucket,
    'storageKey', files.storage_key,
    'mediaType', files.media_type,
    'sizeBytes', files.size_bytes,
    'sha256Hex', encode(files.sha256, 'hex')
  )
  from app.tenant_domains
  join app.tenants on tenants.id = tenant_domains.tenant_id
  join app.files
    on files.tenant_id = tenants.id
   and files.id = tenants.logo_file_id
  where tenant_domains.hostname = lower(trim(trailing '.' from requested_hostname))::public.citext
    and tenant_domains.verified_at is not null
    and tenants.status = 'active'
    and tenants.logo_file_id = requested_file_id
    and files.purpose = 'tenant-logo'
    and files.scan_status = 'clean'
    and files.deleted_at is null
  limit 1
$$;

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
