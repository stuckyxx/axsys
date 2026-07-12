do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_UPLOAD_AUTHORIZATION_RETIREMENT_MIGRATION_OWNER_INVALID';
  end if;
end
$$;

create index file_upload_intents_stale_reserved_idx
on public.file_upload_intents(company_id, created_at, id)
where status = 'reserved'::public.upload_intent_status
  and authorization_retired_at is null;

create function private.claim_upload_authorizations_for_retirement(
  p_limit integer,
  p_worker_id uuid
) returns table (
  intent_id uuid,
  quarantine_object_path text,
  retirement_status public.upload_intent_status,
  claim_id uuid,
  expected_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_limit is null
     or p_limit not between 1 and 100
     or p_worker_id is null then
    raise exception using
      errcode = '22023',
      message = 'upload_retirement_input_invalid';
  end if;

  return query
  with candidates as materialized (
    select candidate.id
    from public.file_upload_intents candidate
    where candidate.authorization_issued_at is not null
      and candidate.upload_authorization_expires_at is not null
      and candidate.cleanup_not_before is not null
      and candidate.cleanup_not_before <= v_now
      and candidate.authorization_retired_at is null
      and candidate.status in (
        'issued'::public.upload_intent_status,
        'finalizing'::public.upload_intent_status,
        'ready'::public.upload_intent_status,
        'rejected'::public.upload_intent_status,
        'expired'::public.upload_intent_status,
        'cleanup_required'::public.upload_intent_status
      )
      and (
        (
          candidate.authorization_cleanup_claim_id is null
          and candidate.authorization_cleanup_claimed_at is null
        )
        or candidate.authorization_cleanup_claimed_at
          <= v_now - interval '15 minutes'
      )
    order by candidate.cleanup_not_before, candidate.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.file_upload_intents target
    set authorization_cleanup_claim_id = p_worker_id,
        authorization_cleanup_claimed_at = v_now,
        version = target.version + 1,
        updated_at = v_now
    from candidates
    where target.id = candidates.id
      and target.authorization_retired_at is null
    returning
      target.id,
      target.quarantine_object_path,
      target.status,
      target.version
  )
  select
    claimed.id,
    claimed.quarantine_object_path,
    case
      when claimed.status in (
        'issued'::public.upload_intent_status,
        'finalizing'::public.upload_intent_status,
        'cleanup_required'::public.upload_intent_status
      ) then 'expired'::public.upload_intent_status
      else claimed.status
    end,
    p_worker_id,
    claimed.version
  from claimed
  order by claimed.id;
end;
$$;

create function private.release_upload_authorization_retirement_claim(
  p_intent_id uuid,
  p_claim_id uuid,
  p_expected_version bigint,
  p_error_code text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_intent_id is null
     or p_claim_id is null
     or p_expected_version is null
     or p_expected_version < 1 then
    raise exception using
      errcode = '22023',
      message = 'upload_retirement_input_invalid';
  end if;

  if p_error_code is null or p_error_code not in (
    'FILE_QUARANTINE_DELETE_AMBIGUOUS',
    'FILE_QUARANTINE_DELETE_FAILED',
    'FILE_QUARANTINE_DELETE_UNAVAILABLE'
  ) then
    raise exception using
      errcode = '22023',
      message = 'upload_retirement_reason_invalid';
  end if;

  select intent.*
  into v_intent
  from public.file_upload_intents intent
  where intent.id = p_intent_id
  for update;

  if not found
     or v_intent.authorization_retired_at is not null
     or v_intent.cleanup_not_before is null
     or v_intent.cleanup_not_before > v_now
     or v_intent.authorization_cleanup_claim_id is distinct from p_claim_id
     or v_intent.authorization_cleanup_claimed_at is null
     or v_intent.version is distinct from p_expected_version then
    raise exception using
      errcode = '23514',
      message = 'upload_retirement_claim_invalid';
  end if;

  update public.file_upload_intents intent
  set authorization_cleanup_claim_id = null,
      authorization_cleanup_claimed_at = null,
      cleanup_error_code = p_error_code,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.authorization_retired_at is null
    and intent.authorization_cleanup_claim_id = p_claim_id
    and intent.version = p_expected_version;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'upload_retirement_release_lost';
  end if;

  return p_expected_version + 1;
end;
$$;

create function private.complete_upload_authorization_retirement(
  p_intent_id uuid,
  p_claim_id uuid,
  p_expected_version bigint
) returns table (
  intent_id uuid,
  status public.upload_intent_status,
  released_bytes bigint,
  version bigint,
  authorization_retired_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_usage private.company_storage_usage%rowtype;
  v_next_status public.upload_intent_status;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_intent_id is null
     or p_claim_id is null
     or p_expected_version is null
     or p_expected_version < 1 then
    raise exception using
      errcode = '22023',
      message = 'upload_retirement_input_invalid';
  end if;

  select intent.*
  into v_intent
  from public.file_upload_intents intent
  where intent.id = p_intent_id
  for update;

  if found
     and v_intent.authorization_retired_at is not null
     and v_intent.authorization_cleanup_claim_id = p_claim_id
     and v_intent.authorization_cleanup_claimed_at is not null
     and v_intent.quota_hold_bytes = 0
     and v_intent.version = p_expected_version + 1 then
    return query select
      v_intent.id,
      v_intent.status,
      0::bigint,
      v_intent.version,
      v_intent.authorization_retired_at;
    return;
  end if;

  if not found
     or v_intent.authorization_retired_at is not null
     or v_intent.authorization_issued_at is null
     or v_intent.upload_authorization_expires_at is null
     or v_intent.cleanup_not_before is null
     or v_intent.cleanup_not_before > v_now
     or v_intent.authorization_cleanup_claim_id is distinct from p_claim_id
     or v_intent.authorization_cleanup_claimed_at is null
     or v_intent.version is distinct from p_expected_version
     or v_intent.status not in (
       'issued'::public.upload_intent_status,
       'finalizing'::public.upload_intent_status,
       'ready'::public.upload_intent_status,
       'rejected'::public.upload_intent_status,
       'expired'::public.upload_intent_status,
       'cleanup_required'::public.upload_intent_status
     ) then
    raise exception using
      errcode = '23514',
      message = 'upload_retirement_claim_invalid';
  end if;

  if (
       v_intent.status in (
         'ready'::public.upload_intent_status,
         'rejected'::public.upload_intent_status
       )
       and v_intent.quota_hold_bytes <> v_intent.declared_size
     )
     or (
       v_intent.status in (
         'issued'::public.upload_intent_status,
         'finalizing'::public.upload_intent_status,
         'expired'::public.upload_intent_status,
         'cleanup_required'::public.upload_intent_status
       )
       and v_intent.quota_hold_bytes <> v_intent.declared_size * 2
     ) then
    raise exception using
      errcode = '23514',
      message = 'upload_retirement_state_invalid';
  end if;

  select usage.*
  into v_usage
  from private.company_storage_usage usage
  where usage.company_id = v_intent.company_id
  for update;
  if not found or v_usage.reserved_bytes < v_intent.quota_hold_bytes then
    raise exception using
      errcode = '23514',
      message = 'upload_retirement_quota_invalid';
  end if;

  if v_intent.quota_hold_bytes > 0 then
    update private.company_storage_usage usage
    set reserved_bytes = usage.reserved_bytes - v_intent.quota_hold_bytes,
        version = usage.version + 1,
        updated_at = v_now
    where usage.company_id = v_intent.company_id;
  end if;

  v_next_status := case
    when v_intent.status in (
      'issued'::public.upload_intent_status,
      'finalizing'::public.upload_intent_status,
      'cleanup_required'::public.upload_intent_status
    ) then 'expired'::public.upload_intent_status
    else v_intent.status
  end;

  update public.file_upload_intents intent
  set status = v_next_status,
      quota_hold_bytes = 0,
      authorization_retired_at = v_now,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.authorization_retired_at is null
    and intent.authorization_cleanup_claim_id = p_claim_id
    and intent.version = p_expected_version;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'upload_retirement_complete_lost';
  end if;

  return query select
    v_intent.id,
    v_next_status,
    v_intent.quota_hold_bytes,
    p_expected_version + 1,
    v_now;
end;
$$;

create function private.cancel_stale_reserved_upload_intents(
  p_limit integer
) returns table (
  intent_id uuid,
  released_bytes bigint,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_usage private.company_storage_usage%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'stale_reservation_input_invalid';
  end if;

  for v_intent in
    select candidate.*
    from public.file_upload_intents candidate
    where candidate.status = 'reserved'::public.upload_intent_status
      and candidate.authorization_issued_at is null
      and candidate.upload_authorization_expires_at is null
      and candidate.cleanup_not_before is null
      and candidate.authorization_retired_at is null
      and candidate.authorization_cleanup_claim_id is null
      and candidate.authorization_cleanup_claimed_at is null
      and candidate.created_at <= v_now - interval '30 minutes'
    order by candidate.company_id, candidate.created_at, candidate.id
    limit p_limit
    for update skip locked
  loop
    if v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
      raise exception using
        errcode = '23514',
        message = 'stale_reservation_state_invalid';
    end if;

    select usage.*
    into v_usage
    from private.company_storage_usage usage
    where usage.company_id = v_intent.company_id
    for update;
    if not found or v_usage.reserved_bytes < v_intent.quota_hold_bytes then
      raise exception using
        errcode = '23514',
        message = 'stale_reservation_quota_invalid';
    end if;

    if v_intent.quota_hold_bytes > 0 then
      update private.company_storage_usage usage
      set reserved_bytes = usage.reserved_bytes - v_intent.quota_hold_bytes,
          version = usage.version + 1,
          updated_at = v_now
      where usage.company_id = v_intent.company_id;
    end if;

    update public.file_upload_intents intent
    set status = 'cancelled'::public.upload_intent_status,
        quota_hold_bytes = 0,
        authorization_retired_at = v_now,
        cleanup_error_code = null,
        version = intent.version + 1,
        updated_at = v_now
    where intent.id = v_intent.id
      and intent.status = 'reserved'::public.upload_intent_status
      and intent.authorization_issued_at is null
      and intent.authorization_retired_at is null
      and intent.version = v_intent.version;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'stale_reservation_cancel_lost';
    end if;

    intent_id := v_intent.id;
    released_bytes := v_intent.quota_hold_bytes;
    version := v_intent.version + 1;
    return next;
  end loop;
end;
$$;

revoke execute on function
  private.claim_upload_authorizations_for_retirement(integer,uuid),
  private.complete_upload_authorization_retirement(uuid,uuid,bigint),
  private.release_upload_authorization_retirement_claim(uuid,uuid,bigint,text),
  private.cancel_stale_reserved_upload_intents(integer)
from public, anon, authenticated, service_role, axsys_bff;

grant execute on function
  private.claim_upload_authorizations_for_retirement(integer,uuid),
  private.complete_upload_authorization_retirement(uuid,uuid,bigint),
  private.release_upload_authorization_retirement_claim(uuid,uuid,bigint,text),
  private.cancel_stale_reserved_upload_intents(integer)
to axsys_bff;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc function
    join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = function.proowner
    where namespace.nspname = 'private'
      and function.proname in (
        'claim_upload_authorizations_for_retirement',
        'complete_upload_authorization_retirement',
        'release_upload_authorization_retirement_claim',
        'cancel_stale_reserved_upload_intents'
      )
      and (
        owner.rolname <> 'postgres'
        or not function.prosecdef
        or not ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_UPLOAD_AUTHORIZATION_RETIREMENT_ROUTINE_CATALOG_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function
    join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
    cross join unnest(array['public','anon','authenticated','service_role']) role_name
    where namespace.nspname = 'private'
      and function.proname in (
        'claim_upload_authorizations_for_retirement',
        'complete_upload_authorization_retirement',
        'release_upload_authorization_retirement_claim',
        'cancel_stale_reserved_upload_intents'
      )
      and pg_catalog.has_function_privilege(role_name, function.oid, 'EXECUTE')
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_UPLOAD_AUTHORIZATION_RETIREMENT_ROUTINE_EXPOSED';
  end if;
end
$$;
