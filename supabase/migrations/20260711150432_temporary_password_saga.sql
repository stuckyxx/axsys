do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_TEMPORARY_PASSWORD_MIGRATION_OWNER_INVALID';
  end if;

  if to_regnamespace('private') is null
     or (select nspowner from pg_namespace where nspname = 'private')
        <> 'postgres'::regrole then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PRIVATE_SCHEMA_OWNER_INVALID';
  end if;

  if exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace in (
        0,
        'public'::regnamespace,
        'private'::regnamespace
      )
      and defaults.defaclobjtype in ('r','S','f')
      and (
        grant_item.grantee = 0
        or grantee.rolname in (
          'anon','authenticated','service_role','axsys_bff'
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_DEFAULT_ACL_NOT_HARDENED';
  end if;

  if (
    select array_agg(function.proname order by function.proname)
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
  ) is distinct from array[
    'assert_auth_session',
    'clear_rate_limit',
    'consume_rate_limit',
    'fail_closed_login_session',
    'register_auth_session',
    'revoke_sessions_and_write_logout',
    'rotate_app_session_after_reauthentication',
    'write_authenticated_audit_event',
    'write_security_event'
  ]::name[] then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_BFF_BOUNDARY_PRECONDITION_INVALID';
  end if;
end
$$;

create type private.auth_password_operation_kind as enum (
  'temporary_password_reset',
  'temporary_password_change'
);
create type private.auth_password_operation_status as enum (
  'reserved',
  'auth_updated',
  'completed',
  'failed'
);

revoke all on type private.auth_password_operation_kind,
  private.auth_password_operation_status
  from public, anon, authenticated, service_role, axsys_bff;

create table private.auth_password_operations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  target_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  scope public.audit_scope not null,
  company_id uuid references public.companies(id) on delete restrict,
  kind private.auth_password_operation_kind not null,
  status private.auth_password_operation_status not null default 'reserved',
  correlation_id uuid not null,
  reason_code text,
  expires_at timestamptz not null,
  reserved_at timestamptz not null,
  auth_updated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint auth_password_operations_scope_company check (
    (scope = 'platform' and company_id is null)
    or (scope = 'tenant' and company_id is not null)
  ),
  constraint auth_password_operations_expiry_order check (
    expires_at > reserved_at
  ),
  constraint auth_password_operations_reason_allowlist check (
    reason_code is null
    or reason_code in (
      'AUTH_CALL_NOT_ATTEMPTED',
      'AUTH_PROVIDER_FAILURE',
      'AUTH_COMPLETION_FAILURE',
      'OPERATION_EXPIRED'
    )
  ),
  constraint auth_password_operations_lifecycle check (
    (
      status = 'reserved'
      and reason_code is null
      and auth_updated_at is null
      and completed_at is null
      and failed_at is null
    )
    or (
      status = 'auth_updated'
      and reason_code is null
      and auth_updated_at is not null
      and completed_at is null
      and failed_at is null
    )
    or (
      status = 'completed'
      and reason_code is null
      and auth_updated_at is not null
      and completed_at is not null
      and completed_at >= auth_updated_at
      and failed_at is null
    )
    or (
      status = 'failed'
      and reason_code is not null
      and completed_at is null
      and failed_at is not null
      and (
        (reason_code = 'AUTH_COMPLETION_FAILURE' and auth_updated_at is not null)
        or (
          reason_code in ('AUTH_CALL_NOT_ATTEMPTED','AUTH_PROVIDER_FAILURE')
          and auth_updated_at is null
        )
        or reason_code = 'OPERATION_EXPIRED'
      )
    )
  ),
  constraint auth_password_operations_timestamp_order check (
    created_at = reserved_at
    and updated_at >= created_at
    and (auth_updated_at is null or auth_updated_at >= reserved_at)
    and (completed_at is null or completed_at >= reserved_at)
    and (failed_at is null or failed_at >= reserved_at)
  )
);

create index auth_password_operations_actor_idx
  on private.auth_password_operations(actor_user_id, reserved_at desc, id);
create index auth_password_operations_target_idx
  on private.auth_password_operations(target_user_id, reserved_at desc, id);
create unique index auth_password_operations_target_nonterminal_key
  on private.auth_password_operations(target_user_id)
  where status in ('reserved', 'auth_updated');
create index auth_password_operations_company_idx
  on private.auth_password_operations(company_id, reserved_at desc, id)
  where company_id is not null;
create index auth_password_operations_reconciliation_idx
  on private.auth_password_operations(status, expires_at, id)
  where status in ('reserved', 'auth_updated');
create index auth_password_operations_correlation_idx
  on private.auth_password_operations(correlation_id);

alter table private.auth_password_operations enable row level security;
alter table private.auth_password_operations force row level security;
revoke all on private.auth_password_operations
  from public, anon, authenticated, service_role, axsys_bff;

create function private.guard_auth_password_operation_update() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.target_user_id is distinct from old.target_user_id
     or new.scope is distinct from old.scope
     or new.company_id is distinct from old.company_id
     or new.kind is distinct from old.kind
     or new.correlation_id is distinct from old.correlation_id
     or new.expires_at is distinct from old.expires_at
     or new.reserved_at is distinct from old.reserved_at
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'auth_password_operation_identity_immutable';
  end if;

  if old.status in ('completed', 'failed') then
    raise exception using
      errcode = '55000',
      message = 'auth_password_operation_terminal';
  end if;

  if new.updated_at < old.updated_at
     or not (
       (old.status = 'reserved' and new.status in ('auth_updated','completed','failed'))
       or (old.status = 'auth_updated' and new.status in ('completed','failed'))
     ) then
    raise exception using
      errcode = '55000',
      message = 'auth_password_operation_transition_invalid';
  end if;
  return new;
end;
$$;

create trigger auth_password_operations_guard_update
before update on private.auth_password_operations
for each row execute function private.guard_auth_password_operation_update();

revoke execute on function private.guard_auth_password_operation_update()
  from public, anon, authenticated, service_role, axsys_bff;

create function private.begin_temporary_password_reset(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_target_user_id uuid,
  p_correlation_id uuid
) returns table (
  operation_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control private.auth_session_controls%rowtype;
  v_auth_created_at timestamptz;
  v_auth_not_after timestamptz;
  v_auth_found boolean;
  v_scope public.audit_scope;
  v_company_id uuid;
  v_existing_operation private.auth_password_operations%rowtype;
  v_operation_id uuid;
  v_expires_at timestamptz;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null
     or p_target_user_id is null or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'auth_password_reset_input_invalid';
  end if;
  if p_actor_user_id = p_target_user_id then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  select auth_session.created_at, auth_session.not_after
  into v_auth_created_at, v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = p_actor_user_id
  for share;
  v_auth_found := found;
  select control.* into v_control
  from private.auth_session_controls control
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
  for update;
  v_now := clock_timestamp();
  if not found
     or not v_auth_found
     or v_auth_created_at is null
     or v_control.auth_created_at is distinct from v_auth_created_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now)
     or v_control.state <> 'active'
     or v_control.absolute_expires_at <= v_now
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = p_actor_user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     )
     or not exists (
       select 1 from public.profiles profile
       where profile.user_id = p_actor_user_id
         and profile.is_active
         and not profile.must_change_password
     ) then
    raise exception using
      errcode = '23514',
      message = 'auth_password_actor_session_invalid';
  end if;

  select identity.resolved_scope, identity.resolved_company_id
  into v_scope, v_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;

  if v_scope = 'tenant' and not exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = p_actor_user_id
      and membership.company_id = v_company_id
      and membership.role = 'company_admin'
      and membership.status = 'active'
      and company.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;

  perform 1
  from public.profiles target_profile
  where target_profile.user_id = p_target_user_id
    and target_profile.is_active
    and (
      (
        v_scope = 'platform'
        and (
          exists (
            select 1 from public.platform_roles target_platform
            where target_platform.user_id = target_profile.user_id
              and target_platform.is_active
          )
          or exists (
            select 1
            from public.company_memberships target_membership
            join public.companies target_company
              on target_company.id = target_membership.company_id
            where target_membership.user_id = target_profile.user_id
              and target_membership.status = 'active'
              and target_company.status = 'active'
          )
        )
      )
      or (
        v_scope = 'tenant'
        and exists (
          select 1
          from public.company_memberships target_membership
          join public.companies target_company
            on target_company.id = target_membership.company_id
          where target_membership.user_id = target_profile.user_id
            and target_membership.company_id = v_company_id
            and target_membership.status = 'active'
            and target_company.status = 'active'
        )
      )
    )
  for update of target_profile;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'auth_password_target_not_found';
  end if;

  select operation.* into v_existing_operation
  from private.auth_password_operations operation
  where operation.target_user_id = p_target_user_id
    and operation.status in ('reserved', 'auth_updated')
  for update;
  if found then
    if v_existing_operation.expires_at > v_now then
      raise exception using
        errcode = '23505',
        message = 'auth_password_operation_in_progress';
    end if;

    perform set_config('app.actor_id', p_actor_user_id::text, true);
    update private.auth_password_operations operation
    set status = 'failed',
        reason_code = 'OPERATION_EXPIRED',
        failed_at = v_now,
        updated_at = v_now
    where operation.id = v_existing_operation.id
      and operation.status in ('reserved', 'auth_updated')
      and operation.expires_at <= v_now;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'auth_password_reconciliation_lost';
    end if;

    insert into public.audit_events (
      scope, company_id, actor_user_id, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, metadata, occurred_at
    ) values (
      v_scope, v_company_id, p_actor_user_id,
      'auth.temporary_password_reset_reconciled', 'user', p_target_user_id,
      'failure', 'OPERATION_EXPIRED', v_existing_operation.correlation_id,
      '{}', v_now
    );
  end if;

  v_expires_at := v_now + interval '24 hours';
  perform set_config('app.actor_id', p_actor_user_id::text, true);
  update public.profiles profile
  set must_change_password = true,
      temporary_password_expires_at = v_expires_at
  where profile.user_id = p_target_user_id;
  perform private.revoke_auth_sessions(p_target_user_id, null);

  insert into private.auth_password_operations (
    actor_user_id, target_user_id, scope, company_id, kind, status,
    correlation_id, expires_at, reserved_at, created_at, updated_at
  ) values (
    p_actor_user_id, p_target_user_id, v_scope, v_company_id,
    'temporary_password_reset', 'reserved', p_correlation_id,
    v_expires_at, v_now, v_now, v_now
  ) returning id into v_operation_id;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_scope, v_company_id, p_actor_user_id,
    'auth.temporary_password_reset_reserved', 'user', p_target_user_id,
    'success', null, p_correlation_id, '{}', v_now
  );

  return query select v_operation_id, v_expires_at;
end;
$$;

create function private.complete_temporary_password_reset(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control private.auth_session_controls%rowtype;
  v_operation private.auth_password_operations%rowtype;
  v_auth_created_at timestamptz;
  v_auth_not_after timestamptz;
  v_auth_found boolean;
  v_current_scope public.audit_scope;
  v_current_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null
     or p_operation_id is null or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'auth_password_completion_input_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  select auth_session.created_at, auth_session.not_after
  into v_auth_created_at, v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = p_actor_user_id
  for share;
  v_auth_found := found;
  select control.* into v_control
  from private.auth_session_controls control
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
  for update;
  v_now := clock_timestamp();
  if not found or not v_auth_found
     or v_control.auth_created_at is distinct from v_auth_created_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now)
     or v_control.state <> 'active'
     or v_control.absolute_expires_at <= v_now
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = p_actor_user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using
      errcode = '23514',
      message = 'auth_password_actor_session_invalid';
  end if;

  select operation.* into v_operation
  from private.auth_password_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
  for update;
  if not found
     or v_operation.kind <> 'temporary_password_reset'
     or v_operation.status <> 'reserved'
     or v_operation.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'auth_password_operation_invalid';
  end if;
  if p_correlation_id is distinct from v_operation.correlation_id then
    raise exception using
      errcode = '23514',
      message = 'auth_password_operation_correlation_mismatch';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = v_operation.target_user_id
      and profile.is_active
      and profile.must_change_password
      and profile.temporary_password_expires_at = v_operation.expires_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'auth_password_operation_invalid';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = p_actor_user_id
      and profile.is_active
      and not profile.must_change_password
  ) then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;
  select identity.resolved_scope, identity.resolved_company_id
  into v_current_scope, v_current_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;
  if v_current_scope is distinct from v_operation.scope
     or v_current_company_id is distinct from v_operation.company_id then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;

  if v_operation.scope = 'platform' then
    if not exists (
      select 1
      from public.platform_roles platform_role
      join public.profiles profile on profile.user_id = platform_role.user_id
      where platform_role.user_id = p_actor_user_id
        and platform_role.is_active
        and profile.is_active
        and not profile.must_change_password
    ) then
      raise exception using
        errcode = '42501',
        message = 'auth_password_reset_forbidden';
    end if;
    if not exists (
      select 1
      from public.profiles target_profile
      where target_profile.user_id = v_operation.target_user_id
        and target_profile.is_active
        and (
          exists (
            select 1 from public.platform_roles target_platform
            where target_platform.user_id = target_profile.user_id
              and target_platform.is_active
          )
          or exists (
            select 1
            from public.company_memberships target_membership
            join public.companies target_company
              on target_company.id = target_membership.company_id
            where target_membership.user_id = target_profile.user_id
              and target_membership.status = 'active'
              and target_company.status = 'active'
          )
        )
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'auth_password_target_not_found';
    end if;
  elsif not exists (
    select 1
    from public.company_memberships actor_membership
    join public.company_memberships target_membership
      on target_membership.company_id = actor_membership.company_id
    join public.companies company on company.id = actor_membership.company_id
    where actor_membership.user_id = p_actor_user_id
      and actor_membership.company_id = v_operation.company_id
      and actor_membership.role = 'company_admin'
      and actor_membership.status = 'active'
      and target_membership.user_id = v_operation.target_user_id
      and target_membership.status = 'active'
      and company.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;

  perform set_config('app.actor_id', p_actor_user_id::text, true);
  update private.auth_password_operations operation
  set status = 'completed',
      auth_updated_at = v_now,
      completed_at = v_now,
      updated_at = v_now
  where operation.id = p_operation_id
    and operation.status = 'reserved';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'auth_password_completion_lost';
  end if;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_operation.scope, v_operation.company_id, p_actor_user_id,
    'auth.temporary_password_reset_completed', 'user',
    v_operation.target_user_id, 'success', null,
    v_operation.correlation_id, '{}', v_now
  );
end;
$$;

create function private.fail_temporary_password_reset(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_operation_id uuid,
  p_reason_code text,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control private.auth_session_controls%rowtype;
  v_operation private.auth_password_operations%rowtype;
  v_auth_created_at timestamptz;
  v_auth_not_after timestamptz;
  v_auth_found boolean;
  v_current_scope public.audit_scope;
  v_current_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null
     or p_operation_id is null or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'auth_password_failure_input_invalid';
  end if;
  if p_reason_code not in (
    'AUTH_CALL_NOT_ATTEMPTED',
    'AUTH_PROVIDER_FAILURE',
    'AUTH_COMPLETION_FAILURE'
  ) then
    raise exception using
      errcode = '22023',
      message = 'auth_password_failure_reason_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  select auth_session.created_at, auth_session.not_after
  into v_auth_created_at, v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = p_actor_user_id
  for share;
  v_auth_found := found;
  select control.* into v_control
  from private.auth_session_controls control
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
  for update;
  v_now := clock_timestamp();
  if not found or not v_auth_found
     or v_control.auth_created_at is distinct from v_auth_created_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now)
     or v_control.state <> 'active'
     or v_control.absolute_expires_at <= v_now
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = p_actor_user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using
      errcode = '23514',
      message = 'auth_password_actor_session_invalid';
  end if;

  select operation.* into v_operation
  from private.auth_password_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
  for update;
  if not found
     or v_operation.kind <> 'temporary_password_reset'
     or v_operation.status <> 'reserved' then
    raise exception using
      errcode = '23514',
      message = 'auth_password_operation_invalid';
  end if;
  if p_correlation_id is distinct from v_operation.correlation_id then
    raise exception using
      errcode = '23514',
      message = 'auth_password_operation_correlation_mismatch';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = p_actor_user_id
      and profile.is_active
      and not profile.must_change_password
  ) then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;
  select identity.resolved_scope, identity.resolved_company_id
  into v_current_scope, v_current_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;
  if v_current_scope is distinct from v_operation.scope
     or v_current_company_id is distinct from v_operation.company_id then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;
  if (
    v_operation.scope = 'platform'
    and not exists (
      select 1 from public.platform_roles platform_role
      where platform_role.user_id = p_actor_user_id
        and platform_role.is_active
    )
  ) or (
    v_operation.scope = 'tenant'
    and not exists (
      select 1
      from public.company_memberships membership
      join public.companies company on company.id = membership.company_id
      where membership.user_id = p_actor_user_id
        and membership.company_id = v_operation.company_id
        and membership.role = 'company_admin'
        and membership.status = 'active'
        and company.status = 'active'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'auth_password_reset_forbidden';
  end if;

  perform set_config('app.actor_id', p_actor_user_id::text, true);
  update private.auth_password_operations operation
  set status = 'failed',
      reason_code = p_reason_code,
      auth_updated_at = case
        when p_reason_code = 'AUTH_COMPLETION_FAILURE' then v_now
        else null
      end,
      failed_at = v_now,
      updated_at = v_now
  where operation.id = p_operation_id
    and operation.status = 'reserved';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'auth_password_failure_lost';
  end if;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_operation.scope, v_operation.company_id, p_actor_user_id,
    'auth.temporary_password_reset_failed', 'user',
    v_operation.target_user_id, 'failure', p_reason_code,
    v_operation.correlation_id, '{}', v_now
  );
end;
$$;

create function private.complete_temporary_password_change(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control private.auth_session_controls%rowtype;
  v_auth_created_at timestamptz;
  v_auth_not_after timestamptz;
  v_auth_found boolean;
  v_expires_at timestamptz;
  v_current_scope public.audit_scope;
  v_current_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'auth_password_change_input_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  select auth_session.created_at, auth_session.not_after
  into v_auth_created_at, v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = p_actor_user_id
  for share;
  v_auth_found := found;
  select control.* into v_control
  from private.auth_session_controls control
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
  for update;
  v_now := clock_timestamp();
  if not found or not v_auth_found
     or v_control.auth_created_at is distinct from v_auth_created_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now)
     or v_control.state <> 'active'
     or v_control.absolute_expires_at <= v_now
     or v_control.audit_scope is null
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = p_actor_user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using
      errcode = '23514',
      message = 'auth_password_actor_session_invalid';
  end if;

  select profile.temporary_password_expires_at into v_expires_at
  from public.profiles profile
  where profile.user_id = p_actor_user_id
    and profile.is_active
    and profile.must_change_password
    and profile.temporary_password_expires_at > v_now
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'auth_temporary_password_invalid';
  end if;
  select identity.resolved_scope, identity.resolved_company_id
  into v_current_scope, v_current_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;
  if v_current_scope is distinct from v_control.audit_scope
     or v_current_company_id is distinct from v_control.audit_company_id then
    raise exception using
      errcode = '42501',
      message = 'auth_password_change_scope_invalid';
  end if;

  perform set_config('app.actor_id', p_actor_user_id::text, true);
  update public.profiles profile
  set must_change_password = false,
      temporary_password_expires_at = null,
      password_changed_at = v_now
  where profile.user_id = p_actor_user_id;
  perform private.revoke_auth_sessions(p_actor_user_id, null);

  insert into private.auth_password_operations (
    actor_user_id, target_user_id, scope, company_id, kind, status,
    correlation_id, expires_at, reserved_at, auth_updated_at,
    completed_at, created_at, updated_at
  ) values (
    p_actor_user_id, p_actor_user_id,
    v_control.audit_scope, v_control.audit_company_id,
    'temporary_password_change', 'completed', p_correlation_id,
    v_expires_at, v_now, v_now, v_now, v_now, v_now
  );

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_control.audit_scope, v_control.audit_company_id, p_actor_user_id,
    'auth.temporary_password_changed', 'user', p_actor_user_id,
    'success', null, p_correlation_id, '{}', v_now
  );
end;
$$;

revoke execute on function private.begin_temporary_password_reset(
  uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.begin_temporary_password_reset(
  uuid,uuid,uuid,uuid
) to axsys_bff;
revoke execute on function private.complete_temporary_password_reset(
  uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.complete_temporary_password_reset(
  uuid,uuid,uuid,uuid
) to axsys_bff;
revoke execute on function private.fail_temporary_password_reset(
  uuid,uuid,uuid,text,uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.fail_temporary_password_reset(
  uuid,uuid,uuid,text,uuid
) to axsys_bff;
revoke execute on function private.complete_temporary_password_change(
  uuid,uuid,uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.complete_temporary_password_change(
  uuid,uuid,uuid
) to axsys_bff;
