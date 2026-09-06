-- Edutex production schema - narrowly scoped security-definer identity entry points.

create or replace function app.resolve_auth_runtime(target_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'tenantId', tenants.id,
    'tenantSlug', tenants.slug,
    'cognitoUserPoolId', tenants.cognito_user_pool_id,
    'cognitoClientId', tenants.cognito_client_id,
    'cognitoDomain', tenants.cognito_domain,
    'sessionIdleMinutes', authentication_policies.session_idle_minutes,
    'sessionAbsoluteHours', authentication_policies.session_absolute_hours,
    'stepUpMinutes', authentication_policies.step_up_minutes,
    'passwordEnabled', authentication_policies.password_enabled,
    'passkeyEnabled', authentication_policies.passkey_enabled,
    'totpMode', authentication_policies.totp_mode,
    'providers', coalesce((
      select jsonb_object_agg(identity_providers.provider_key, identity_providers.cognito_provider_name)
      from app.identity_providers
      where identity_providers.tenant_id = tenants.id
        and identity_providers.enabled
        and case identity_providers.provider_type
          when 'microsoft' then authentication_policies.microsoft_enabled
          when 'google' then authentication_policies.google_enabled
          when 'saml' then authentication_policies.saml_enabled
          else true
        end
    ), '{}'::jsonb)
  )
  from app.tenants
  join app.authentication_policies on authentication_policies.tenant_id = tenants.id
  where tenants.id = target_tenant_id
    and tenants.status = 'active'
    and tenants.cognito_user_pool_id is not null
    and tenants.cognito_client_id is not null
    and tenants.cognito_domain is not null
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

create or replace function app.claim_contains(
  claims jsonb,
  claim_name text,
  expected_value text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select case jsonb_typeof(claims -> claim_name)
    when 'array' then (claims -> claim_name) ? expected_value
    when 'string' then claims ->> claim_name = expected_value
    when 'number' then claims ->> claim_name = expected_value
    when 'boolean' then claims ->> claim_name = expected_value
    else false
  end
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

  if matched_user.id is null then
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
  end if;

  if matched_user.status <> 'active' then
    raise exception 'User account is not active' using errcode = '28000';
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

  select coalesce(array_agg(distinct role_permissions.permission_key order by role_permissions.permission_key), array[]::text[])
    into permission_values
  from app.user_roles
  join app.role_permissions
    on role_permissions.tenant_id = user_roles.tenant_id
   and role_permissions.role_id = user_roles.role_id
  where user_roles.tenant_id = target_tenant_id
    and user_roles.user_id = matched_user.id
    and user_roles.valid_from <= clock_timestamp()
    and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp());

  select coalesce(array_agg(user_campuses.campus_id order by user_campuses.campus_id), array[]::uuid[])
    into campus_values
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

create or replace function app.refresh_session_identity(
  target_tenant_id uuid,
  target_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select case when users.status = 'active' then jsonb_build_object(
    'id', users.id,
    'tenantId', users.tenant_id,
    'displayName', users.display_name,
    'email', users.email,
    'category', users.category,
    'campusIds', coalesce((
      select jsonb_agg(user_campuses.campus_id order by user_campuses.campus_id)
      from app.user_campuses
      where user_campuses.tenant_id = users.tenant_id
        and user_campuses.user_id = users.id
    ), '[]'::jsonb),
    'roleNames', coalesce((
      select jsonb_agg(distinct roles.name order by roles.name)
      from app.user_roles
      join app.roles on roles.tenant_id = user_roles.tenant_id and roles.id = user_roles.role_id
      where user_roles.tenant_id = users.tenant_id
        and user_roles.user_id = users.id
        and user_roles.valid_from <= clock_timestamp()
        and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp())
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(distinct role_permissions.permission_key order by role_permissions.permission_key)
      from app.user_roles
      join app.role_permissions
        on role_permissions.tenant_id = user_roles.tenant_id
       and role_permissions.role_id = user_roles.role_id
      where user_roles.tenant_id = users.tenant_id
        and user_roles.user_id = users.id
        and user_roles.valid_from <= clock_timestamp()
        and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp())
    ), '[]'::jsonb),
    'identityVersion', users.identity_version
  ) else null end
  from app.users
  where users.tenant_id = target_tenant_id and users.id = target_user_id
$$;

revoke all on function app.resolve_auth_runtime(uuid) from public;
revoke all on function app.resolve_public_branding(text, uuid) from public;
revoke all on function app.establish_identity_session(uuid, text, citext, text, text, jsonb) from public;
revoke all on function app.refresh_session_identity(uuid, uuid) from public;
grant execute on function app.resolve_auth_runtime(uuid) to edutex_app;
grant execute on function app.resolve_public_branding(text, uuid) to edutex_app;
grant execute on function app.establish_identity_session(uuid, text, citext, text, text, jsonb) to edutex_app;
grant execute on function app.refresh_session_identity(uuid, uuid) to edutex_app;
