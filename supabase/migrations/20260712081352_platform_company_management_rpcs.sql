do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_COMPANY_MANAGEMENT_MIGRATION_OWNER_INVALID';
  end if;

  if to_regclass('public.companies') is null
     or to_regclass('public.company_memberships') is null
     or to_regclass('public.company_bank_accounts') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure(
       'private.assert_platform_provisioning_actor(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'private.resolve_brazil_timezone(text)'
     ) is null
     or to_regprocedure(
       'private.internal_commit_company_provisioning(uuid,uuid,uuid,uuid,uuid,text,text,text,extensions.citext,text,text,text,extensions.citext,public.module_key[],uuid)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_COMPANY_MANAGEMENT_DEPENDENCY_INVALID';
  end if;
end
$$;

create table private.company_access_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete restrict,
  company_version bigint not null,
  target_status public.company_status not null,
  affected_user_ids uuid[] not null default '{}'::uuid[],
  failed_user_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'pending',
  attempt_count integer not null default 0,
  actor_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  correlation_id uuid not null,
  last_completion_correlation_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint company_access_reconciliations_company_version_positive
    check (company_version > 0),
  constraint company_access_reconciliations_company_version_key
    unique (company_id, company_version),
  constraint company_access_reconciliations_status_allowlist
    check (status in ('pending','complete')),
  constraint company_access_reconciliations_attempt_count_nonnegative
    check (attempt_count >= 0),
  constraint company_access_reconciliations_arrays_one_dimensional check (
    (cardinality(affected_user_ids) = 0 or array_ndims(affected_user_ids) = 1)
    and (cardinality(failed_user_ids) = 0 or array_ndims(failed_user_ids) = 1)
  ),
  constraint company_access_reconciliations_arrays_not_null check (
    array_position(affected_user_ids, null) is null
    and array_position(failed_user_ids, null) is null
  ),
  constraint company_access_reconciliations_failures_are_affected
    check (failed_user_ids <@ affected_user_ids),
  constraint company_access_reconciliations_lifecycle check (
    (
      status = 'pending'
      and completed_at is null
      and (
        (
          attempt_count = 0
          and cardinality(failed_user_ids) = 0
          and last_completion_correlation_id is null
        )
        or (
          attempt_count > 0
          and cardinality(failed_user_ids) > 0
          and last_completion_correlation_id is not null
        )
      )
    )
    or (
      status = 'complete'
      and attempt_count > 0
      and cardinality(failed_user_ids) = 0
      and last_completion_correlation_id is not null
      and completed_at is not null
    )
  ),
  constraint company_access_reconciliations_timestamp_order check (
    updated_at >= created_at
    and (completed_at is null or completed_at >= created_at)
  )
);

create index company_access_reconciliations_pending_idx
  on private.company_access_reconciliations(updated_at, id)
  where status = 'pending';
create index company_access_reconciliations_actor_idx
  on private.company_access_reconciliations(actor_user_id, created_at desc, id);
create index companies_created_keyset_idx
  on public.companies(created_at desc, id desc);
create index companies_status_created_keyset_idx
  on public.companies(status, created_at desc, id desc);

alter table private.company_access_reconciliations enable row level security;
alter table private.company_access_reconciliations force row level security;
revoke all on private.company_access_reconciliations
from public, anon, authenticated, service_role, axsys_bff;

create function private.guard_company_access_reconciliation_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.company_version is distinct from old.company_version
     or new.target_status is distinct from old.target_status
     or new.affected_user_ids is distinct from old.affected_user_ids
     or new.actor_user_id is distinct from old.actor_user_id
     or new.correlation_id is distinct from old.correlation_id
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_RECONCILIATION_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'complete' then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_RECONCILIATION_TERMINAL';
  end if;

  if old.status <> 'pending'
     or new.status not in ('pending','complete')
     or new.attempt_count <> old.attempt_count + 1
     or new.last_completion_correlation_id is null
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_RECONCILIATION_TRANSITION_INVALID';
  end if;

  return new;
end;
$$;

create trigger company_access_reconciliations_guard_update
before update on private.company_access_reconciliations
for each row execute function private.guard_company_access_reconciliation_update();

revoke execute on function
  private.guard_company_access_reconciliation_update()
from public, anon, authenticated, service_role, axsys_bff;

create function private.internal_commit_company_provisioning(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_auth_user_id uuid,
  p_company_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_cnpj_normalized text,
  p_contact_email text,
  p_contact_phone text,
  p_timezone text,
  p_admin_display_name text,
  p_admin_email text,
  p_modules public.module_key[],
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.internal_commit_company_provisioning(
    p_operation_id,
    p_actor_user_id,
    p_session_id,
    p_auth_user_id,
    p_company_id,
    p_legal_name,
    p_trade_name,
    p_cnpj_normalized,
    p_contact_email::extensions.citext,
    p_contact_phone,
    p_timezone,
    p_admin_display_name,
    p_admin_email::extensions.citext,
    p_modules,
    p_correlation_id
  );
end;
$$;

create function private.company_management_snapshot(
  p_company public.companies
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_company.id,
    'legalName', p_company.legal_name,
    'tradeName', p_company.trade_name,
    'cnpj', p_company.cnpj_normalized,
    'contactEmail', p_company.contact_email::text,
    'contactPhone', p_company.contact_phone,
    'timezone', p_company.timezone,
    'status', p_company.status::text,
    'version', p_company.version,
    'createdAt', p_company.created_at,
    'updatedAt', p_company.updated_at,
    'archivedAt', p_company.archived_at
  )
$$;

create function private.company_platform_read_snapshot(
  p_company public.companies
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_company.id,
    'legalName', p_company.legal_name,
    'tradeName', p_company.trade_name,
    'cnpj', p_company.cnpj_normalized,
    'contactEmail', p_company.contact_email::text,
    'contactPhone', p_company.contact_phone,
    'timezone', p_company.timezone,
    'status', p_company.status::text,
    'version', p_company.version,
    'createdAt', p_company.created_at,
    'updatedAt', p_company.updated_at
  )
$$;

create function private.internal_list_companies(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_search text,
  p_status public.company_status,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text;
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if p_limit is null
     or p_limit not between 1 and 100
     or (
       p_search is not null
       and (
         p_search <> pg_catalog.btrim(p_search)
         or pg_catalog.char_length(p_search) > 100
       )
     )
     or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_COMPANY_LIST_INPUT_INVALID';
  end if;

  v_search := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_search)),
    ''
  );

  with candidates as materialized (
    select company.*
    from public.companies company
    where (p_status is null or company.status = p_status)
      and (
        v_search is null
        or pg_catalog.strpos(
          pg_catalog.lower(company.legal_name),
          v_search
        ) > 0
      )
      and (
        p_cursor_created_at is null
        or (company.created_at, company.id)
          < (p_cursor_created_at, p_cursor_id)
      )
    order by company.created_at desc, company.id desc
    limit (p_limit + 1)
  ), page as materialized (
    select candidate.*
    from candidates candidate
    order by candidate.created_at desc, candidate.id desc
    limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce(
      (
        select pg_catalog.jsonb_agg(
          private.company_platform_read_snapshot(page_row::public.companies)
          order by page_row.created_at desc, page_row.id desc
        )
        from page page_row
      ),
      '[]'::jsonb
    ),
    'nextCursor', case
      when (select pg_catalog.count(*) from candidates) > p_limit then (
        select pg_catalog.jsonb_build_object(
          'createdAt', last_row.created_at,
          'id', last_row.id
        )
        from page last_row
        order by last_row.created_at, last_row.id
        limit 1
      )
      else null
    end
  )
  into v_result;

  return v_result;
end;
$$;

create function private.internal_get_company_detail(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_result jsonb;
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if p_company_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_COMPANY_INPUT_INVALID';
  end if;

  select company.*
  into v_company
  from public.companies company
  where company.id = p_company_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_COMPANY_NOT_FOUND';
  end if;

  select pg_catalog.jsonb_build_object(
    'company', private.company_platform_read_snapshot(v_company),
    'admins', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', membership.id,
            'displayName', profile.display_name,
            'status', membership.status::text
          )
          order by pg_catalog.lower(profile.display_name), membership.id
        )
        from public.company_memberships membership
        join public.profiles profile on profile.user_id = membership.user_id
        where membership.company_id = p_company_id
          and membership.role = 'company_admin'::public.membership_role
      ),
      '[]'::jsonb
    ),
    'bankAccounts', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', bank.id,
            'bankCode', bank.bank_code,
            'bankName', bank.bank_name,
            'branchLast4', bank.branch_last4,
            'accountLast4', bank.account_last4,
            'accountType', bank.account_type::text,
            'isDefault', bank.is_default,
            'status', bank.status::text,
            'version', bank.version
          )
          order by bank.is_default desc,
                   pg_catalog.lower(bank.bank_name), bank.id
        )
        from public.company_bank_accounts bank
        where bank.company_id = p_company_id
          and bank.status = 'active'::public.bank_account_status
      ),
      '[]'::jsonb
    ),
    'counters', pg_catalog.jsonb_build_object(
      'activeAdmins', (
        select pg_catalog.count(*)
        from public.company_memberships membership
        where membership.company_id = p_company_id
          and membership.role = 'company_admin'::public.membership_role
          and membership.status = 'active'::public.membership_status
      ),
      'activeUsers', (
        select pg_catalog.count(*)
        from public.company_memberships membership
        where membership.company_id = p_company_id
          and membership.status = 'active'::public.membership_status
      ),
      'bankAccounts', (
        select pg_catalog.count(*)
        from public.company_bank_accounts bank
        where bank.company_id = p_company_id
          and bank.status = 'active'::public.bank_account_status
      )
    )
  )
  into v_result;

  return v_result;
end;
$$;

create function private.internal_update_company(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_contact_email text,
  p_contact_phone text,
  p_timezone text,
  p_expected_version bigint,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_contact_email extensions.citext;
  v_timezone text;
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if p_company_id is null
     or p_legal_name is null
     or p_legal_name <> pg_catalog.btrim(p_legal_name)
     or pg_catalog.char_length(p_legal_name) not between 2 and 160
     or p_trade_name is null
     or p_trade_name <> pg_catalog.btrim(p_trade_name)
     or pg_catalog.char_length(p_trade_name) not between 2 and 180
     or p_contact_email is null
     or p_contact_email <> pg_catalog.lower(pg_catalog.btrim(p_contact_email))
     or pg_catalog.char_length(p_contact_email) not between 3 and 254
     or p_contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'
     or (
       p_contact_phone is not null
       and (
         p_contact_phone <> pg_catalog.btrim(p_contact_phone)
         or pg_catalog.char_length(p_contact_phone) not between 8 and 32
       )
     )
     or p_expected_version is null
     or p_expected_version < 1
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_COMPANY_INPUT_INVALID';
  end if;

  v_timezone := private.resolve_brazil_timezone(p_timezone);
  v_contact_email := p_contact_email::extensions.citext;

  update public.companies company
  set legal_name = p_legal_name,
      trade_name = p_trade_name,
      contact_email = v_contact_email,
      contact_phone = p_contact_phone,
      timezone = v_timezone
  where company.id = p_company_id
    and company.version = p_expected_version
  returning company.* into v_company;

  if not found then
    if exists (
      select 1
      from public.companies company
      where company.id = p_company_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'AXSYS_VERSION_CONFLICT';
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_COMPANY_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'company', private.company_management_snapshot(v_company)
  );
end;
$$;

create function private.internal_set_company_status(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_target_status public.company_status,
  p_expected_version bigint,
  p_reason text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_affected_user_ids uuid[];
  v_now timestamptz;
  v_previous_status public.company_status;
  v_reconciliation private.company_access_reconciliations%rowtype;
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if p_company_id is null
     or p_target_status is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_correlation_id is null
     or (
       p_target_status = 'archived'::public.company_status
       and (
         p_reason is null
         or p_reason <> pg_catalog.btrim(p_reason)
         or pg_catalog.char_length(p_reason) not between 10 and 500
       )
     )
     or (
       p_target_status = 'active'::public.company_status
       and p_reason is not null
     ) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_COMPANY_INPUT_INVALID';
  end if;

  select company.*
  into v_company
  from public.companies company
  where company.id = p_company_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_COMPANY_NOT_FOUND';
  end if;

  if v_company.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_VERSION_CONFLICT';
  end if;

  select coalesce(
    pg_catalog.array_agg(membership.user_id order by membership.user_id),
    '{}'::uuid[]
  )
  into v_affected_user_ids
  from public.company_memberships membership
  where membership.company_id = p_company_id
    and (
      p_target_status = 'archived'::public.company_status
      or membership.status = 'active'::public.membership_status
    );

  v_now := pg_catalog.clock_timestamp();

  if v_company.status = p_target_status then
    select reconciliation.*
    into v_reconciliation
    from private.company_access_reconciliations reconciliation
    where reconciliation.company_id = p_company_id
      and reconciliation.company_version = v_company.version
      and reconciliation.target_status = p_target_status
    for update;

    if not found then
      insert into private.company_access_reconciliations (
        company_id,
        company_version,
        target_status,
        affected_user_ids,
        actor_user_id,
        correlation_id,
        created_at,
        updated_at
      ) values (
        p_company_id,
        v_company.version,
        p_target_status,
        v_affected_user_ids,
        p_actor_user_id,
        p_correlation_id,
        v_now,
        v_now
      )
      returning * into v_reconciliation;
    else
      v_affected_user_ids := v_reconciliation.affected_user_ids;
    end if;

    return pg_catalog.jsonb_build_object(
      'company', private.company_management_snapshot(v_company),
      'affectedUserIds', pg_catalog.to_jsonb(v_affected_user_ids),
      'reconciliationId', v_reconciliation.id
    );
  end if;

  v_previous_status := v_company.status;

  update public.companies company
  set status = p_target_status,
      archived_at = case
        when p_target_status = 'archived'::public.company_status then v_now
        else null
      end,
      archived_by = case
        when p_target_status = 'archived'::public.company_status
          then p_actor_user_id
        else null
      end
  where company.id = v_company.id
    and company.version = p_expected_version
  returning company.* into v_company;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_COMPANY_TRANSITION_LOST';
  end if;

  insert into private.company_access_reconciliations (
    company_id,
    company_version,
    target_status,
    affected_user_ids,
    actor_user_id,
    correlation_id,
    created_at,
    updated_at
  ) values (
    p_company_id,
    v_company.version,
    p_target_status,
    v_affected_user_ids,
    p_actor_user_id,
    p_correlation_id,
    v_now,
    v_now
  )
  returning * into v_reconciliation;

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
    case
      when p_target_status = 'archived'::public.company_status
        then 'company.archived'
      else 'company.reactivated'
    end,
    'company',
    p_company_id,
    'success'::public.audit_outcome,
    null,
    p_correlation_id,
    pg_catalog.jsonb_build_object(
      'previousStatus', v_previous_status::text,
      'nextStatus', p_target_status::text
    ),
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'company', private.company_management_snapshot(v_company),
    'affectedUserIds', pg_catalog.to_jsonb(v_affected_user_ids),
    'reconciliationId', v_reconciliation.id
  );
end;
$$;

create function private.company_access_reconciliation_snapshot(
  p_reconciliation private.company_access_reconciliations
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'reconciliationId', p_reconciliation.id,
    'status', p_reconciliation.status,
    'failedUserIds', pg_catalog.to_jsonb(p_reconciliation.failed_user_ids),
    'attemptCount', p_reconciliation.attempt_count,
    'updatedAt', p_reconciliation.updated_at
  )
$$;

create function private.internal_complete_company_access_reconciliation(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reconciliation_id uuid,
  p_failed_user_ids uuid[],
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct_count bigint;
  v_failed_user_ids uuid[];
  v_now timestamptz;
  v_reconciliation private.company_access_reconciliations%rowtype;
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if p_reconciliation_id is null
     or p_failed_user_ids is null
     or p_correlation_id is null
     or (
       pg_catalog.cardinality(p_failed_user_ids) > 0
       and pg_catalog.array_ndims(p_failed_user_ids) <> 1
     )
     or pg_catalog.array_position(p_failed_user_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_RECONCILIATION_INPUT_INVALID';
  end if;

  select pg_catalog.count(distinct failed_user_id)
  into v_distinct_count
  from pg_catalog.unnest(p_failed_user_ids)
    as failed(failed_user_id);

  if v_distinct_count <> pg_catalog.cardinality(p_failed_user_ids) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_RECONCILIATION_INPUT_INVALID';
  end if;

  select coalesce(
    pg_catalog.array_agg(failed_user_id order by failed_user_id),
    '{}'::uuid[]
  )
  into v_failed_user_ids
  from pg_catalog.unnest(p_failed_user_ids)
    as failed(failed_user_id);

  select reconciliation.*
  into v_reconciliation
  from private.company_access_reconciliations reconciliation
  where reconciliation.id = p_reconciliation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_RECONCILIATION_NOT_FOUND';
  end if;

  if not (v_failed_user_ids <@ v_reconciliation.affected_user_ids) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_RECONCILIATION_FAILED_USERS_INVALID';
  end if;

  if v_reconciliation.last_completion_correlation_id = p_correlation_id then
    if v_reconciliation.failed_user_ids is distinct from v_failed_user_ids then
      raise exception using
        errcode = '22023',
        message = 'AXSYS_RECONCILIATION_CORRELATION_REUSED';
    end if;
    return private.company_access_reconciliation_snapshot(v_reconciliation);
  end if;

  if v_reconciliation.status = 'complete' then
    if pg_catalog.cardinality(v_failed_user_ids) > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'AXSYS_RECONCILIATION_COMPLETE';
    end if;
    return private.company_access_reconciliation_snapshot(v_reconciliation);
  end if;

  v_now := pg_catalog.clock_timestamp();
  update private.company_access_reconciliations reconciliation
  set failed_user_ids = v_failed_user_ids,
      status = case
        when pg_catalog.cardinality(v_failed_user_ids) = 0 then 'complete'
        else 'pending'
      end,
      attempt_count = reconciliation.attempt_count + 1,
      last_completion_correlation_id = p_correlation_id,
      updated_at = v_now,
      completed_at = case
        when pg_catalog.cardinality(v_failed_user_ids) = 0 then v_now
        else null
      end
  where reconciliation.id = v_reconciliation.id
    and reconciliation.status = 'pending'
  returning reconciliation.* into v_reconciliation;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_RECONCILIATION_TRANSITION_LOST';
  end if;

  return private.company_access_reconciliation_snapshot(v_reconciliation);
end;
$$;

revoke execute on function private.company_management_snapshot(
  public.companies
) from public, anon, authenticated, service_role, axsys_bff;

revoke execute on function private.company_platform_read_snapshot(
  public.companies
), private.company_access_reconciliation_snapshot(
  private.company_access_reconciliations
) from public, anon, authenticated, service_role, axsys_bff;

revoke execute on function private.internal_commit_company_provisioning(
  uuid,uuid,uuid,uuid,uuid,text,text,text,extensions.citext,text,text,text,
  extensions.citext,public.module_key[],uuid
) from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.internal_commit_company_provisioning(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,
  public.module_key[],uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.internal_commit_company_provisioning(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,
  public.module_key[],uuid
) to axsys_bff;

revoke execute on function private.internal_update_company(
  uuid,uuid,uuid,text,text,text,text,text,bigint,uuid
), private.internal_set_company_status(
  uuid,uuid,uuid,public.company_status,bigint,text,uuid
), private.internal_list_companies(
  uuid,uuid,text,public.company_status,timestamptz,uuid,integer
), private.internal_get_company_detail(
  uuid,uuid,uuid
), private.internal_complete_company_access_reconciliation(
  uuid,uuid,uuid,uuid[],uuid
) from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.internal_update_company(
  uuid,uuid,uuid,text,text,text,text,text,bigint,uuid
), private.internal_set_company_status(
  uuid,uuid,uuid,public.company_status,bigint,text,uuid
), private.internal_list_companies(
  uuid,uuid,text,public.company_status,timestamptz,uuid,integer
), private.internal_get_company_detail(
  uuid,uuid,uuid
), private.internal_complete_company_access_reconciliation(
  uuid,uuid,uuid,uuid[],uuid
) to axsys_bff;

revoke usage on schema extensions from axsys_bff;
revoke usage on type public.company_status
from public, anon, authenticated, service_role;
grant usage on type public.company_status to axsys_bff;
