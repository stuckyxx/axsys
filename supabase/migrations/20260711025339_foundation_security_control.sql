do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_SECURITY_CONTROL_MIGRATION_OWNER_INVALID';
  end if;

  if not exists (
    select 1
    from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        left join pg_roles grantee on grantee.oid = grant_item.grantee
        where grant_item.grantee = 0
           or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) or exists (
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
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_GLOBAL_DEFAULT_ACL_NOT_HARDENED';
  end if;

  if to_regnamespace('private') is null
     or (select nspowner from pg_namespace where nspname = 'private')
        <> 'postgres'::regrole then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_PRIVATE_SCHEMA_OWNER_INVALID';
  end if;

  if to_regclass('auth.sessions') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'auth.sessions'::regclass
         and attname = 'id' and atttypid = 'uuid'::regtype
         and attnotnull and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'auth.sessions'::regclass
         and attname = 'user_id' and atttypid = 'uuid'::regtype
         and attnotnull and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'auth.sessions'::regclass
         and attname = 'created_at' and atttypid = 'timestamptz'::regtype
         and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'auth.sessions'::regclass
         and attname = 'not_after' and atttypid = 'timestamptz'::regtype
         and not attisdropped
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_AUTH_SESSIONS_CATALOG_INVALID';
  end if;
end
$$;

alter default privileges for role postgres
  revoke usage on types from public, anon, authenticated, service_role, axsys_bff;

create type public.audit_scope as enum ('platform', 'tenant');
create type public.audit_outcome as enum ('success', 'denied', 'failure');
create type public.idempotency_state as enum ('processing', 'completed', 'failed');
create type private.auth_session_state as enum ('pending', 'active', 'revoked');
grant usage on type public.audit_outcome to axsys_bff;
revoke all on type private.auth_session_state
  from public, anon, authenticated, service_role, axsys_bff;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  scope public.audit_scope not null,
  company_id uuid references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  outcome public.audit_outcome not null,
  reason_code text,
  correlation_id uuid not null,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint audit_events_scope_company check (
    (scope = 'platform' and company_id is null)
    or (scope = 'tenant' and company_id is not null)
  ),
  constraint audit_events_action_format check (
    action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  constraint audit_events_resource_type_format check (
    resource_type ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint audit_events_reason_code_format check (
    reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]*$'
  ),
  constraint audit_events_ip_hash_format check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint audit_events_user_agent_hash_format check (
    user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint audit_events_metadata_object check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 16384
  )
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references public.profiles(user_id) on delete restrict,
  email_hash text,
  ip_hash text,
  outcome public.audit_outcome not null,
  reason_code text,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint security_events_event_type_format check (
    event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  constraint security_events_reason_code_format check (
    reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]*$'
  ),
  constraint security_events_email_hash_format check (
    email_hash is null or email_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint security_events_ip_hash_format check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint security_events_metadata_object check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 16384
  )
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  operation text not null,
  key_hash text not null,
  request_hash text not null,
  state public.idempotency_state not null default 'processing',
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint idempotency_keys_identity_unique
    unique nulls not distinct (actor_user_id, company_id, operation, key_hash),
  constraint idempotency_keys_operation_format check (
    operation ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  ),
  constraint idempotency_keys_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint idempotency_keys_request_hash_format check (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint idempotency_keys_processing_response check (
    (state = 'processing'
      and response_status is null
      and response_body is null
      and completed_at is null)
    or (state in ('completed', 'failed')
      and response_status is not null
      and completed_at is not null
      and completed_at >= created_at)
  ),
  constraint idempotency_keys_response_size check (
    response_body is null or octet_length(response_body::text) <= 65536
  ),
  constraint idempotency_keys_response_status_range check (
    response_status is null or response_status between 100 and 599
  ),
  constraint idempotency_keys_expiry_order check (expires_at > created_at)
);

create table private.rate_limit_policies (
  bucket text primary key,
  attempt_limit integer not null check (attempt_limit > 0),
  window_seconds integer not null check (window_seconds > 0),
  block_seconds integer not null check (block_seconds > 0),
  clear_on_success boolean not null
);

insert into private.rate_limit_policies (
  bucket, attempt_limit, window_seconds, block_seconds, clear_on_success
) values
  ('login-ip-volume', 30, 900, 1800, false),
  ('login-account-failure', 5, 900, 900, true),
  ('reauth-ip-volume', 20, 900, 1800, false),
  ('reauth-account-failure', 5, 900, 900, true),
  ('forgot-ip-volume', 10, 900, 60, false),
  ('forgot-account-volume', 3, 3600, 60, false);

create table private.rate_limit_buckets (
  bucket text not null references private.rate_limit_policies(bucket) on delete restrict,
  key_hash text not null,
  attempts integer not null check (attempts > 0),
  window_started_at timestamptz not null,
  blocked_until timestamptz,
  updated_at timestamptz not null,
  primary key (bucket, key_hash),
  constraint rate_limit_buckets_key_hash_format check (
    key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint rate_limit_buckets_block_order check (
    blocked_until is null or blocked_until >= window_started_at
  )
);

create table private.auth_user_session_cutoffs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revoked_before timestamptz not null,
  updated_at timestamptz not null
);

create table private.auth_session_controls (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_created_at timestamptz not null,
  remember_me boolean not null,
  state private.auth_session_state not null default 'pending',
  absolute_expires_at timestamptz not null,
  audit_scope public.audit_scope,
  audit_company_id uuid references public.companies(id) on delete restrict,
  activated_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint auth_session_controls_expiry_order check (
    absolute_expires_at > auth_created_at
  ),
  constraint auth_session_controls_lifecycle check (
    (state = 'pending' and activated_at is null and revoked_at is null
      and audit_scope is null and audit_company_id is null)
    or (state = 'active' and activated_at is not null and revoked_at is null
      and audit_scope is not null
      and (
        (audit_scope = 'platform' and audit_company_id is null)
        or (audit_scope = 'tenant' and audit_company_id is not null)
      ))
    or (state = 'revoked' and revoked_at is not null
      and (activated_at is null or activated_at <= revoked_at)
      and (
        (activated_at is null and audit_scope is null and audit_company_id is null)
        or (activated_at is not null and audit_scope is not null
          and (
            (audit_scope = 'platform' and audit_company_id is null)
            or (audit_scope = 'tenant' and audit_company_id is not null)
          ))
      ))
  ),
  constraint auth_session_controls_last_seen_order check (
    last_seen_at is null or last_seen_at >= auth_created_at
  )
);

create index audit_events_actor_user_id_idx
  on public.audit_events(actor_user_id);
create index audit_events_company_id_idx
  on public.audit_events(company_id);
create index audit_events_tenant_keyset_idx
  on public.audit_events(company_id, occurred_at desc, id desc)
  where scope = 'tenant';
create index audit_events_platform_keyset_idx
  on public.audit_events(occurred_at desc, id desc)
  where scope = 'platform';
create index audit_events_correlation_id_idx
  on public.audit_events(correlation_id);
create index security_events_user_id_idx
  on public.security_events(user_id);
create index security_events_keyset_idx
  on public.security_events(event_type, occurred_at desc, id desc);
create index security_events_correlation_id_idx
  on public.security_events(correlation_id);
create index idempotency_keys_company_id_idx
  on public.idempotency_keys(company_id);
create index idempotency_keys_expires_at_idx
  on public.idempotency_keys(expires_at);
create index rate_limit_buckets_updated_at_idx
  on private.rate_limit_buckets(updated_at);
create index auth_user_session_cutoffs_revoked_before_idx
  on private.auth_user_session_cutoffs(revoked_before);
create index auth_session_controls_user_id_idx
  on private.auth_session_controls(user_id);
create index auth_session_controls_audit_company_id_idx
  on private.auth_session_controls(audit_company_id);
create index auth_session_controls_active_idx
  on private.auth_session_controls(user_id, absolute_expires_at, session_id)
  where state = 'active';
create index auth_session_controls_pending_idx
  on private.auth_session_controls(user_id, auth_created_at, session_id)
  where state = 'pending';

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.security_events enable row level security;
alter table public.security_events force row level security;
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
alter table private.rate_limit_policies enable row level security;
alter table private.rate_limit_policies force row level security;
alter table private.rate_limit_buckets enable row level security;
alter table private.rate_limit_buckets force row level security;
alter table private.auth_user_session_cutoffs enable row level security;
alter table private.auth_user_session_cutoffs force row level security;
alter table private.auth_session_controls enable row level security;
alter table private.auth_session_controls force row level security;

revoke all on public.audit_events, public.security_events, public.idempotency_keys
  from public, anon, authenticated, service_role, axsys_bff;
revoke all on private.rate_limit_policies, private.rate_limit_buckets,
  private.auth_user_session_cutoffs, private.auth_session_controls
  from public, anon, authenticated, service_role, axsys_bff;

drop trigger platform_roles_serialize_identity_invariants on public.platform_roles;
create trigger platform_roles_serialize_identity_invariants
before insert or update of user_id, is_active or delete on public.platform_roles
for each statement execute function private.serialize_identity_invariants();

create trigger profiles_serialize_auth_scope
before update of must_change_password, temporary_password_expires_at, is_active
on public.profiles
for each statement execute function private.serialize_identity_invariants();

create trigger companies_serialize_auth_scope
before update of status on public.companies
for each statement execute function private.serialize_identity_invariants();

create function private.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
) returns table (
  allowed boolean,
  attempts integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.rate_limit_policies%rowtype;
  v_bucket private.rate_limit_buckets%rowtype;
  v_now timestamptz;
  v_inserted boolean;
begin
  if p_bucket is null
     or p_key_hash is null
     or p_limit is null
     or p_window_seconds is null
     or p_block_seconds is null then
    raise exception using errcode = '22023', message = 'rate_limit_input_invalid';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'rate_limit_key_hash_invalid';
  end if;

  select policy.* into v_policy
  from private.rate_limit_policies policy
  where policy.bucket = p_bucket;
  if not found then
    raise exception using errcode = '22023', message = 'rate_limit_policy_unknown';
  end if;
  if (p_limit, p_window_seconds, p_block_seconds)
     is distinct from
     (v_policy.attempt_limit, v_policy.window_seconds, v_policy.block_seconds) then
    raise exception using errcode = '22023', message = 'rate_limit_policy_mismatch';
  end if;

  loop
    select bucket_row.* into v_bucket
    from private.rate_limit_buckets bucket_row
    where bucket_row.bucket = p_bucket
      and bucket_row.key_hash = p_key_hash
    for update;

    if found then
      v_now := clock_timestamp();
      if v_bucket.blocked_until is not null then
        if v_bucket.blocked_until > v_now then
          return query
            select false,
                   v_bucket.attempts,
                   greatest(
                     1,
                     ceil(extract(epoch from v_bucket.blocked_until - v_now))::integer
                   );
          return;
        end if;
        update private.rate_limit_buckets bucket_row
        set attempts = 1,
            window_started_at = v_now,
            blocked_until = null,
            updated_at = v_now
        where bucket_row.bucket = p_bucket
          and bucket_row.key_hash = p_key_hash;
        return query select true, 1, 0;
        return;
      elsif v_now >= v_bucket.window_started_at
            + make_interval(secs => v_policy.window_seconds) then
        update private.rate_limit_buckets bucket_row
        set attempts = 1,
            window_started_at = v_now,
            blocked_until = null,
            updated_at = v_now
        where bucket_row.bucket = p_bucket
          and bucket_row.key_hash = p_key_hash;
        return query select true, 1, 0;
        return;
      elsif v_bucket.attempts < v_policy.attempt_limit then
        update private.rate_limit_buckets bucket_row
        set attempts = bucket_row.attempts + 1,
            blocked_until = null,
            updated_at = v_now
        where bucket_row.bucket = p_bucket
          and bucket_row.key_hash = p_key_hash;
        return query select true, v_bucket.attempts + 1, 0;
        return;
      else
        update private.rate_limit_buckets bucket_row
        set attempts = bucket_row.attempts + 1,
            blocked_until = v_now + make_interval(secs => v_policy.block_seconds),
            updated_at = v_now
        where bucket_row.bucket = p_bucket
          and bucket_row.key_hash = p_key_hash;
        return query select false, v_bucket.attempts + 1, v_policy.block_seconds;
        return;
      end if;
    end if;

    v_now := clock_timestamp();
    insert into private.rate_limit_buckets (
      bucket, key_hash, attempts, window_started_at, blocked_until, updated_at
    ) values (
      p_bucket, p_key_hash, 1, v_now, null, v_now
    ) on conflict (bucket, key_hash) do nothing
    returning true into v_inserted;
    if v_inserted then
      return query select true, 1, 0;
      return;
    end if;
  end loop;
end;
$$;

create function private.clear_rate_limit(
  p_bucket text,
  p_key_hash text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clear_on_success boolean;
begin
  if p_bucket is null or p_key_hash is null then
    raise exception using errcode = '22023', message = 'rate_limit_input_invalid';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'rate_limit_key_hash_invalid';
  end if;
  select policy.clear_on_success into v_clear_on_success
  from private.rate_limit_policies policy
  where policy.bucket = p_bucket;
  if not found
     or p_bucket not in ('login-account-failure', 'reauth-account-failure')
     or not v_clear_on_success then
    raise exception using errcode = '22023', message = 'rate_limit_clear_forbidden';
  end if;

  delete from private.rate_limit_buckets bucket_row
  where bucket_row.bucket = p_bucket
    and bucket_row.key_hash = p_key_hash;
end;
$$;

revoke execute on function private.consume_rate_limit(text,text,integer,integer,integer)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.consume_rate_limit(text,text,integer,integer,integer)
  to axsys_bff;
revoke execute on function private.clear_rate_limit(text,text)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.clear_rate_limit(text,text) to axsys_bff;

create function private.register_auth_session(
  p_session_id uuid,
  p_user_id uuid,
  p_remember_me boolean
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_auth_created_at timestamptz;
  v_auth_not_after timestamptz;
  v_absolute_expires_at timestamptz;
  v_existing private.auth_session_controls%rowtype;
  v_cutoff timestamptz;
begin
  if p_session_id is null or p_user_id is null or p_remember_me is null then
    raise exception using errcode = '22023', message = 'auth_session_input_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1673));

  select session_row.user_id, session_row.created_at, session_row.not_after
  into v_auth_user_id, v_auth_created_at, v_auth_not_after
  from auth.sessions session_row
  where session_row.id = p_session_id
  for share;
  if not found
     or v_auth_user_id is distinct from p_user_id
     or v_auth_created_at is null then
    raise exception using errcode = '23514', message = 'auth_session_mismatch';
  end if;

  select cutoff.revoked_before into v_cutoff
  from private.auth_user_session_cutoffs cutoff
  where cutoff.user_id = p_user_id
  for update;
  if found and v_auth_created_at <= v_cutoff then
    raise exception using errcode = '23514', message = 'auth_session_cutoff';
  end if;

  v_absolute_expires_at := v_auth_created_at
    + case when p_remember_me then interval '30 days' else interval '8 hours' end;
  if v_auth_not_after is not null then
    v_absolute_expires_at := least(v_absolute_expires_at, v_auth_not_after);
  end if;
  if v_absolute_expires_at <= clock_timestamp() then
    raise exception using errcode = '23514', message = 'auth_session_expired';
  end if;

  insert into private.auth_session_controls (
    session_id,
    user_id,
    auth_created_at,
    remember_me,
    state,
    absolute_expires_at,
    created_at,
    updated_at
  ) values (
    p_session_id,
    p_user_id,
    v_auth_created_at,
    p_remember_me,
    'pending',
    v_absolute_expires_at,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (session_id) do nothing;

  if not found then
    select control.* into v_existing
    from private.auth_session_controls control
    where control.session_id = p_session_id
    for update;
    if v_existing.user_id is distinct from p_user_id
       or v_existing.auth_created_at is distinct from v_auth_created_at
       or v_existing.remember_me is distinct from p_remember_me
       or v_existing.state is distinct from 'pending'::private.auth_session_state
       or v_existing.absolute_expires_at is distinct from v_absolute_expires_at
       or (v_cutoff is not null and v_existing.auth_created_at <= v_cutoff) then
      raise exception using errcode = '23514', message = 'auth_session_replay_invalid';
    end if;
    return v_existing.absolute_expires_at;
  end if;

  return v_absolute_expires_at;
end;
$$;

create function private.assert_auth_session(
  p_session_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  if p_session_id is null or p_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1673));
  update private.auth_session_controls control
  set last_seen_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where control.session_id = p_session_id
    and control.user_id = p_user_id
    and control.state = 'active'
    and control.revoked_at is null
    and control.absolute_expires_at > clock_timestamp()
    and exists (
      select 1 from auth.sessions auth_session
      where auth_session.id = control.session_id
        and auth_session.user_id = control.user_id
        and auth_session.created_at = control.auth_created_at
        and (auth_session.not_after is null
          or auth_session.not_after > clock_timestamp())
    )
    and not exists (
      select 1 from private.auth_user_session_cutoffs cutoff
      where cutoff.user_id = control.user_id
        and control.auth_created_at <= cutoff.revoked_before
    )
  returning true into v_valid;
  return coalesce(v_valid, false);
end;
$$;

create function private.revoke_auth_sessions(
  p_user_id uuid,
  p_except_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_revoked integer;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'auth_session_input_invalid';
  end if;
  if p_except_session_id is not null then
    raise exception using errcode = '22023', message = 'auth_session_except_forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1673));
  v_now := clock_timestamp();
  insert into private.auth_user_session_cutoffs (user_id, revoked_before, updated_at)
  values (p_user_id, v_now, v_now)
  on conflict (user_id) do update
  set revoked_before = greatest(
        private.auth_user_session_cutoffs.revoked_before,
        excluded.revoked_before
      ),
      updated_at = excluded.updated_at;

  update private.auth_session_controls control
  set state = 'revoked',
      revoked_at = v_now,
      updated_at = v_now
  where control.user_id = p_user_id
    and control.state in ('pending', 'active');
  get diagnostics v_revoked = row_count;
  return v_revoked;
end;
$$;

revoke execute on function private.register_auth_session(uuid,uuid,boolean)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.register_auth_session(uuid,uuid,boolean)
  to axsys_bff;
revoke execute on function private.assert_auth_session(uuid,uuid)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.assert_auth_session(uuid,uuid) to axsys_bff;
revoke execute on function private.revoke_auth_sessions(uuid,uuid)
  from public, anon, authenticated, service_role, axsys_bff;

create function private.resolve_audit_identity(
  p_user_id uuid
) returns table (
  resolved_scope public.audit_scope,
  resolved_company_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_scope text;
  v_company_ids uuid[];
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.user_id = p_user_id
      and profile.is_active
      and (
        not profile.must_change_password
        or profile.temporary_password_expires_at > clock_timestamp()
      )
  ) then
    raise exception using errcode = '23514', message = 'auth_profile_inactive';
  end if;

  with identities as (
    select 'platform'::text as scope, null::uuid as company_id
    from public.platform_roles platform_role
    where platform_role.user_id = p_user_id
      and platform_role.is_active
    union all
    select 'tenant'::text, membership.company_id
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = p_user_id
      and membership.status = 'active'
      and company.status = 'active'
  )
  select count(*)::integer, max(identities.scope), array_agg(identities.company_id)
  into v_count, v_scope, v_company_ids
  from identities;

  if v_count <> 1 then
    raise exception using errcode = '23514', message = 'auth_identity_invalid';
  end if;
  return query
    select v_scope::public.audit_scope, v_company_ids[1];
end;
$$;

create function private.reject_append_only_mutation() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'append_only_table';
end;
$$;

create trigger audit_events_append_only
before update or delete or truncate on public.audit_events
for each statement execute function private.reject_append_only_mutation();
create trigger security_events_append_only
before update or delete or truncate on public.security_events
for each statement execute function private.reject_append_only_mutation();

create function private.guard_idempotency_key_update() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.company_id is distinct from old.company_id
     or new.operation is distinct from old.operation
     or new.key_hash is distinct from old.key_hash
     or new.request_hash is distinct from old.request_hash
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'idempotency_identity_immutable';
  end if;
  if old.state <> 'processing'
     or new.state not in ('completed', 'failed') then
    raise exception using errcode = '55000', message = 'idempotency_transition_invalid';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger idempotency_keys_guard_update
before update on public.idempotency_keys
for each row execute function private.guard_idempotency_key_update();

create function private.guard_auth_session_control_update() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.user_id is distinct from old.user_id
     or new.auth_created_at is distinct from old.auth_created_at
     or new.remember_me is distinct from old.remember_me
     or new.absolute_expires_at is distinct from old.absolute_expires_at
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'auth_session_identity_immutable';
  end if;
  if old.state = 'revoked' then
    raise exception using errcode = '55000', message = 'auth_session_terminal';
  end if;
  if new.updated_at < old.updated_at
     or (
       old.state = 'pending'
       and not (
         (new.state = 'active'
           and old.activated_at is null
           and new.activated_at is not null
           and new.revoked_at is null
           and new.last_seen_at is not null
           and new.audit_scope is not null)
         or (new.state = 'revoked'
           and new.activated_at is null
           and new.revoked_at is not null
           and new.last_seen_at is not distinct from old.last_seen_at
           and new.audit_scope is null
           and new.audit_company_id is null)
       )
     )
     or (
       old.state = 'active'
       and not (
         (new.state = 'active'
           and new.activated_at is not distinct from old.activated_at
           and new.revoked_at is null
           and new.audit_scope is not distinct from old.audit_scope
           and new.audit_company_id is not distinct from old.audit_company_id
           and new.last_seen_at is not null
           and (old.last_seen_at is null or new.last_seen_at >= old.last_seen_at))
         or (new.state = 'revoked'
           and new.activated_at is not distinct from old.activated_at
           and new.revoked_at is not null
           and new.revoked_at >= new.activated_at
           and new.audit_scope is not distinct from old.audit_scope
           and new.audit_company_id is not distinct from old.audit_company_id
           and new.last_seen_at is not distinct from old.last_seen_at)
       )
     ) then
    raise exception using errcode = '55000', message = 'auth_session_transition_invalid';
  end if;
  return new;
end;
$$;

create trigger auth_session_controls_guard_update
before update on private.auth_session_controls
for each row execute function private.guard_auth_session_control_update();

revoke execute on function private.resolve_audit_identity(uuid),
  private.reject_append_only_mutation(),
  private.guard_idempotency_key_update(),
  private.guard_auth_session_control_update()
  from public, anon, authenticated, service_role, axsys_bff;

create function private.write_authenticated_audit_event(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_outcome public.audit_outcome,
  p_reason_code text,
  p_correlation_id uuid,
  p_ip_hash text,
  p_user_agent_hash text,
  p_metadata jsonb
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
  v_scope public.audit_scope;
  v_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_correlation_id is null
     or p_action is distinct from 'auth.login'
     or p_resource_type is distinct from 'session'
     or p_resource_id is not null
     or p_outcome is distinct from 'success'::public.audit_outcome
     or p_reason_code is not null
     or p_metadata is null
     or jsonb_typeof(p_metadata) <> 'object'
     or octet_length(p_metadata::text) > 16384
     or not (
       p_metadata = '{}'::jsonb
       or (
         (select count(*) from jsonb_object_keys(p_metadata)) = 1
         and p_metadata ? 'rememberMe'
         and jsonb_typeof(p_metadata -> 'rememberMe') = 'boolean'
       )
     )
     or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
     or (p_user_agent_hash is not null
       and p_user_agent_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'audit_event_invalid';
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
     or v_control.state <> 'pending'
     or v_control.absolute_expires_at <= v_now
     or (p_metadata ? 'rememberMe'
       and (p_metadata ->> 'rememberMe')::boolean <> v_control.remember_me)
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = v_control.user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using errcode = '23514', message = 'auth_login_session_invalid';
  end if;

  select identity.resolved_scope, identity.resolved_company_id
  into v_scope, v_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;
  perform set_config('app.actor_id', p_actor_user_id::text, true);

  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, ip_hash, user_agent_hash, metadata,
    occurred_at
  ) values (
    v_scope, v_company_id, p_actor_user_id, p_action, p_resource_type,
    p_resource_id, p_outcome, p_reason_code, p_correlation_id, p_ip_hash,
    p_user_agent_hash, p_metadata, v_now
  );
  update private.auth_session_controls control
  set state = 'active',
      audit_scope = v_scope,
      audit_company_id = v_company_id,
      activated_at = v_now,
      last_seen_at = v_now,
      updated_at = v_now
  where control.session_id = p_session_id
    and control.state = 'pending';
  if not found then
    raise exception using errcode = '40001', message = 'auth_login_activation_lost';
  end if;
end;
$$;

create function private.write_security_event(
  p_event_type text,
  p_user_id uuid,
  p_email_hash text,
  p_ip_hash text,
  p_outcome public.audit_outcome,
  p_reason_code text,
  p_correlation_id uuid,
  p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := '{}'::jsonb;
  v_attempts numeric;
  v_retry_after numeric;
begin
  if p_user_id is not null
     or p_event_type is null
     or p_outcome is null
     or p_correlation_id is null
     or p_metadata is null
     or jsonb_typeof(p_metadata) <> 'object'
     or octet_length(p_metadata::text) > 16384
     or (p_email_hash is not null and p_email_hash !~ '^[0-9a-f]{64}$')
     or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
     or exists (
       select 1 from jsonb_object_keys(p_metadata) key_name
       where key_name not in ('attempts', 'retryAfterSeconds')
     ) then
    raise exception using errcode = '22023', message = 'security_event_invalid';
  end if;

  if p_metadata ? 'attempts' then
    if jsonb_typeof(p_metadata -> 'attempts') <> 'number'
       or (p_metadata ->> 'attempts') !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '22023', message = 'security_metadata_invalid';
    end if;
    v_attempts := (p_metadata ->> 'attempts')::numeric;
    if v_attempts > 1000000 then
      raise exception using errcode = '22023', message = 'security_metadata_invalid';
    end if;
    v_metadata := v_metadata || jsonb_build_object('attempts', v_attempts::integer);
  end if;
  if p_metadata ? 'retryAfterSeconds' then
    if jsonb_typeof(p_metadata -> 'retryAfterSeconds') <> 'number'
       or (p_metadata ->> 'retryAfterSeconds') !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = '22023', message = 'security_metadata_invalid';
    end if;
    v_retry_after := (p_metadata ->> 'retryAfterSeconds')::numeric;
    if v_retry_after > 86400 then
      raise exception using errcode = '22023', message = 'security_metadata_invalid';
    end if;
    v_metadata := v_metadata
      || jsonb_build_object('retryAfterSeconds', v_retry_after::integer);
  end if;

  if (
    (p_event_type = 'auth.login.failed' and (
      (p_outcome = 'denied' and p_reason_code = 'AUTH_INVALID_CREDENTIALS')
      or (p_outcome = 'failure' and p_reason_code = 'AUTH_PROVIDER_FAILURE')
    ))
    or (p_event_type = 'auth.login.rate_limited'
      and p_outcome = 'denied'
      and p_reason_code in ('IP_RATE_LIMITED', 'ACCOUNT_RATE_LIMITED'))
    or (p_event_type = 'auth.reauthentication.failed' and (
      (p_outcome = 'denied' and p_reason_code = 'AUTH_INVALID_CREDENTIALS')
      or (p_outcome = 'failure' and p_reason_code = 'AUTH_PROVIDER_FAILURE')
    ))
    or (p_event_type = 'auth.reauthentication.rate_limited'
      and p_outcome = 'denied'
      and p_reason_code in ('IP_RATE_LIMITED', 'ACCOUNT_RATE_LIMITED'))
    or (p_event_type = 'auth.password_recovery.requested'
      and p_outcome = 'success' and p_reason_code is null)
    or (p_event_type = 'auth.password_recovery.failed'
      and p_outcome = 'failure' and p_reason_code = 'AUTH_PROVIDER_FAILURE')
    or (p_event_type = 'auth.password_recovery.rate_limited'
      and p_outcome = 'denied'
      and p_reason_code in ('IP_RATE_LIMITED', 'ACCOUNT_RATE_LIMITED'))
  ) is not true then
    raise exception using errcode = '22023', message = 'security_event_vocabulary_invalid';
  end if;

  insert into public.security_events (
    event_type, user_id, email_hash, ip_hash, outcome, reason_code,
    correlation_id, metadata
  ) values (
    p_event_type, null, p_email_hash, p_ip_hash, p_outcome, p_reason_code,
    p_correlation_id, v_metadata
  );
end;
$$;

create function private.revoke_sessions_and_write_logout(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_correlation_id uuid,
  p_ip_hash text,
  p_user_agent_hash text
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
  v_scope public.audit_scope;
  v_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null or p_correlation_id is null
     or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
     or (p_user_agent_hash is not null
       and p_user_agent_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'auth_logout_input_invalid';
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
       where cutoff.user_id = v_control.user_id
         and v_control.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using errcode = '23514', message = 'auth_logout_session_invalid';
  end if;
  v_scope := v_control.audit_scope;
  v_company_id := v_control.audit_company_id;
  if v_scope is null then
    raise exception using errcode = '23514', message = 'auth_logout_scope_missing';
  end if;
  perform set_config('app.actor_id', p_actor_user_id::text, true);

  insert into private.auth_user_session_cutoffs (user_id, revoked_before, updated_at)
  values (p_actor_user_id, v_now, v_now)
  on conflict (user_id) do update
  set revoked_before = greatest(
        private.auth_user_session_cutoffs.revoked_before,
        excluded.revoked_before
      ),
      updated_at = excluded.updated_at;
  update private.auth_session_controls control
  set state = 'revoked', revoked_at = v_now, updated_at = v_now
  where control.user_id = p_actor_user_id
    and control.state in ('pending', 'active');
  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, ip_hash, user_agent_hash, metadata,
    occurred_at
  ) values (
    v_scope, v_company_id, p_actor_user_id, 'auth.logout', 'session', null,
    'success', null, p_correlation_id, p_ip_hash, p_user_agent_hash, '{}', v_now
  );
end;
$$;

create function private.fail_closed_login_session(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reason_code text,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null or p_correlation_id is null
     or p_reason_code is null
     or p_reason_code not in (
       'AUTH_CONTEXT_RESOLUTION_FAILED',
       'AUTH_AUDIT_ACTIVATION_FAILED',
       'TEMPORARY_PASSWORD_EXPIRED'
     ) then
    raise exception using errcode = '22023', message = 'auth_fail_closed_input_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  v_now := clock_timestamp();
  update private.auth_session_controls control
  set state = 'revoked', revoked_at = v_now, updated_at = v_now
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
    and control.state in ('pending', 'active')
    and exists (
      select 1 from auth.sessions auth_session
      where auth_session.id = control.session_id
        and auth_session.user_id = control.user_id
        and auth_session.created_at = control.auth_created_at
    );
  if not found then
    raise exception using errcode = '23514', message = 'auth_fail_closed_session_invalid';
  end if;
end;
$$;

create function private.rotate_app_session_after_reauthentication(
  p_actor_user_id uuid,
  p_old_session_id uuid,
  p_new_session_id uuid,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old private.auth_session_controls%rowtype;
  v_auth_row record;
  v_old_auth_user_id uuid;
  v_old_auth_created_at timestamptz;
  v_old_auth_not_after timestamptz;
  v_old_auth_found boolean := false;
  v_new_auth_user_id uuid;
  v_new_auth_created_at timestamptz;
  v_new_auth_not_after timestamptz;
  v_new_auth_found boolean := false;
  v_new_absolute_expires_at timestamptz;
  v_scope public.audit_scope;
  v_company_id uuid;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_old_session_id is null
     or p_new_session_id is null or p_correlation_id is null
     or p_old_session_id = p_new_session_id then
    raise exception using errcode = '22023', message = 'auth_reauthentication_input_invalid';
  end if;
  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  for v_auth_row in
    select auth_session.id, auth_session.user_id,
           auth_session.created_at, auth_session.not_after
    from auth.sessions auth_session
    where auth_session.id in (p_old_session_id, p_new_session_id)
    order by auth_session.id
    for share
  loop
    if v_auth_row.id = p_old_session_id then
      v_old_auth_user_id := v_auth_row.user_id;
      v_old_auth_created_at := v_auth_row.created_at;
      v_old_auth_not_after := v_auth_row.not_after;
      v_old_auth_found := true;
    else
      v_new_auth_user_id := v_auth_row.user_id;
      v_new_auth_created_at := v_auth_row.created_at;
      v_new_auth_not_after := v_auth_row.not_after;
      v_new_auth_found := true;
    end if;
  end loop;
  select control.* into v_old
  from private.auth_session_controls control
  where control.session_id = p_old_session_id
    and control.user_id = p_actor_user_id
  for update;
  v_now := clock_timestamp();
  if not found
     or not v_old_auth_found
     or v_old_auth_user_id is distinct from p_actor_user_id
     or v_old_auth_created_at is null
     or v_old.auth_created_at is distinct from v_old_auth_created_at
     or (v_old_auth_not_after is not null and v_old_auth_not_after <= v_now)
     or v_old.state <> 'active'
     or v_old.absolute_expires_at <= v_now
     or exists (
       select 1 from private.auth_user_session_cutoffs cutoff
       where cutoff.user_id = v_old.user_id
         and v_old.auth_created_at <= cutoff.revoked_before
     ) then
    raise exception using errcode = '23514', message = 'auth_reauthentication_session_invalid';
  end if;

  if not v_new_auth_found
     or v_new_auth_user_id is distinct from p_actor_user_id
     or v_new_auth_created_at is null
     or v_new_auth_created_at <= v_old.auth_created_at
     or exists (
       select 1 from private.auth_session_controls control
       where control.session_id = p_new_session_id
     ) then
    raise exception using errcode = '23514', message = 'auth_reauthentication_target_invalid';
  end if;
  v_new_absolute_expires_at := v_new_auth_created_at
    + case when v_old.remember_me then interval '30 days' else interval '8 hours' end;
  if v_new_auth_not_after is not null then
    v_new_absolute_expires_at := least(
      v_new_absolute_expires_at,
      v_new_auth_not_after
    );
  end if;
  if v_new_absolute_expires_at <= v_now then
    raise exception using errcode = '23514', message = 'auth_reauthentication_target_expired';
  end if;

  select identity.resolved_scope, identity.resolved_company_id
  into v_scope, v_company_id
  from private.resolve_audit_identity(p_actor_user_id) identity;
  perform set_config('app.actor_id', p_actor_user_id::text, true);
  insert into private.auth_session_controls (
    session_id, user_id, auth_created_at, remember_me, state,
    absolute_expires_at, audit_scope, audit_company_id,
    activated_at, last_seen_at, created_at, updated_at
  ) values (
    p_new_session_id, p_actor_user_id, v_new_auth_created_at, v_old.remember_me,
    'active', v_new_absolute_expires_at, v_scope, v_company_id,
    v_now, v_now, v_now, v_now
  );
  update private.auth_session_controls control
  set state = 'revoked', revoked_at = v_now, updated_at = v_now
  where control.session_id = p_old_session_id and control.state = 'active';
  if not found then
    raise exception using errcode = '40001', message = 'auth_reauthentication_lost';
  end if;
  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    v_scope, v_company_id, p_actor_user_id, 'auth.reauthenticated', 'session',
    null, 'success', null, p_correlation_id, '{}', v_now
  );
end;
$$;

revoke execute on function private.write_authenticated_audit_event(
  uuid,uuid,text,text,uuid,public.audit_outcome,text,uuid,text,text,jsonb
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.write_authenticated_audit_event(
  uuid,uuid,text,text,uuid,public.audit_outcome,text,uuid,text,text,jsonb
) to axsys_bff;
revoke execute on function private.write_security_event(
  text,uuid,text,text,public.audit_outcome,text,uuid,jsonb
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.write_security_event(
  text,uuid,text,text,public.audit_outcome,text,uuid,jsonb
) to axsys_bff;
revoke execute on function private.revoke_sessions_and_write_logout(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.revoke_sessions_and_write_logout(
  uuid,uuid,uuid,text,text
) to axsys_bff;
revoke execute on function private.fail_closed_login_session(uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.fail_closed_login_session(uuid,uuid,text,uuid)
  to axsys_bff;
revoke execute on function private.rotate_app_session_after_reauthentication(
  uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.rotate_app_session_after_reauthentication(
  uuid,uuid,uuid,uuid
) to axsys_bff;
