begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PASSWORD_RECOVERY_MIGRATION_OWNER_INVALID';
  end if;
end
$$;

alter type private.auth_password_operation_kind
  add value 'password_recovery';

do $$
declare
  v_expected_policy_count integer;
  v_updated_policy_count integer;
begin
  select count(*)::integer
  into v_expected_policy_count
  from private.rate_limit_policies policy
  join (values
    ('forgot-ip-volume', 10, 900, 60, false),
    ('forgot-account-volume', 3, 3600, 60, false)
  ) expected(
    bucket, attempt_limit, window_seconds, block_seconds, clear_on_success
  ) on policy.bucket = expected.bucket
     and policy.attempt_limit = expected.attempt_limit
     and policy.window_seconds = expected.window_seconds
     and policy.block_seconds = expected.block_seconds
     and policy.clear_on_success = expected.clear_on_success;
  if v_expected_policy_count <> 2
     or 2 <> (
       select count(*)
       from private.rate_limit_policies policy
       where policy.bucket in ('forgot-ip-volume', 'forgot-account-volume')
     ) then
    raise exception using
      errcode = '23514',
      message = 'AXSYS_FORGOT_RATE_POLICY_DRIFT';
  end if;

  update private.rate_limit_policies policy
  set block_seconds = 3600
  where (policy.bucket, policy.attempt_limit, policy.window_seconds,
         policy.block_seconds, policy.clear_on_success) in (
    ('forgot-ip-volume', 10, 900, 60, false),
    ('forgot-account-volume', 3, 3600, 60, false)
  );
  get diagnostics v_updated_policy_count = row_count;
  if v_updated_policy_count <> 2 then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_FORGOT_RATE_POLICY_DRIFT';
  end if;
end
$$;

create table private.password_recovery_grants (
  grant_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint password_recovery_grants_session_key unique (session_id),
  constraint password_recovery_grants_hash_format check (
    grant_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint password_recovery_grants_expiry_order check (
    expires_at > created_at
  ),
  constraint password_recovery_grants_consumed_order check (
    consumed_at is null
    or (consumed_at >= created_at and consumed_at < expires_at)
  ),
  constraint password_recovery_grants_updated_order check (
    updated_at >= created_at
  )
);

create index password_recovery_grants_user_id_idx
  on private.password_recovery_grants(user_id);

alter table private.password_recovery_grants enable row level security;
alter table private.password_recovery_grants force row level security;
revoke all on private.password_recovery_grants
  from public, anon, authenticated, service_role, axsys_bff;

create function public.issue_password_recovery_grant(
  p_grant_hash text
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_session_claim text;
  v_claims jsonb;
  v_amr jsonb;
  v_is_anonymous jsonb;
  v_recovery_count integer;
  v_amr_at bigint;
  v_amr_time timestamptz;
  v_expires_at timestamptz;
  v_auth_user_found boolean;
  v_auth_not_after timestamptz;
  v_auth_session_found boolean;
  v_profile_active boolean;
  v_profile_found boolean;
  v_now timestamptz;
begin
  if p_grant_hash is null or p_grant_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'password_recovery_grant_hash_invalid';
  end if;

  v_claims := (select auth.jwt());
  begin
    v_user_id := (select auth.uid());
  exception
    when invalid_text_representation then
      v_user_id := null;
  end;
  v_session_claim := nullif(v_claims ->> 'session_id', '');
  begin
    v_session_id := v_session_claim::uuid;
  exception
    when invalid_text_representation then
      v_session_id := null;
  end;
  v_amr := v_claims -> 'amr';
  v_is_anonymous := v_claims -> 'is_anonymous';
  if v_user_id is null
     or v_session_id is null
     or jsonb_typeof(v_claims) <> 'object'
     or jsonb_typeof(v_amr) <> 'array'
     or v_is_anonymous is distinct from 'false'::jsonb then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  select count(*)::integer
  into v_recovery_count
  from jsonb_array_elements(v_amr) entry
  where jsonb_typeof(entry) = 'object'
    and entry ->> 'method' = 'recovery';
  if v_recovery_count <> 1 then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  select case
    when jsonb_typeof(entry -> 'timestamp') = 'number'
      and entry ->> 'timestamp' ~ '^[1-9][0-9]{0,15}$'
    then (entry ->> 'timestamp')::bigint
    else null
  end
  into v_amr_at
  from jsonb_array_elements(v_amr) entry
  where jsonb_typeof(entry) = 'object'
    and entry ->> 'method' = 'recovery';
  if v_amr_at is null or v_amr_at > 9007199254740991 then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  v_now := clock_timestamp();
  if v_amr_at::numeric > extract(epoch from v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;
  v_amr_time := to_timestamp(v_amr_at);
  v_expires_at := v_amr_time + interval '10 minutes';

  perform pg_advisory_xact_lock(hashtextextended(v_session_id::text, 1674));
  perform 1
  from auth.users auth_user
  where auth_user.id = v_user_id
  for key share;
  v_auth_user_found := found;
  v_now := clock_timestamp();
  if not v_auth_user_found or v_now >= v_expires_at then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  select auth_session.not_after
  into v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = v_session_id
    and auth_session.user_id = v_user_id
  for share;
  v_auth_session_found := found;
  v_now := clock_timestamp();
  if not v_auth_user_found
     or not v_auth_session_found
     or v_now >= v_expires_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  select profile.is_active
  into v_profile_active
  from public.profiles profile
  where profile.user_id = v_user_id
  for share;
  v_profile_found := found;
  v_now := clock_timestamp();
  if not v_profile_found
     or not v_profile_active
     or v_now >= v_expires_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  begin
    insert into private.password_recovery_grants (
      grant_hash, user_id, session_id, expires_at,
      created_at, updated_at
    ) values (
      p_grant_hash, v_user_id, v_session_id, v_expires_at,
      v_now, v_now
    );
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'password_recovery_grant_already_issued';
  end;

  v_now := clock_timestamp();
  if v_now >= v_expires_at
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_context_invalid';
  end if;

  return v_expires_at;
end;
$$;

create function private.begin_password_recovery(
  p_grant_hash text,
  p_correlation_id uuid
) returns table (operation_id uuid, user_id uuid, session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_hint private.password_recovery_grants%rowtype;
  v_grant private.password_recovery_grants%rowtype;
  v_existing_operation private.auth_password_operations%rowtype;
  v_scope public.audit_scope;
  v_company_id uuid;
  v_identity_count integer;
  v_operation_id uuid;
  v_auth_user_found boolean;
  v_auth_not_after timestamptz;
  v_auth_session_found boolean;
  v_profile_active boolean;
  v_profile_found boolean;
  v_company_found boolean;
  v_existing_operation_found boolean;
  v_now timestamptz;
begin
  if p_grant_hash is null
     or p_grant_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'password_recovery_begin_input_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  select grant_row.* into v_grant_hint
  from private.password_recovery_grants grant_row
  where grant_row.grant_hash = p_grant_hash;
  if not found then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_grant_hint.user_id::text, 1673)
  );
  perform 1
  from auth.users auth_user
  where auth_user.id = v_grant_hint.user_id
  for key share;
  v_auth_user_found := found;

  select auth_session.not_after
  into v_auth_not_after
  from auth.sessions auth_session
  where auth_session.id = v_grant_hint.session_id
    and auth_session.user_id = v_grant_hint.user_id
  for share;
  v_auth_session_found := found;

  select profile.is_active
  into v_profile_active
  from public.profiles profile
  where profile.user_id = v_grant_hint.user_id
  for update;
  v_profile_found := found;

  select grant_row.* into v_grant
  from private.password_recovery_grants grant_row
  where grant_row.grant_hash = p_grant_hash
  for update;
  v_now := clock_timestamp();
  if not found
     or not v_auth_user_found
     or not v_auth_session_found
     or not v_profile_found
     or not v_profile_active
     or v_grant.user_id is distinct from v_grant_hint.user_id
     or v_grant.session_id is distinct from v_grant_hint.session_id
     or v_grant.consumed_at is not null
     or v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  with identities as (
    select 'platform'::text as scope, null::uuid as company_id
    from public.platform_roles platform_role
    where platform_role.user_id = v_grant.user_id
      and platform_role.is_active
    union all
    select 'tenant'::text, membership.company_id
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = v_grant.user_id
      and membership.status = 'active'
      and company.status = 'active'
  )
  select count(*)::integer, max(scope)::public.audit_scope,
         (array_agg(company_id))[1]
  into v_identity_count, v_scope, v_company_id
  from identities;
  if v_identity_count <> 1 or v_scope is null then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  v_company_found := true;
  if v_company_id is not null then
    perform 1
    from public.companies company
    where company.id = v_company_id
      and company.status = 'active'
    for key share;
    v_company_found := found;
  end if;
  v_now := clock_timestamp();
  if not v_company_found
     or v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  select operation.*
  into v_existing_operation
  from private.auth_password_operations operation
  where operation.target_user_id = v_grant.user_id
    and operation.status in ('reserved', 'auth_updated')
  for update;
  v_existing_operation_found := found;
  v_now := clock_timestamp();
  if v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  perform set_config('app.actor_id', v_grant.user_id::text, true);
  if v_existing_operation_found then
    if v_existing_operation.expires_at > v_now then
      raise exception using
        errcode = '23505',
        message = 'auth_password_operation_in_progress';
    end if;

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
      v_scope, v_company_id, v_grant.user_id,
      'auth.password_recovery_reconciled', 'user', v_grant.user_id,
      'failure', 'OPERATION_EXPIRED', v_existing_operation.correlation_id,
      '{}', v_now
    );
  end if;

  v_now := clock_timestamp();
  if v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;
  update private.password_recovery_grants grant_row
  set consumed_at = v_now,
      updated_at = v_now
  where grant_row.grant_hash = p_grant_hash
    and grant_row.consumed_at is null
    and grant_row.expires_at > v_now;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'password_recovery_grant_consumption_lost';
  end if;

  update public.profiles profile
  set must_change_password = true,
      temporary_password_expires_at = v_grant.expires_at
  where profile.user_id = v_grant.user_id;
  perform private.revoke_auth_sessions(v_grant.user_id, null);

  v_now := clock_timestamp();
  if v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  insert into private.auth_password_operations (
    actor_user_id, target_user_id, scope, company_id, kind, status,
    correlation_id, expires_at, reserved_at, created_at, updated_at
  ) values (
    v_grant.user_id, v_grant.user_id, v_scope, v_company_id,
    'password_recovery', 'reserved', p_correlation_id,
    v_grant.expires_at, v_now, v_now, v_now
  ) returning id into v_operation_id;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_scope, v_company_id, v_grant.user_id,
    'auth.password_recovery_reserved', 'user', v_grant.user_id,
    'success', null, p_correlation_id, '{}', v_now
  );

  v_now := clock_timestamp();
  if v_grant.expires_at <= v_now
     or (v_auth_not_after is not null and v_auth_not_after <= v_now) then
    raise exception using
      errcode = '28000',
      message = 'password_recovery_grant_invalid';
  end if;

  return query
    select v_operation_id, v_grant.user_id, v_grant.session_id;
end;
$$;

create function private.complete_password_recovery(
  p_operation_id uuid,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_hint private.auth_password_operations%rowtype;
  v_operation private.auth_password_operations%rowtype;
  v_scope public.audit_scope;
  v_company_id uuid;
  v_identity_count integer;
  v_profile_active boolean;
  v_profile_forced boolean;
  v_profile_expires_at timestamptz;
  v_profile_found boolean;
  v_auth_user_found boolean;
  v_company_found boolean;
  v_operation_found boolean;
  v_now timestamptz;
begin
  if p_operation_id is null or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'password_recovery_completion_input_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  select operation.* into v_operation_hint
  from private.auth_password_operations operation
  where operation.id = p_operation_id;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_operation_hint.target_user_id::text, 1673)
  );
  perform 1
  from auth.users auth_user
  where auth_user.id = v_operation_hint.target_user_id
  for key share;
  v_auth_user_found := found;

  select profile.is_active,
         profile.must_change_password,
         profile.temporary_password_expires_at
  into v_profile_active, v_profile_forced, v_profile_expires_at
  from public.profiles profile
  where profile.user_id = v_operation_hint.target_user_id
  for update;
  v_profile_found := found;

  v_company_found := true;
  if v_operation_hint.company_id is not null then
    perform 1
    from public.companies company
    where company.id = v_operation_hint.company_id
    for key share;
    v_company_found := found;
  end if;

  select operation.* into v_operation
  from private.auth_password_operations operation
  where operation.id = p_operation_id
  for update;
  v_operation_found := found;
  v_now := clock_timestamp();
  if not v_auth_user_found
     or not v_profile_found
     or not v_company_found
     or not v_operation_found
     or v_operation.target_user_id is distinct from v_operation_hint.target_user_id
     or v_operation.company_id is distinct from v_operation_hint.company_id
     or v_operation.kind <> 'password_recovery'
     or v_operation.status <> 'reserved'
     or v_operation.actor_user_id <> v_operation.target_user_id
     or not v_profile_active
     or not v_profile_forced
     or v_profile_expires_at is distinct from v_operation.expires_at
     or v_operation.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;
  if p_correlation_id is distinct from v_operation.correlation_id then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_correlation_mismatch';
  end if;

  with identities as (
    select 'platform'::text as scope, null::uuid as company_id
    from public.platform_roles platform_role
    where platform_role.user_id = v_operation.target_user_id
      and platform_role.is_active
    union all
    select 'tenant'::text, membership.company_id
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = v_operation.target_user_id
      and membership.status = 'active'
      and company.status = 'active'
  )
  select count(*)::integer, max(scope)::public.audit_scope,
         (array_agg(company_id))[1]
  into v_identity_count, v_scope, v_company_id
  from identities;
  if v_identity_count <> 1
     or v_scope is distinct from v_operation.scope
     or v_company_id is distinct from v_operation.company_id then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;

  v_now := clock_timestamp();
  if v_operation.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;
  perform set_config('app.actor_id', v_operation.target_user_id::text, true);
  update public.profiles profile
  set must_change_password = false,
      temporary_password_expires_at = null,
      password_changed_at = v_now
  where profile.user_id = v_operation.target_user_id;
  perform private.revoke_auth_sessions(v_operation.target_user_id, null);

  v_now := clock_timestamp();
  if v_operation.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;

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
      message = 'password_recovery_completion_lost';
  end if;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_operation.scope, v_operation.company_id,
    v_operation.target_user_id, 'auth.password_recovery_completed',
    'user', v_operation.target_user_id, 'success', null,
    v_operation.correlation_id, '{}', v_now
  );

  v_now := clock_timestamp();
  if v_operation.expires_at <= v_now then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;
end;
$$;

create function private.fail_password_recovery(
  p_operation_id uuid,
  p_reason_code text,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_hint private.auth_password_operations%rowtype;
  v_operation private.auth_password_operations%rowtype;
  v_auth_user_found boolean;
  v_profile_found boolean;
  v_company_found boolean;
  v_operation_found boolean;
  v_now timestamptz;
begin
  if p_operation_id is null or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'password_recovery_failure_input_invalid';
  end if;
  if p_reason_code not in (
    'AUTH_CALL_NOT_ATTEMPTED',
    'AUTH_PROVIDER_FAILURE',
    'AUTH_COMPLETION_FAILURE'
  ) then
    raise exception using
      errcode = '22023',
      message = 'password_recovery_failure_reason_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  select operation.* into v_operation_hint
  from private.auth_password_operations operation
  where operation.id = p_operation_id;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_operation_hint.target_user_id::text, 1673)
  );
  perform 1
  from auth.users auth_user
  where auth_user.id = v_operation_hint.target_user_id
  for key share;
  v_auth_user_found := found;

  perform 1
  from public.profiles profile
  where profile.user_id = v_operation_hint.target_user_id
  for key share;
  v_profile_found := found;

  v_company_found := true;
  if v_operation_hint.company_id is not null then
    perform 1
    from public.companies company
    where company.id = v_operation_hint.company_id
    for key share;
    v_company_found := found;
  end if;

  select operation.* into v_operation
  from private.auth_password_operations operation
  where operation.id = p_operation_id
  for update;
  v_operation_found := found;
  if not v_auth_user_found
     or not v_profile_found
     or not v_company_found
     or not v_operation_found
     or v_operation.target_user_id is distinct from v_operation_hint.target_user_id
     or v_operation.company_id is distinct from v_operation_hint.company_id
     or v_operation.scope is distinct from v_operation_hint.scope
     or v_operation.kind <> 'password_recovery'
     or v_operation.status <> 'reserved'
     or v_operation.actor_user_id <> v_operation.target_user_id then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_invalid';
  end if;
  if p_correlation_id is distinct from v_operation.correlation_id then
    raise exception using
      errcode = '23514',
      message = 'password_recovery_operation_correlation_mismatch';
  end if;

  v_now := clock_timestamp();
  perform set_config('app.actor_id', v_operation.target_user_id::text, true);
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
      message = 'password_recovery_failure_lost';
  end if;

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_operation.scope, v_operation.company_id,
    v_operation.target_user_id, 'auth.password_recovery_failed',
    'user', v_operation.target_user_id, 'failure', p_reason_code,
    v_operation.correlation_id, '{}', v_now
  );
end;
$$;

revoke execute on function public.issue_password_recovery_grant(text)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function public.issue_password_recovery_grant(text)
  to authenticated;

revoke execute on function private.begin_password_recovery(text,uuid),
  private.complete_password_recovery(uuid,uuid),
  private.fail_password_recovery(uuid,text,uuid)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.begin_password_recovery(text,uuid),
  private.complete_password_recovery(uuid,uuid),
  private.fail_password_recovery(uuid,text,uuid)
  to axsys_bff;

commit;
