do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'AXSYS_MEMBERSHIP_MIGRATION_OWNER_INVALID';
  end if;
end
$$;

create table private.member_auth_access_reconciliations (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.company_memberships(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  desired_state text not null check (desired_state in ('active','banned')),
  generation bigint not null check (generation > 0),
  status text not null default 'pending' check (status in ('pending','completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  operation_correlation_id uuid not null unique,
  last_completion_correlation_id uuid,
  last_error_code text check (
    last_error_code is null or last_error_code in (
      'AUTH_ADMIN_FAILED','AUTH_ADMIN_TIMEOUT','AUTH_ADMIN_UNAVAILABLE',
      'AUTH_ADMIN_STALE_EFFECT'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  constraint member_auth_access_reconciliation_lifecycle check (
    (status='pending' and completed_at is null)
    or (status='completed' and completed_at is not null and last_error_code is null)
  ),
  unique (membership_id,generation)
);
create unique index member_auth_access_reconciliations_one_pending_idx
on private.member_auth_access_reconciliations(membership_id)
where status='pending';
create index member_auth_access_reconciliations_health_idx
on private.member_auth_access_reconciliations(status,updated_at)
where status='pending';
alter table private.member_auth_access_reconciliations enable row level security;
alter table private.member_auth_access_reconciliations force row level security;
revoke all on private.member_auth_access_reconciliations
from public,anon,authenticated,service_role,axsys_bff;

create function private.reopen_member_auth_after_company_reconciliation()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if new.status='complete' and new.target_status='active'::public.company_status
     and (old.status is distinct from new.status
       or old.last_completion_correlation_id is distinct from new.last_completion_correlation_id) then
    update private.member_auth_access_reconciliations reconciliation
    set desired_state='banned',status='pending',
        attempt_count=reconciliation.attempt_count+1,
        last_completion_correlation_id=new.last_completion_correlation_id,
        last_error_code='AUTH_ADMIN_STALE_EFFECT',
        updated_at=pg_catalog.clock_timestamp(),completed_at=null
    from public.company_memberships membership
    join public.profiles profile on profile.user_id=membership.user_id
    where membership.company_id=new.company_id
      and membership.user_id=any(new.affected_user_ids)
      and (membership.status='suspended'::public.membership_status or not profile.is_active)
      and reconciliation.membership_id=membership.id
      and reconciliation.id=(
        select latest.id
        from private.member_auth_access_reconciliations latest
        where latest.membership_id=membership.id
        order by latest.generation desc
        limit 1
      );
  end if;
  return new;
end;
$$;
create trigger company_reconciliation_reopens_member_auth
after update on private.company_access_reconciliations
for each row execute function private.reopen_member_auth_after_company_reconciliation();
revoke execute on function private.reopen_member_auth_after_company_reconciliation()
from public,anon,authenticated,service_role,axsys_bff;

create function private.assert_company_admin_session(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  if p_actor_user_id is null or p_session_id is null then
    raise exception using errcode = '22023',
      message = 'AXSYS_MEMBERSHIP_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);
  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ADMIN_REQUIRED';
  end if;

  select membership.company_id
  into v_company_id
  from public.company_memberships membership
  join public.companies company on company.id = membership.company_id
  join public.profiles profile on profile.user_id = membership.user_id
  join private.auth_session_controls control
    on control.session_id = p_session_id
   and control.user_id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.role = 'company_admin'::public.membership_role
    and membership.status = 'active'::public.membership_status
    and company.status = 'active'::public.company_status
    and profile.is_active
    and not profile.must_change_password
    and control.state = 'active'::private.auth_session_state
    and control.audit_scope = 'tenant'::public.audit_scope
    and control.audit_company_id = membership.company_id
    and control.revoked_at is null
    and (p_company_id is null or membership.company_id = p_company_id);

  if not found then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ADMIN_REQUIRED';
  end if;
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  return v_company_id;
end;
$$;

create function private.assert_authenticated_company_admin()
returns table (actor_user_id uuid, company_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
begin
  begin
    v_actor_user_id := (select auth.uid());
  exception when invalid_text_representation then
    v_actor_user_id := null;
  end;
  if v_actor_user_id is null then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ADMIN_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);
  if not private.has_active_app_session() then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ADMIN_REQUIRED';
  end if;

  select membership.company_id
  into v_company_id
  from public.company_memberships membership
  join public.companies company on company.id = membership.company_id
  where membership.user_id = v_actor_user_id
    and membership.role = 'company_admin'::public.membership_role
    and membership.status = 'active'::public.membership_status
    and company.status = 'active'::public.company_status;
  if not found then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ADMIN_REQUIRED';
  end if;

  perform pg_catalog.set_config('app.actor_id', v_actor_user_id::text, true);
  return query select v_actor_user_id, v_company_id;
end;
$$;

create function private.company_user_snapshot(p_membership_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'membershipId', membership.id,
    'targetUserId', membership.user_id,
    'displayName', profile.display_name,
    'email', profile.email::text,
    'role', membership.role::text,
    'status', membership.status::text,
    'modules', coalesce((
      select pg_catalog.jsonb_agg(module.module::text order by module.module::text)
      from public.member_modules module
      where module.company_id = membership.company_id
        and module.membership_id = membership.id
    ), '[]'::jsonb),
    'version', membership.version,
    'mustChangePassword', profile.must_change_password,
    'temporaryPasswordExpiresAt', profile.temporary_password_expires_at,
    'accessState', case
      when company.status = 'archived'::public.company_status then 'archived_company'
      when membership.status = 'suspended'::public.membership_status
        or not profile.is_active then 'suspended'
      when profile.must_change_password then 'password_change_required'
      else 'active'
    end
  )
  from public.company_memberships membership
  join public.profiles profile on profile.user_id = membership.user_id
  join public.companies company on company.id = membership.company_id
  where membership.id = p_membership_id
$$;

create function private.reserve_member_provisioning_core(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_subject_email_hash text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
begin
  if p_actor_user_id is null or p_company_id is null
     or p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_subject_email_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;

  if not exists (select 1 from public.companies company
                 where company.id = p_company_id
                   and company.status = 'active'::public.company_status) then
    raise exception using errcode = '42501',
      message = 'AXSYS_COMPANY_ARCHIVED';
  end if;

  insert into public.provisioning_operations (
    idempotency_key, request_hash, kind, actor_user_id, company_id,
    subject_email_hash, status, correlation_id
  ) values (
    p_idempotency_key, p_request_hash, 'company_member', p_actor_user_id,
    p_company_id, p_subject_email_hash, 'reserved', p_correlation_id
  ) on conflict (actor_user_id, idempotency_key) do nothing
  returning * into v_operation;

  if not found then
    select operation.* into v_operation
    from public.provisioning_operations operation
    where operation.actor_user_id = p_actor_user_id
      and operation.idempotency_key = p_idempotency_key
    for update;
    if not found or v_operation.kind <> 'company_member'
       or v_operation.company_id <> p_company_id
       or v_operation.request_hash <> p_request_hash
       or v_operation.subject_email_hash <> p_subject_email_hash then
      raise exception using errcode = 'P0001',
        message = 'AXSYS_IDEMPOTENCY_KEY_REUSED';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_operation.id,
    'status', v_operation.status::text,
    'authUserId', v_operation.auth_user_id
  );
end;
$$;

create or replace function private.internal_get_company_detail(
  p_actor_user_id uuid,p_session_id uuid,p_company_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_company public.companies%rowtype; v_result jsonb;
begin
  perform private.assert_platform_provisioning_actor(p_actor_user_id,p_session_id);
  if p_company_id is null then
    raise exception using errcode='22023',message='AXSYS_COMPANY_INPUT_INVALID';
  end if;
  select company.* into v_company from public.companies company where company.id=p_company_id;
  if not found then raise exception using errcode='P0001',message='AXSYS_COMPANY_NOT_FOUND'; end if;
  select pg_catalog.jsonb_build_object(
    'company',private.company_platform_read_snapshot(v_company),
    'admins',coalesce((
      select pg_catalog.jsonb_agg(
        private.company_user_snapshot(membership.id)
          || pg_catalog.jsonb_build_object('id',membership.id)
        order by pg_catalog.lower(profile.display_name),membership.id
      )
      from public.company_memberships membership
      join public.profiles profile on profile.user_id=membership.user_id
      where membership.company_id=p_company_id and membership.role='company_admin'
    ),'[]'::jsonb),
    'bankAccounts',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',bank.id,'bankCode',bank.bank_code,'bankName',bank.bank_name,
        'branchLast4',bank.branch_last4,'accountLast4',bank.account_last4,
        'accountType',bank.account_type::text,'isDefault',bank.is_default,
        'status',bank.status::text,'version',bank.version
      ) order by bank.is_default desc,pg_catalog.lower(bank.bank_name),bank.id)
      from public.company_bank_accounts bank
      where bank.company_id=p_company_id and bank.status='active'
    ),'[]'::jsonb),
    'counters',pg_catalog.jsonb_build_object(
      'activeAdmins',(select pg_catalog.count(*) from public.company_memberships membership
        where membership.company_id=p_company_id and membership.role='company_admin' and membership.status='active'),
      'activeUsers',(select pg_catalog.count(*) from public.company_memberships membership
        where membership.company_id=p_company_id and membership.status='active'),
      'bankAccounts',(select pg_catalog.count(*) from public.company_bank_accounts bank
        where bank.company_id=p_company_id and bank.status='active')
    )
  ) into v_result;
  return v_result;
end;
$$;

create function private.internal_reserve_company_admin_provisioning(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_subject_email_hash text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_provisioning_actor(p_actor_user_id, p_session_id);
  return private.reserve_member_provisioning_core(
    p_actor_user_id, p_company_id, p_idempotency_key, p_request_hash,
    p_subject_email_hash, p_correlation_id
  );
end;
$$;

create function public.company_reserve_member_provisioning(
  p_idempotency_key text,
  p_request_hash text,
  p_subject_email_hash text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select * into v_actor from private.assert_authenticated_company_admin();
  return private.reserve_member_provisioning_core(
    v_actor.actor_user_id, v_actor.company_id, p_idempotency_key,
    p_request_hash, p_subject_email_hash, p_correlation_id
  );
end;
$$;

create function private.assert_member_operation_actor(
  p_operation public.provisioning_operations,
  p_actor_user_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_operation.kind = 'company_first_admin'::public.provisioning_kind then
    perform private.assert_platform_provisioning_actor(p_actor_user_id, p_session_id);
  elsif p_operation.kind = 'company_member'::public.provisioning_kind then
    if exists (
      select 1 from public.platform_roles platform_role
      where platform_role.user_id=p_actor_user_id
        and platform_role.role='super_admin'::public.platform_role
        and platform_role.is_active
    ) then
      perform private.assert_platform_provisioning_actor(p_actor_user_id,p_session_id);
    else
      perform private.assert_company_admin_session(
        p_actor_user_id, p_session_id, p_operation.company_id
      );
    end if;
  else
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
end;
$$;

create or replace function private.internal_mark_provisioning_auth_created(
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
  if p_operation_id is null or p_actor_user_id is null
     or p_session_id is null or p_auth_user_id is null then
    raise exception using errcode = '22023',
      message = 'AXSYS_PROVISIONING_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text,1673)
  );
  select operation.* into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  perform private.assert_member_operation_actor(v_operation, p_actor_user_id, p_session_id);
  perform 1 from auth.users auth_user
  where auth_user.id = p_auth_user_id
    and auth_user.raw_app_meta_data->>'axsys_provisioning_operation_id'
      = p_operation_id::text
  for key share;
  if not found or exists (select 1 from public.profiles profile
                          where profile.user_id = p_auth_user_id) then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_AUTH_USER_INVALID';
  end if;
  if v_operation.status = 'auth_created' and v_operation.auth_user_id = p_auth_user_id then
    return;
  end if;
  if v_operation.status <> 'reserved' or v_operation.auth_user_id is not null
     or v_operation.last_error_code is not null then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  update public.provisioning_operations
  set auth_user_id = p_auth_user_id, status = 'auth_created',
      updated_at = pg_catalog.clock_timestamp()
  where id = p_operation_id and status = 'reserved';
  if not found then
    raise exception using errcode = '40001',
      message = 'AXSYS_PROVISIONING_TRANSITION_LOST';
  end if;
end;
$$;

create function private.internal_find_provisioning_auth_user(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_operation_id uuid,
  p_expected_email text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operation public.provisioning_operations%rowtype;
  v_candidates uuid[];
  v_candidate uuid;
begin
  if p_actor_user_id is null or p_session_id is null or p_operation_id is null
     or p_expected_email is null
     or p_expected_email <> pg_catalog.lower(pg_catalog.btrim(p_expected_email))
     or pg_catalog.char_length(p_expected_email) not between 3 and 254 then
    raise exception using errcode='22023',message='AXSYS_PROVISIONING_LOOKUP_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text,1673)
  );
  select operation.* into v_operation
  from public.provisioning_operations operation
  where operation.id=p_operation_id and operation.actor_user_id=p_actor_user_id
  for update;
  if not found or v_operation.status not in (
    'reserved'::public.provisioning_status,
    'auth_created'::public.provisioning_status,
    'compensation_required'::public.provisioning_status
  ) then
    raise exception using errcode='23514',message='AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  perform private.assert_member_operation_actor(v_operation,p_actor_user_id,p_session_id);

  select pg_catalog.array_agg(auth_user.id order by auth_user.id)
  into v_candidates
  from auth.users auth_user
  where auth_user.raw_app_meta_data->>'axsys_provisioning_operation_id'=p_operation_id::text
    and pg_catalog.lower(pg_catalog.btrim(auth_user.email))=p_expected_email;
  if coalesce(pg_catalog.cardinality(v_candidates),0)>1 then
    raise exception using errcode='23514',message='AXSYS_PROVISIONING_AUTH_USER_AMBIGUOUS';
  end if;
  v_candidate:=v_candidates[1];
  if v_candidate is null then return null; end if;
  if exists(select 1 from public.profiles profile where profile.user_id=v_candidate)
     or (v_operation.auth_user_id is not null and v_operation.auth_user_id<>v_candidate) then
    raise exception using errcode='23514',message='AXSYS_PROVISIONING_AUTH_USER_INVALID';
  end if;
  return v_candidate;
end;
$$;

create or replace function private.internal_mark_provisioning_compensation(
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
  if p_operation_id is null or p_actor_user_id is null or p_session_id is null
     or not ((p_status = 'compensated' and p_error_code = 'DB_COMMIT_FAILED')
          or (p_status = 'compensation_required' and p_error_code = 'AUTH_DELETE_FAILED')) then
    raise exception using errcode = '22023',
      message = 'AXSYS_PROVISIONING_COMPENSATION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text,1673)
  );
  select operation.* into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id and operation.actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  perform private.assert_member_operation_actor(v_operation, p_actor_user_id, p_session_id);
  if v_operation.status = p_status and v_operation.last_error_code = p_error_code then return; end if;
  if v_operation.status in ('committed','failed','compensated')
     or (p_status = 'compensation_required' and v_operation.status not in ('reserved','auth_created'))
     or (p_status = 'compensated' and v_operation.status not in ('reserved','auth_created','compensation_required')) then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  update public.provisioning_operations
  set status = p_status, last_error_code = p_error_code,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_operation_id;
end;
$$;

create function private.commit_member_provisioning_core(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_operation_id uuid,
  p_auth_user_id uuid,
  p_display_name text,
  p_email text,
  p_role public.membership_role,
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
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_operation_id is null or p_auth_user_id is null or p_actor_user_id is null
     or p_company_id is null or p_correlation_id is null
     or p_display_name is null or p_display_name <> pg_catalog.btrim(p_display_name)
     or pg_catalog.char_length(p_display_name) not between 2 and 120
     or p_email is null or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     or p_role is null or p_modules is null
     or exists (select 1 from pg_catalog.unnest(p_modules) module where module is null)
     or pg_catalog.cardinality(p_modules) <> (
       select pg_catalog.count(distinct module) from pg_catalog.unnest(p_modules) module
     ) then
    raise exception using errcode = '22023',
      message = 'AXSYS_MEMBERSHIP_INPUT_INVALID';
  end if;

  select operation.* into v_operation
  from public.provisioning_operations operation
  where operation.id = p_operation_id
    and operation.actor_user_id = p_actor_user_id
    and operation.company_id = p_company_id
    and operation.kind = 'company_member'
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  if v_operation.status = 'committed' and v_operation.auth_user_id = p_auth_user_id then
    select membership.id into v_membership_id
    from public.company_memberships membership
    where membership.company_id = p_company_id and membership.user_id = p_auth_user_id;
    return private.company_user_snapshot(v_membership_id);
  end if;
  if v_operation.status <> 'auth_created'
     or v_operation.auth_user_id <> p_auth_user_id
     or v_operation.correlation_id <> p_correlation_id then
    raise exception using errcode = '23514',
      message = 'AXSYS_PROVISIONING_OPERATION_INVALID';
  end if;
  if not exists (select 1 from public.companies company
                 where company.id = p_company_id and company.status = 'active') then
    raise exception using errcode = '42501', message = 'AXSYS_COMPANY_ARCHIVED';
  end if;
  perform 1 from auth.users auth_user
  where auth_user.id = p_auth_user_id
    and auth_user.raw_app_meta_data->>'axsys_provisioning_operation_id'
      = p_operation_id::text
    and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = p_email
  for key share;
  if not found then
    raise exception using errcode = '23514', message = 'AXSYS_PROVISIONING_AUTH_USER_INVALID';
  end if;

  insert into public.profiles (
    user_id, email, display_name, must_change_password,
    temporary_password_expires_at, is_active
  ) values (
    p_auth_user_id, p_email::extensions.citext, p_display_name, true,
    v_now + interval '24 hours', true
  );
  insert into public.company_memberships (
    company_id, user_id, role, status, created_by
  ) values (p_company_id, p_auth_user_id, p_role, 'active', p_actor_user_id)
  returning id into v_membership_id;
  insert into public.member_modules (company_id, membership_id, module, granted_by)
  select p_company_id, v_membership_id, module, p_actor_user_id
  from pg_catalog.unnest(p_modules) module;

  update public.provisioning_operations
  set status = 'committed', updated_at = v_now
  where id = p_operation_id and status = 'auth_created';
  if not found then
    raise exception using errcode = '40001', message = 'AXSYS_PROVISIONING_TRANSITION_LOST';
  end if;
  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    'tenant', p_company_id, p_actor_user_id, 'user.created', 'membership',
    v_membership_id, 'success', null, p_correlation_id,
    pg_catalog.jsonb_build_object('role',p_role::text,'modules',p_modules), v_now
  );
  return private.company_user_snapshot(v_membership_id);
end;
$$;

create function private.internal_commit_company_admin_provisioning(
  p_actor_user_id uuid, p_session_id uuid, p_operation_id uuid,
  p_auth_user_id uuid, p_company_id uuid, p_display_name text, p_email text,
  p_modules public.module_key[], p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_platform_provisioning_actor(p_actor_user_id,p_session_id);
  return private.commit_member_provisioning_core(
    p_actor_user_id,p_company_id,p_operation_id,p_auth_user_id,p_display_name,
    p_email,'company_admin',p_modules,p_correlation_id
  );
end;
$$;

create function public.company_commit_member_provisioning(
  p_operation_id uuid, p_auth_user_id uuid, p_display_name text, p_email text,
  p_role public.membership_role, p_modules public.module_key[], p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor record;
begin
  select * into v_actor from private.assert_authenticated_company_admin();
  return private.commit_member_provisioning_core(
    v_actor.actor_user_id,v_actor.company_id,p_operation_id,p_auth_user_id,
    p_display_name,p_email,p_role,p_modules,p_correlation_id
  );
end;
$$;

create function private.update_company_membership_core(
  p_actor_user_id uuid, p_company_id uuid, p_membership_id uuid,
  p_display_name text, p_role public.membership_role,
  p_status public.membership_status, p_modules public.module_key[],
  p_reason text, p_expected_version bigint, p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_target public.company_memberships%rowtype;
  v_target_user_id uuid;
  v_current_modules public.module_key[];
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reconciliation private.member_auth_access_reconciliations%rowtype;
begin
  if p_membership_id is null or p_display_name is null
     or p_display_name <> pg_catalog.btrim(p_display_name)
     or pg_catalog.char_length(p_display_name) not between 2 and 120
     or p_role is null or p_status is null or p_modules is null
     or p_expected_version is null or p_expected_version < 1
     or p_correlation_id is null
     or exists (select 1 from pg_catalog.unnest(p_modules) module where module is null)
     or pg_catalog.cardinality(p_modules) <> (
       select pg_catalog.count(distinct module) from pg_catalog.unnest(p_modules) module
     ) or (p_status = 'suspended' and (
       p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
       or pg_catalog.char_length(p_reason) not between 10 and 500
     )) or (p_status = 'active' and p_reason is not null) then
    raise exception using errcode = '22023', message = 'AXSYS_MEMBERSHIP_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  if not exists (
    select 1 from public.companies company
    where company.id=p_company_id and company.status='active'::public.company_status
  ) then
    raise exception using errcode='42501',message='AXSYS_COMPANY_ARCHIVED';
  end if;

  select membership.user_id into v_target_user_id
  from public.company_memberships membership
  where membership.id=p_membership_id and membership.company_id=p_company_id;
  if not found then
    raise exception using errcode='P0001',message='AXSYS_MEMBERSHIP_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_target_user_id::text,1673)
  );

  select membership.* into v_target
  from public.company_memberships membership
  where membership.id = p_membership_id and membership.company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AXSYS_MEMBERSHIP_NOT_FOUND';
  end if;
  select coalesce(pg_catalog.array_agg(module.module order by module.module),'{}'::public.module_key[])
  into v_current_modules from public.member_modules module
  where module.company_id = p_company_id and module.membership_id = p_membership_id;

  if v_target.user_id = p_actor_user_id and (
    v_target.role <> p_role or v_target.status <> p_status
    or v_current_modules <> p_modules
  ) then
    raise exception using errcode = '42501', message = 'AXSYS_SELF_PRIVILEGE_CHANGE';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'AXSYS_VERSION_CONFLICT';
  end if;

  update public.profiles set display_name = p_display_name,
    is_active = (p_status = 'active') where user_id = v_target.user_id;
  update public.company_memberships
  set role = p_role, status = p_status,
      suspended_at = case when p_status='suspended' then v_now else null end,
      suspended_by = case when p_status='suspended' then p_actor_user_id else null end,
      suspension_reason = case when p_status='suspended' then p_reason else null end
  where id = p_membership_id and company_id = p_company_id
    and version = p_expected_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'AXSYS_VERSION_CONFLICT';
  end if;
  delete from public.member_modules where company_id=p_company_id and membership_id=p_membership_id;
  insert into public.member_modules(company_id,membership_id,module,granted_by)
  select p_company_id,p_membership_id,module,p_actor_user_id from pg_catalog.unnest(p_modules) module;
  if p_status = 'suspended' then
    perform private.revoke_auth_sessions(v_target.user_id, null);
  end if;
  select reconciliation.* into v_reconciliation
  from private.member_auth_access_reconciliations reconciliation
  where reconciliation.membership_id=p_membership_id
    and reconciliation.status='pending'
  for update;
  if found then
    update private.member_auth_access_reconciliations reconciliation
    set desired_state=case when p_status='suspended' then 'banned' else 'active' end,
        generation=reconciliation.generation+1,
        actor_user_id=p_actor_user_id,
        operation_correlation_id=p_correlation_id,
        attempt_count=0,last_completion_correlation_id=null,last_error_code=null,
        updated_at=v_now
    where reconciliation.id=v_reconciliation.id;
  else
    insert into private.member_auth_access_reconciliations(
      membership_id,company_id,target_user_id,desired_state,actor_user_id,
      generation,operation_correlation_id,created_at,updated_at
    ) values (
      p_membership_id,p_company_id,v_target.user_id,
      case when p_status='suspended' then 'banned' else 'active' end,
      p_actor_user_id,
      coalesce((select pg_catalog.max(existing.generation)+1
        from private.member_auth_access_reconciliations existing
        where existing.membership_id=p_membership_id),1),
      p_correlation_id,v_now,v_now
    );
  end if;
  insert into public.audit_events(
    scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
    reason_code,correlation_id,metadata,occurred_at
  ) values (
    'tenant',p_company_id,p_actor_user_id,'user.updated','membership',p_membership_id,
    'success',case when p_status='suspended' then 'ADMINISTRATIVE_ACTION' else null end,
    p_correlation_id,pg_catalog.jsonb_build_object(
      'role',p_role::text,'status',p_status::text,'modules',p_modules
    ),v_now
  );
  return private.company_user_snapshot(p_membership_id);
exception when check_violation then
  if sqlerrm = 'last_active_company_admin' then
    raise exception using errcode='P0001',message='AXSYS_LAST_ACTIVE_ADMIN';
  end if;
  raise;
end;
$$;

create function private.internal_complete_member_auth_access_reconciliation(
  p_actor_user_id uuid,p_session_id uuid,p_membership_id uuid,
  p_operation_correlation_id uuid,p_succeeded boolean,p_error_code text,
  p_completion_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_reconciliation private.member_auth_access_reconciliations%rowtype;
  v_control private.auth_session_controls%rowtype;
  v_effective_desired_state text;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null or p_session_id is null or p_membership_id is null
     or p_operation_correlation_id is null or p_succeeded is null
     or p_completion_correlation_id is null
     or (p_succeeded and p_error_code is not null)
     or (not p_succeeded and p_error_code not in (
       'AUTH_ADMIN_FAILED','AUTH_ADMIN_TIMEOUT','AUTH_ADMIN_UNAVAILABLE'
     )) then
    raise exception using errcode='22023',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  if not private.assert_auth_session(p_session_id,p_actor_user_id) then
    raise exception using errcode='23514',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_SESSION_INVALID';
  end if;
  select control.* into v_control
  from private.auth_session_controls control
  where control.session_id=p_session_id and control.user_id=p_actor_user_id
    and control.state='active' and control.revoked_at is null
  for update;
  if not found or not exists (
    select 1 from public.profiles profile where profile.user_id=p_actor_user_id
      and profile.is_active and not profile.must_change_password
  ) then
    raise exception using errcode='23514',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_SESSION_INVALID';
  end if;
  select reconciliation.* into v_reconciliation
  from private.member_auth_access_reconciliations reconciliation
  where reconciliation.membership_id=p_membership_id
  order by reconciliation.generation desc
  limit 1
  for update;
  if not found then
    raise exception using errcode='P0001',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_NOT_FOUND';
  end if;
  if not (
    (v_control.audit_scope='platform' and v_control.audit_company_id is null
      and exists(select 1 from public.platform_roles role
        where role.user_id=p_actor_user_id and role.role='super_admin' and role.is_active))
    or
    (v_control.audit_scope='tenant'
      and v_control.audit_company_id=v_reconciliation.company_id
      and exists(select 1 from public.company_memberships membership
        where membership.user_id=p_actor_user_id
          and membership.company_id=v_reconciliation.company_id
          and membership.role='company_admin' and membership.status='active'))
  ) then
    raise exception using errcode='42501',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_FORBIDDEN';
  end if;
  select case
    when company.status='archived'::public.company_status
      or membership.status='suspended'::public.membership_status
      or not profile.is_active then 'banned'
    else 'active'
  end into v_effective_desired_state
  from public.company_memberships membership
  join public.companies company on company.id=membership.company_id
  join public.profiles profile on profile.user_id=membership.user_id
  where membership.id=p_membership_id;
  if not found then
    raise exception using errcode='P0001',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_NOT_FOUND';
  end if;
  if v_reconciliation.desired_state<>v_effective_desired_state then
    update private.member_auth_access_reconciliations reconciliation
    set desired_state=v_effective_desired_state,status='pending',
        attempt_count=reconciliation.attempt_count+1,
        last_completion_correlation_id=p_completion_correlation_id,
        last_error_code='AUTH_ADMIN_STALE_EFFECT',updated_at=v_now,completed_at=null
    where reconciliation.id=v_reconciliation.id
    returning * into v_reconciliation;
    insert into public.audit_events(
      scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
      reason_code,correlation_id,metadata,occurred_at
    ) values (
      'tenant',v_reconciliation.company_id,p_actor_user_id,
      'user.auth_access_reconciliation_failed','membership',p_membership_id,
      'failure','AUTH_ADMIN_STALE_EFFECT',p_completion_correlation_id,
      pg_catalog.jsonb_build_object('desiredState',v_reconciliation.desired_state),v_now
    );
    return pg_catalog.jsonb_build_object(
      'status','pending','desiredState',v_reconciliation.desired_state,
      'attemptCount',v_reconciliation.attempt_count
    );
  end if;
  if v_reconciliation.operation_correlation_id<>p_operation_correlation_id then
    update private.member_auth_access_reconciliations reconciliation
    set status='pending',attempt_count=reconciliation.attempt_count+1,
        last_completion_correlation_id=p_completion_correlation_id,
        last_error_code='AUTH_ADMIN_STALE_EFFECT',updated_at=v_now,completed_at=null
    where reconciliation.id=v_reconciliation.id
    returning * into v_reconciliation;
    insert into public.audit_events(
      scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
      reason_code,correlation_id,metadata,occurred_at
    ) values (
      'tenant',v_reconciliation.company_id,p_actor_user_id,
      'user.auth_access_reconciliation_failed','membership',p_membership_id,
      'failure','AUTH_ADMIN_STALE_EFFECT',p_completion_correlation_id,
      pg_catalog.jsonb_build_object('desiredState',v_reconciliation.desired_state),v_now
    );
    return pg_catalog.jsonb_build_object(
      'status','pending','desiredState',v_reconciliation.desired_state,
      'attemptCount',v_reconciliation.attempt_count
    );
  end if;
  if v_reconciliation.status='completed' then
    if p_succeeded then
      return pg_catalog.jsonb_build_object(
        'status','completed','desiredState',v_reconciliation.desired_state,
        'attemptCount',v_reconciliation.attempt_count
      );
    end if;
    raise exception using errcode='23514',
      message='AXSYS_AUTH_ACCESS_RECONCILIATION_STATE_INVALID';
  end if;
  update private.member_auth_access_reconciliations reconciliation
  set status=case when p_succeeded then 'completed' else 'pending' end,
      attempt_count=reconciliation.attempt_count+1,
      last_completion_correlation_id=p_completion_correlation_id,
      last_error_code=case when p_succeeded then null else p_error_code end,
      updated_at=v_now,
      completed_at=case when p_succeeded then v_now else null end
  where reconciliation.id=v_reconciliation.id
  returning * into v_reconciliation;
  insert into public.audit_events(
    scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
    reason_code,correlation_id,metadata,occurred_at
  ) values (
    'tenant',v_reconciliation.company_id,p_actor_user_id,
    case when p_succeeded then 'user.auth_access_reconciled'
      else 'user.auth_access_reconciliation_failed' end,
    'membership',p_membership_id,
    (case when p_succeeded then 'success' else 'failure' end)::public.audit_outcome,
    case when p_succeeded then null else p_error_code end,
    p_completion_correlation_id,
    pg_catalog.jsonb_build_object('desiredState',v_reconciliation.desired_state),v_now
  );
  return pg_catalog.jsonb_build_object(
    'status',v_reconciliation.status,'desiredState',v_reconciliation.desired_state,
    'attemptCount',v_reconciliation.attempt_count
  );
end;
$$;

create function public.company_update_membership(
  p_membership_id uuid,p_display_name text,p_role public.membership_role,
  p_status public.membership_status,p_modules public.module_key[],p_reason text,
  p_expected_version bigint,p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor record;
begin
  select * into v_actor from private.assert_authenticated_company_admin();
  return private.update_company_membership_core(
    v_actor.actor_user_id,v_actor.company_id,p_membership_id,p_display_name,
    p_role,p_status,p_modules,p_reason,p_expected_version,p_correlation_id
  );
end;
$$;

create function public.company_get_api_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_result jsonb;
begin
  begin
    v_actor_user_id := (select auth.uid());
  exception when invalid_text_representation then
    v_actor_user_id := null;
  end;
  if v_actor_user_id is null or not private.has_registered_app_session() then
    raise exception using errcode='42501',message='AXSYS_SESSION_INVALID';
  end if;

  select pg_catalog.jsonb_build_object(
    'companyId',membership.company_id,
    'membershipId',membership.id,
    'role',membership.role::text,
    'modules',coalesce((
      select pg_catalog.jsonb_agg(module.module::text order by module.module::text)
      from public.member_modules module
      where module.company_id=membership.company_id and module.membership_id=membership.id
    ),'[]'::jsonb),
    'companyStatus',company.status::text,
    'mustChangePassword',profile.must_change_password,
    'temporaryPasswordExpiresAt',profile.temporary_password_expires_at
  ) into v_result
  from public.company_memberships membership
  join public.companies company on company.id=membership.company_id
  join public.profiles profile on profile.user_id=membership.user_id
  where membership.user_id=v_actor_user_id
    and membership.status='active'::public.membership_status
    and profile.is_active;
  if not found then
    raise exception using errcode='42501',message='AXSYS_SESSION_INVALID';
  end if;
  return v_result;
end;
$$;

create function private.internal_platform_update_company_admin(
  p_actor_user_id uuid,p_session_id uuid,p_membership_id uuid,p_display_name text,
  p_status public.membership_status,p_modules public.module_key[],p_reason text,
  p_expected_version bigint,p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_company_id uuid;
begin
  perform private.assert_platform_provisioning_actor(p_actor_user_id,p_session_id);
  select membership.company_id into v_company_id
  from public.company_memberships membership
  where membership.id=p_membership_id and membership.role='company_admin';
  if not found then raise exception using errcode='P0001',message='AXSYS_MEMBERSHIP_NOT_FOUND'; end if;
  return private.update_company_membership_core(
    p_actor_user_id,v_company_id,p_membership_id,p_display_name,'company_admin',
    p_status,p_modules,p_reason,p_expected_version,p_correlation_id
  );
end;
$$;

create function private.internal_get_company_user(
  p_actor_user_id uuid,p_session_id uuid,p_membership_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_company_id uuid; v_result jsonb;
begin
  v_company_id := private.assert_company_admin_session(p_actor_user_id,p_session_id,null);
  select private.company_user_snapshot(membership.id) into v_result
  from public.company_memberships membership
  where membership.id=p_membership_id and membership.company_id=v_company_id;
  if not found then raise exception using errcode='P0001',message='AXSYS_MEMBERSHIP_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create function private.internal_get_platform_company_admin(
  p_actor_user_id uuid,p_session_id uuid,p_membership_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_platform_provisioning_actor(p_actor_user_id,p_session_id);
  select private.company_user_snapshot(membership.id) into v_result
  from public.company_memberships membership
  where membership.id=p_membership_id and membership.role='company_admin';
  if not found then raise exception using errcode='P0001',message='AXSYS_MEMBERSHIP_NOT_FOUND'; end if;
  return v_result;
end;
$$;

-- The directory cursor is the opaque membership id exposed as the mutation
-- key. Dropping is required because PostgreSQL cannot replace a function whose
-- OUT columns change.
drop function private.list_company_user_directory(uuid,uuid,uuid,integer,text);
create function private.list_company_user_directory(
  p_actor_user_id uuid,p_session_id uuid,p_cursor uuid,p_limit integer,p_query text
) returns table(
  user_id uuid,membership_id uuid,display_name text,email text,role text,status text,
  modules text[],version bigint,created_at timestamptz
)
language plpgsql security definer set search_path='' rows 100
as $$
declare v_company_id uuid; v_cursor_created_at timestamptz; v_cursor_id uuid; v_query text;
begin
  if p_actor_user_id is null or p_session_id is null
     or p_limit is null or p_limit not between 1 and 100
     or (p_query is not null and pg_catalog.char_length(p_query)>100) then
    raise exception using errcode='22023',message='company_directory_input_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  if not private.assert_auth_session(p_session_id,p_actor_user_id) then
    raise exception using errcode='23514',message='company_directory_session_invalid';
  end if;
  begin
    v_company_id:=private.assert_company_admin_session(p_actor_user_id,p_session_id,null);
  exception when insufficient_privilege then
    raise exception using errcode='42501',message='company_directory_forbidden';
  end;
  v_query:=nullif(pg_catalog.lower(pg_catalog.btrim(p_query)),'');
  if p_cursor is not null then
    select membership.created_at,membership.id into v_cursor_created_at,v_cursor_id
    from public.company_memberships membership
    where membership.company_id=v_company_id and membership.id=p_cursor;
    if not found then raise exception using errcode='22023',message='company_directory_cursor_invalid'; end if;
  end if;
  return query select membership.user_id,membership.id,profile.display_name,
    profile.email::text,membership.role::text,membership.status::text,
    coalesce((select pg_catalog.array_agg(module.module::text order by module.module::text)
      from public.member_modules module where module.company_id=membership.company_id
      and module.membership_id=membership.id),'{}'::text[]),membership.version,membership.created_at
  from public.company_memberships membership join public.profiles profile on profile.user_id=membership.user_id
  where membership.company_id=v_company_id
    and (p_cursor is null or (membership.created_at,membership.id)<(v_cursor_created_at,v_cursor_id))
    and (v_query is null or pg_catalog.strpos(pg_catalog.lower(profile.display_name),v_query)>0
      or pg_catalog.strpos(pg_catalog.lower(profile.email::text),v_query)>0)
  order by membership.created_at desc,membership.id desc limit p_limit;
end;
$$;

revoke execute on function
  private.assert_company_admin_session(uuid,uuid,uuid),
  private.assert_authenticated_company_admin(),
  private.company_user_snapshot(uuid),
  private.reserve_member_provisioning_core(uuid,uuid,text,text,text,uuid),
  private.assert_member_operation_actor(public.provisioning_operations,uuid,uuid),
  private.commit_member_provisioning_core(uuid,uuid,uuid,uuid,text,text,public.membership_role,public.module_key[],uuid),
  private.update_company_membership_core(uuid,uuid,uuid,text,public.membership_role,public.membership_status,public.module_key[],text,bigint,uuid)
from public,anon,authenticated,service_role,axsys_bff;

revoke execute on function
  private.internal_reserve_company_admin_provisioning(uuid,uuid,uuid,text,text,text,uuid),
  private.internal_commit_company_admin_provisioning(uuid,uuid,uuid,uuid,uuid,text,text,public.module_key[],uuid),
  private.internal_platform_update_company_admin(uuid,uuid,uuid,text,public.membership_status,public.module_key[],text,bigint,uuid),
  private.internal_get_company_user(uuid,uuid,uuid),
  private.internal_get_platform_company_admin(uuid,uuid,uuid),
  private.internal_complete_member_auth_access_reconciliation(uuid,uuid,uuid,uuid,boolean,text,uuid),
  private.internal_find_provisioning_auth_user(uuid,uuid,uuid,text),
  private.list_company_user_directory(uuid,uuid,uuid,integer,text)
from public,anon,authenticated,service_role,axsys_bff;
grant execute on function
  private.internal_reserve_company_admin_provisioning(uuid,uuid,uuid,text,text,text,uuid),
  private.internal_commit_company_admin_provisioning(uuid,uuid,uuid,uuid,uuid,text,text,public.module_key[],uuid),
  private.internal_platform_update_company_admin(uuid,uuid,uuid,text,public.membership_status,public.module_key[],text,bigint,uuid),
  private.internal_get_company_user(uuid,uuid,uuid),
  private.internal_get_platform_company_admin(uuid,uuid,uuid),
  private.internal_complete_member_auth_access_reconciliation(uuid,uuid,uuid,uuid,boolean,text,uuid),
  private.internal_find_provisioning_auth_user(uuid,uuid,uuid,text),
  private.list_company_user_directory(uuid,uuid,uuid,integer,text)
to axsys_bff;

revoke execute on function
  public.company_reserve_member_provisioning(text,text,text,uuid),
  public.company_commit_member_provisioning(uuid,uuid,text,text,public.membership_role,public.module_key[],uuid),
  public.company_update_membership(uuid,text,public.membership_role,public.membership_status,public.module_key[],text,bigint,uuid),
  public.company_get_api_access_context()
from public,anon,authenticated,service_role,axsys_bff;
grant execute on function
  public.company_reserve_member_provisioning(text,text,text,uuid),
  public.company_commit_member_provisioning(uuid,uuid,text,text,public.membership_role,public.module_key[],uuid),
  public.company_update_membership(uuid,text,public.membership_role,public.membership_status,public.module_key[],text,bigint,uuid),
  public.company_get_api_access_context()
to authenticated;
