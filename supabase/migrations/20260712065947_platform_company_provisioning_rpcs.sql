do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_COMPANY_PROVISIONING_MIGRATION_OWNER_INVALID';
  end if;

  if to_regclass('public.provisioning_operations') is null
     or to_regclass('private.auth_session_controls') is null
     or to_regprocedure('private.assert_auth_session(uuid,uuid)') is null
     or to_regclass('public.company_settings') is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_COMPANY_PROVISIONING_DEPENDENCY_INVALID';
  end if;
end
$$;

insert into private.rate_limit_policies (
  bucket,
  attempt_limit,
  window_seconds,
  block_seconds,
  clear_on_success
) values ('platform-company-create', 10, 3600, 3600, false);

create table private.brazil_timezone_allowlist (
  input_name text not null,
  canonical_name text not null,
  catalog_version integer not null,
  is_alias boolean not null,
  primary key (catalog_version, input_name),
  constraint brazil_timezone_allowlist_input_format check (
    char_length(input_name) between 1 and 255
    and input_name ~ '^[A-Za-z_]+(/[A-Za-z_]+)+$'
  ),
  constraint brazil_timezone_allowlist_canonical_format check (
    char_length(canonical_name) between 1 and 255
    and canonical_name ~ '^America/[A-Za-z_]+$'
  ),
  constraint brazil_timezone_allowlist_version_positive check (
    catalog_version > 0
  ),
  constraint brazil_timezone_allowlist_alias_consistency check (
    is_alias = (input_name <> canonical_name)
  )
);

alter table private.brazil_timezone_allowlist enable row level security;
alter table private.brazil_timezone_allowlist force row level security;

revoke all on private.brazil_timezone_allowlist
from public, anon, authenticated, service_role, axsys_bff;

insert into private.brazil_timezone_allowlist (
  input_name,
  canonical_name,
  catalog_version,
  is_alias
) values
  ('America/Araguaina','America/Araguaina',1,false),
  ('America/Bahia','America/Bahia',1,false),
  ('America/Belem','America/Belem',1,false),
  ('America/Boa_Vista','America/Boa_Vista',1,false),
  ('America/Campo_Grande','America/Campo_Grande',1,false),
  ('America/Cuiaba','America/Cuiaba',1,false),
  ('America/Fortaleza','America/Fortaleza',1,false),
  ('America/Maceio','America/Maceio',1,false),
  ('America/Manaus','America/Manaus',1,false),
  ('America/Noronha','America/Noronha',1,false),
  ('America/Porto_Velho','America/Porto_Velho',1,false),
  ('America/Recife','America/Recife',1,false),
  ('America/Rio_Branco','America/Rio_Branco',1,false),
  ('America/Santarem','America/Santarem',1,false),
  ('America/Sao_Paulo','America/Sao_Paulo',1,false),
  ('Brazil/Acre','America/Rio_Branco',1,true),
  ('Brazil/DeNoronha','America/Noronha',1,true),
  ('Brazil/East','America/Sao_Paulo',1,true),
  ('Brazil/West','America/Manaus',1,true);

create function private.resolve_brazil_timezone(
  p_timezone text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_catalog_version integer;
begin
  if p_timezone is null
     or char_length(p_timezone) not between 1 and 255
     or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z_]+)+$' then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_INVALID_TIMEZONE';
  end if;

  select pg_catalog.max(timezone.catalog_version)
  into v_catalog_version
  from private.brazil_timezone_allowlist timezone;

  select timezone.canonical_name
  into v_timezone
  from private.brazil_timezone_allowlist timezone
  where timezone.catalog_version = v_catalog_version
    and timezone.input_name = p_timezone;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_INVALID_TIMEZONE';
  end if;

  return v_timezone;
end;
$$;

create function private.assert_platform_provisioning_actor(
  p_actor_user_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or p_session_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);

  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PLATFORM_SESSION_INVALID';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join private.auth_session_controls control
      on control.user_id = profile.user_id
     and control.session_id = p_session_id
    where profile.user_id = p_actor_user_id
      and profile.is_active
      and not profile.must_change_password
      and control.state = 'active'::private.auth_session_state
      and control.revoked_at is null
      and control.absolute_expires_at > pg_catalog.clock_timestamp()
      and control.audit_scope = 'platform'::public.audit_scope
      and control.audit_company_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PLATFORM_SESSION_INVALID';
  end if;

  if not exists (
    select 1
    from public.platform_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'::public.platform_role
      and platform_role.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PLATFORM_REQUIRED';
  end if;

  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
end;
$$;

create function private.build_company_provisioning_result(
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'company', pg_catalog.jsonb_build_object(
      'id', company.id,
      'status', company.status::text
    ),
    'membership', pg_catalog.jsonb_build_object(
      'id', membership.id,
      'role', membership.role::text
    ),
    'modules', coalesce(
      (
        select pg_catalog.jsonb_agg(module.module::text order by module.module)
        from public.member_modules module
        where module.company_id = company.id
          and module.membership_id = membership.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.provisioning_operations operation
  join public.companies company on company.id = operation.company_id
  join public.company_memberships membership
    on membership.company_id = company.id
   and membership.user_id = operation.auth_user_id
   and membership.role = 'company_admin'::public.membership_role
  where operation.id = p_operation_id
    and operation.kind = 'company_first_admin'::public.provisioning_kind
    and operation.status = 'committed'::public.provisioning_status;

  if not found or v_result is null then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  return v_result;
end;
$$;

create function private.internal_reserve_company_provisioning(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_subject_email_hash text,
  p_correlation_id uuid
) returns public.provisioning_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_subject_email_hash is null
     or p_subject_email_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;

  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  insert into public.provisioning_operations (
    idempotency_key,
    request_hash,
    kind,
    actor_user_id,
    subject_email_hash,
    status,
    correlation_id
  ) values (
    p_idempotency_key,
    p_request_hash,
    'company_first_admin'::public.provisioning_kind,
    p_actor_user_id,
    p_subject_email_hash,
    'reserved'::public.provisioning_status,
    p_correlation_id
  )
  on conflict (actor_user_id, idempotency_key) do nothing
  returning * into v_operation;

  if not found then
    select operation.*
    into v_operation
    from public.provisioning_operations operation
    where operation.actor_user_id = p_actor_user_id
      and operation.idempotency_key = p_idempotency_key
    for update;

    if not found
       or v_operation.kind <> 'company_first_admin'::public.provisioning_kind
       or v_operation.request_hash <> p_request_hash
       or v_operation.subject_email_hash <> p_subject_email_hash then
      raise exception using
        errcode = 'P0001',
        message = 'AXSYS_IDEMPOTENCY_KEY_REUSED';
    end if;
  end if;

  return v_operation;
end;
$$;

create function private.internal_mark_provisioning_auth_created(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_auth_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
begin
  if p_operation_id is null
     or p_actor_user_id is null
     or p_session_id is null
     or p_auth_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;

  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  select operation.*
  into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
    and operation.kind = 'company_first_admin'::public.provisioning_kind
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  if v_operation.status = 'auth_created'::public.provisioning_status
     and v_operation.auth_user_id = p_auth_user_id then
    return;
  end if;

  if v_operation.status <> 'reserved'::public.provisioning_status
     or v_operation.auth_user_id is not null
     or v_operation.company_id is not null
     or v_operation.last_error_code is not null then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  perform 1
  from auth.users auth_user
  where auth_user.id = p_auth_user_id
  for key share;
  if not found
     or exists (
       select 1
       from public.profiles profile
       where profile.user_id = p_auth_user_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_AUTH_USER_INVALID';
  end if;

  update public.provisioning_operations operation
  set auth_user_id = p_auth_user_id,
      status = 'auth_created'::public.provisioning_status,
      updated_at = pg_catalog.clock_timestamp()
  where operation.id = v_operation.id
    and operation.status = 'reserved'::public.provisioning_status;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_PROVISIONING_TRANSITION_LOST';
  end if;
end;
$$;

create function private.internal_commit_company_provisioning(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_auth_user_id uuid,
  p_company_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_cnpj_normalized text,
  p_contact_email extensions.citext,
  p_contact_phone text,
  p_timezone text,
  p_admin_display_name text,
  p_admin_email extensions.citext,
  p_modules public.module_key[],
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
  v_membership_id uuid;
  v_timezone text;
  v_now timestamptz;
  v_result jsonb;
begin
  if p_operation_id is null
     or p_actor_user_id is null
     or p_session_id is null
     or p_auth_user_id is null
     or p_company_id is null
     or p_legal_name is null
     or p_legal_name <> pg_catalog.btrim(p_legal_name)
     or char_length(p_legal_name) not between 2 and 160
     or p_trade_name is null
     or p_trade_name <> pg_catalog.btrim(p_trade_name)
     or char_length(p_trade_name) not between 2 and 180
     or p_cnpj_normalized is null
     or p_cnpj_normalized !~ '^[0-9]{14}$'
     or p_contact_email is null
     or p_contact_email::text <> pg_catalog.lower(pg_catalog.btrim(p_contact_email::text))
     or char_length(p_contact_email::text) > 254
     or (
       p_contact_phone is not null
       and (
         p_contact_phone <> pg_catalog.btrim(p_contact_phone)
         or char_length(p_contact_phone) not between 8 and 32
       )
     )
     or p_admin_display_name is null
     or p_admin_display_name <> pg_catalog.btrim(p_admin_display_name)
     or char_length(p_admin_display_name) not between 2 and 120
     or p_admin_email is null
     or p_admin_email::text <> pg_catalog.lower(pg_catalog.btrim(p_admin_email::text))
     or char_length(p_admin_email::text) > 254
     or p_modules is null
     or pg_catalog.cardinality(p_modules) > 3
     or pg_catalog.array_position(p_modules, null) is not null
     or (
       select pg_catalog.count(distinct module)::integer
       from pg_catalog.unnest(p_modules) module
     ) <> pg_catalog.cardinality(p_modules)
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;

  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  select operation.*
  into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
    and operation.kind = 'company_first_admin'::public.provisioning_kind
  for update;

  if not found
     or v_operation.auth_user_id is distinct from p_auth_user_id then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  if v_operation.status = 'committed'::public.provisioning_status then
    if v_operation.company_id is null
       or v_operation.last_error_code is not null then
      raise exception using
        errcode = '23514',
        message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
    end if;
    return private.build_company_provisioning_result(v_operation.id);
  end if;

  if v_operation.status <> 'auth_created'::public.provisioning_status
     or v_operation.company_id is not null
     or v_operation.last_error_code is not null then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  perform 1
  from auth.users auth_user
  where auth_user.id = p_auth_user_id
    and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = p_admin_email::text
    and auth_user.email_confirmed_at is not null
    and (
      auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp()
    )
  for key share;
  if not found
     or exists (
       select 1 from public.profiles profile
       where profile.user_id = p_auth_user_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_AUTH_USER_INVALID';
  end if;

  v_timezone := private.resolve_brazil_timezone(p_timezone);
  v_now := pg_catalog.clock_timestamp();

  insert into public.companies (
    id,
    legal_name,
    trade_name,
    cnpj_normalized,
    contact_email,
    contact_phone,
    timezone,
    status,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_legal_name,
    p_trade_name,
    p_cnpj_normalized,
    p_contact_email,
    p_contact_phone,
    v_timezone,
    'active'::public.company_status,
    v_now,
    v_now
  );

  insert into public.profiles (
    user_id,
    email,
    display_name,
    preferred_theme,
    must_change_password,
    temporary_password_expires_at,
    password_changed_at,
    is_active,
    created_at,
    updated_at
  ) values (
    p_auth_user_id,
    p_admin_email,
    p_admin_display_name,
    'dark'::public.theme_preference,
    true,
    v_now + interval '24 hours',
    null,
    true,
    v_now,
    v_now
  );

  insert into public.company_memberships (
    company_id,
    user_id,
    role,
    status,
    created_by,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_auth_user_id,
    'company_admin'::public.membership_role,
    'active'::public.membership_status,
    p_actor_user_id,
    v_now,
    v_now
  ) returning id into v_membership_id;

  insert into public.member_modules (
    company_id,
    membership_id,
    module,
    granted_by,
    created_at
  )
  select p_company_id,
         v_membership_id,
         module,
         p_actor_user_id,
         v_now
  from pg_catalog.unnest(p_modules) module;

  insert into public.company_settings (
    company_id,
    updated_by,
    updated_at
  ) values (
    p_company_id,
    p_actor_user_id,
    v_now
  );

  update public.provisioning_operations operation
  set company_id = p_company_id,
      status = 'committed'::public.provisioning_status,
      last_error_code = null,
      updated_at = v_now
  where operation.id = v_operation.id
    and operation.status = 'auth_created'::public.provisioning_status
    and operation.auth_user_id = p_auth_user_id;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_PROVISIONING_TRANSITION_LOST';
  end if;

  insert into public.audit_events (
    scope,
    company_id,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    outcome,
    reason_code,
    correlation_id,
    metadata,
    occurred_at
  ) values (
    'platform'::public.audit_scope,
    null,
    p_actor_user_id,
    'company.created',
    'company',
    p_company_id,
    'success'::public.audit_outcome,
    null,
    v_operation.correlation_id,
    pg_catalog.jsonb_build_object(
      'firstAdminUserId', p_auth_user_id,
      'moduleCount', pg_catalog.cardinality(p_modules)
    ),
    v_now
  );

  v_result := private.build_company_provisioning_result(v_operation.id);
  return v_result;
end;
$$;

create function private.internal_mark_provisioning_compensation(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_status public.provisioning_status,
  p_error_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
begin
  if p_operation_id is null
     or p_actor_user_id is null
     or p_session_id is null
     or not (
       (
         p_status = 'compensated'::public.provisioning_status
         and p_error_code = 'DB_COMMIT_FAILED'
       )
       or (
         p_status = 'compensation_required'::public.provisioning_status
         and p_error_code = 'AUTH_DELETE_FAILED'
       )
     ) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_PROVISIONING_COMPENSATION_INVALID';
  end if;

  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  select operation.*
  into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
    and operation.kind = 'company_first_admin'::public.provisioning_kind
  for update;

  if not found
     or v_operation.company_id is not null
     or v_operation.status in (
       'committed'::public.provisioning_status,
       'failed'::public.provisioning_status
     ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  if v_operation.status = p_status
     and v_operation.last_error_code = p_error_code then
    return;
  end if;

  if (
    p_status = 'compensation_required'::public.provisioning_status
    and v_operation.status not in (
      'reserved'::public.provisioning_status,
      'auth_created'::public.provisioning_status
    )
  ) or (
    p_status = 'compensated'::public.provisioning_status
    and v_operation.status not in (
      'reserved'::public.provisioning_status,
      'auth_created'::public.provisioning_status,
      'compensation_required'::public.provisioning_status
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;

  update public.provisioning_operations operation
  set status = p_status,
      last_error_code = p_error_code,
      updated_at = pg_catalog.clock_timestamp()
  where operation.id = v_operation.id;
end;
$$;

revoke execute on function private.resolve_brazil_timezone(text),
  private.assert_platform_provisioning_actor(uuid,uuid),
  private.build_company_provisioning_result(uuid)
from public, anon, authenticated, service_role, axsys_bff;

revoke execute on function private.internal_reserve_company_provisioning(
  uuid,uuid,text,text,text,uuid
), private.internal_mark_provisioning_auth_created(
  uuid,uuid,uuid,uuid
), private.internal_commit_company_provisioning(
  uuid,uuid,uuid,uuid,uuid,text,text,text,extensions.citext,text,text,text,
  extensions.citext,public.module_key[],uuid
), private.internal_mark_provisioning_compensation(
  uuid,uuid,uuid,public.provisioning_status,text
)
from public, anon, authenticated, service_role, axsys_bff;

grant execute on function private.internal_reserve_company_provisioning(
  uuid,uuid,text,text,text,uuid
), private.internal_mark_provisioning_auth_created(
  uuid,uuid,uuid,uuid
), private.internal_commit_company_provisioning(
  uuid,uuid,uuid,uuid,uuid,text,text,text,extensions.citext,text,text,text,
  extensions.citext,public.module_key[],uuid
), private.internal_mark_provisioning_compensation(
  uuid,uuid,uuid,public.provisioning_status,text
)
to axsys_bff;

revoke create on schema public, extensions from axsys_bff;
grant usage on schema public, extensions to axsys_bff;

revoke usage on type public.module_key,
  public.provisioning_status
from public, anon, authenticated, service_role;
grant usage on type public.module_key,
  public.provisioning_status
to axsys_bff;
