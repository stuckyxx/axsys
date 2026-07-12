do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode='42501',
      message='AXSYS_PLATFORM_OBSERVABILITY_MIGRATION_OWNER_INVALID';
  end if;

  if to_regclass('public.audit_events') is null
     or to_regclass('public.provisioning_operations') is null
     or to_regclass('public.company_memberships') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_bank_accounts') is null
     or to_regclass('public.file_upload_intents') is null
     or to_regclass('public.file_objects') is null
     or to_regclass('private.company_storage_usage') is null
     or to_regclass('private.company_access_reconciliations') is null
     or to_regclass('private.member_auth_access_reconciliations') is null
     or to_regprocedure(
       'private.assert_auth_session(uuid,uuid)'
     ) is null then
    raise exception using errcode='55000',
      message='AXSYS_PLATFORM_OBSERVABILITY_DEPENDENCY_INVALID';
  end if;
end
$$;

create extension if not exists pg_trgm with schema extensions;

create index file_upload_intents_cleanup_health_idx
  on public.file_upload_intents(updated_at,id)
  where status='cleanup_required'::public.upload_intent_status;

create index audit_events_platform_action_keyset_idx
  on public.audit_events(action,occurred_at desc,id desc)
  where scope='platform'::public.audit_scope;

create index audit_events_platform_resource_keyset_idx
  on public.audit_events(resource_type,occurred_at desc,id desc)
  where scope='platform'::public.audit_scope;

create index audit_events_platform_outcome_keyset_idx
  on public.audit_events(outcome,occurred_at desc,id desc)
  where scope='platform'::public.audit_scope;

create index file_objects_scan_failures_health_idx
  on public.file_objects(id)
  where scan_status='failed'::public.file_scan_status;

create index file_objects_usage_health_idx
  on public.file_objects(company_id)
  include (byte_size)
  where promoted_at is not null and quota_released_at is null;

create index file_upload_intents_holds_health_idx
  on public.file_upload_intents(company_id)
  include (quota_hold_bytes)
  where quota_hold_bytes > 0;

create index company_memberships_platform_admin_keyset_idx
  on public.company_memberships(created_at desc,id desc)
  where role='company_admin'::public.membership_role;

create index profiles_display_name_trgm_idx
  on public.profiles using gin (
    pg_catalog.lower(display_name) extensions.gin_trgm_ops
  );

create index profiles_email_trgm_idx
  on public.profiles using gin (
    pg_catalog.lower(email::text) extensions.gin_trgm_ops
  );

create index companies_legal_name_trgm_idx
  on public.companies using gin (
    pg_catalog.lower(legal_name) extensions.gin_trgm_ops
  );

create index company_memberships_active_dashboard_idx
  on public.company_memberships(role,id)
  where status='active'::public.membership_status;

create index company_bank_accounts_status_dashboard_idx
  on public.company_bank_accounts(status);

create function private.assert_platform_read_actor(
  p_actor_user_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_actor_user_id is null or p_session_id is null then
    raise exception using errcode='22023',
      message='AXSYS_PLATFORM_READ_INPUT_INVALID';
  end if;

  if not private.assert_auth_session(p_session_id,p_actor_user_id) then
    raise exception using errcode='23514',
      message='AXSYS_PLATFORM_SESSION_INVALID';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join private.auth_session_controls control
      on control.user_id=profile.user_id
     and control.session_id=p_session_id
    where profile.user_id=p_actor_user_id
      and profile.is_active
      and not profile.must_change_password
      and control.state='active'::private.auth_session_state
      and control.revoked_at is null
      and control.absolute_expires_at>pg_catalog.clock_timestamp()
      and control.audit_scope='platform'::public.audit_scope
      and control.audit_company_id is null
  ) then
    raise exception using errcode='23514',
      message='AXSYS_PLATFORM_SESSION_INVALID';
  end if;

  if not exists (
    select 1
    from public.platform_roles platform_role
    where platform_role.user_id=p_actor_user_id
      and platform_role.role='super_admin'::public.platform_role
      and platform_role.is_active
  ) then
    raise exception using errcode='42501',
      message='AXSYS_PLATFORM_REQUIRED';
  end if;

  perform pg_catalog.set_config('app.actor_id',p_actor_user_id::text,true);
end;
$$;

create function private.platform_audit_safe_metadata(
  p_metadata jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_text text;
begin
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    return v_result;
  end if;

  if pg_catalog.jsonb_typeof(p_metadata->'moduleCount')='number' then
    v_text := p_metadata->>'moduleCount';
    if v_text ~ '^[0-3]$' then
      v_result := v_result || pg_catalog.jsonb_build_object(
        'moduleCount',v_text::integer
      );
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_metadata->'bankCode')='string' then
    v_text := p_metadata->>'bankCode';
    if v_text ~ '^[0-9]{3,4}$' then
      v_result := v_result || pg_catalog.jsonb_build_object('bankCode',v_text);
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_metadata->'accountLast4')='string' then
    v_text := p_metadata->>'accountLast4';
    if v_text ~ '^[0-9]{1,4}$' then
      v_result := v_result || pg_catalog.jsonb_build_object(
        'accountLast4',v_text
      );
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_metadata->'madeDefault')='boolean' then
    v_result := v_result || pg_catalog.jsonb_build_object(
      'madeDefault',(p_metadata->>'madeDefault')::boolean
    );
  end if;

  foreach v_text in array array['previousStatus','nextStatus'] loop
    if pg_catalog.jsonb_typeof(p_metadata->v_text)='string'
       and (p_metadata->>v_text) in (
         'active','archived','invited','suspended','pending','complete'
       ) then
      v_result := v_result || pg_catalog.jsonb_build_object(
        v_text,p_metadata->>v_text
      );
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(p_metadata->'accessReconciliation')='string'
     and (p_metadata->>'accessReconciliation') in ('complete','pending') then
    v_result := v_result || pg_catalog.jsonb_build_object(
      'accessReconciliation',p_metadata->>'accessReconciliation'
    );
  end if;

  return v_result;
end;
$$;

create function private.internal_list_platform_admins(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_search text,
  p_cursor_created_at timestamptz,
  p_cursor_membership_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $$
declare
  v_search text := nullif(pg_catalog.lower(pg_catalog.btrim(p_search)), '');
  v_pattern text;
  v_rows jsonb;
  v_next_cursor jsonb := null;
begin
  perform private.assert_platform_read_actor(p_actor_user_id,p_session_id);

  if p_limit is null or p_limit not between 1 and 100
     or (p_cursor_created_at is null) <> (p_cursor_membership_id is null)
     or (
       v_search is not null
       and pg_catalog.char_length(v_search) not between 2 and 120
     ) then
    raise exception using errcode='22023',
      message='AXSYS_PLATFORM_ADMINS_INPUT_INVALID';
  end if;

  if v_search is not null then
    v_pattern := '%' || pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(v_search,E'\\',E'\\\\'),
        '%',E'\\%'
      ),
      '_',E'\\_'
    ) || '%';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(row.payload order by row.created_at desc,row.id desc),
    '[]'::jsonb
  ) into v_rows
  from (
    select membership.id,membership.created_at,
      pg_catalog.jsonb_build_object(
        'membershipId',membership.id,
        'companyId',membership.company_id,
        'companyLegalName',company.legal_name,
        'displayName',profile.display_name,
        'email',profile.email::text,
        'status',membership.status,
        'modules',coalesce((
          select pg_catalog.jsonb_agg(module.module order by module.module)
          from public.member_modules module
          where module.membership_id=membership.id
            and module.company_id=membership.company_id
        ),'[]'::jsonb),
        'createdAt',membership.created_at,
        'version',membership.version,
        'mustChangePassword',profile.must_change_password,
        'temporaryPasswordExpiresAt',profile.temporary_password_expires_at,
        'accessState',case
          when company.status='archived'::public.company_status
            then 'archived_company'
          when membership.status='suspended'::public.membership_status
               or not profile.is_active then 'suspended'
          when profile.must_change_password then 'password_change_required'
          else 'active'
        end
      ) as payload
    from public.company_memberships membership
    join public.profiles profile on profile.user_id=membership.user_id
    join public.companies company on company.id=membership.company_id
    where membership.role='company_admin'::public.membership_role
      and (
        p_cursor_created_at is null
        or (membership.created_at,membership.id)
          <(p_cursor_created_at,p_cursor_membership_id)
      )
      and (
        v_search is null
        or membership.id in (
          select profile_membership.id
          from public.company_memberships profile_membership
          join public.profiles matched_profile
            on matched_profile.user_id=profile_membership.user_id
          where profile_membership.role='company_admin'::public.membership_role
            and (
              pg_catalog.lower(matched_profile.display_name)
                like v_pattern escape E'\\'
              or pg_catalog.lower(matched_profile.email::text)
                like v_pattern escape E'\\'
            )
          union
          select company_membership.id
          from public.company_memberships company_membership
          join public.companies matched_company
            on matched_company.id=company_membership.company_id
          where company_membership.role='company_admin'::public.membership_role
            and pg_catalog.lower(matched_company.legal_name)
              like v_pattern escape E'\\'
        )
      )
    order by membership.created_at desc,membership.id desc
    limit p_limit+1
  ) row;

  if pg_catalog.jsonb_array_length(v_rows)>p_limit then
    v_rows := v_rows-p_limit;
    v_next_cursor := pg_catalog.jsonb_build_object(
      'createdAt',v_rows->(p_limit-1)->'createdAt',
      'membershipId',v_rows->(p_limit-1)->'membershipId'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'items',v_rows,
    'nextCursor',v_next_cursor
  );
end;
$$;

create function private.internal_list_platform_audit_events(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_action text,
  p_resource_type text,
  p_outcome public.audit_outcome,
  p_cursor_occurred_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $$
declare
  v_result jsonb;
begin
  perform private.assert_platform_read_actor(
    p_actor_user_id,p_session_id
  );

  if p_limit is null or p_limit not between 1 and 100
     or (p_cursor_occurred_at is null) <> (p_cursor_id is null)
     or (
       p_action is not null
       and (
         pg_catalog.char_length(p_action) not between 3 and 128
         or p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
       )
     )
     or (
       p_resource_type is not null
       and (
         pg_catalog.char_length(p_resource_type) not between 1 and 64
         or p_resource_type !~ '^[a-z][a-z0-9_]*$'
       )
     ) then
    raise exception using errcode='22023',
      message='AXSYS_PLATFORM_AUDIT_INPUT_INVALID';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(row.payload order by row.occurred_at desc,row.id desc),
    '[]'::jsonb
  ) into v_result
  from (
    select audit.id,audit.occurred_at,
      pg_catalog.jsonb_build_object(
        'id',audit.id,
        'actorUserId',audit.actor_user_id,
        'action',audit.action,
        'resourceType',audit.resource_type,
        'resourceId',audit.resource_id,
        'outcome',audit.outcome,
        'reasonCode',audit.reason_code,
        'correlationId',audit.correlation_id,
        'metadata',private.platform_audit_safe_metadata(audit.metadata),
        'occurredAt',audit.occurred_at
      ) as payload
    from public.audit_events audit
    where audit.scope='platform'::public.audit_scope
      and (p_action is null or audit.action=p_action)
      and (p_resource_type is null or audit.resource_type=p_resource_type)
      and (p_outcome is null or audit.outcome=p_outcome)
      and (
        p_cursor_occurred_at is null
        or (audit.occurred_at,audit.id)<(p_cursor_occurred_at,p_cursor_id)
      )
    order by audit.occurred_at desc,audit.id desc
    limit p_limit
  ) row;

  return v_result;
end;
$$;

create function private.internal_get_platform_health(
  p_actor_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $$
declare
  v_checked_at timestamptz := pg_catalog.clock_timestamp();
  v_pending_provisioning bigint;
  v_pending_company bigint;
  v_pending_member bigint;
  v_pending_file_cleanup bigint;
  v_scan_failures bigint;
  v_storage_bytes bigint;
  v_reserved_storage_bytes bigint;
  v_companies_near_quota bigint;
  v_quota_drift_alerts bigint;
begin
  perform private.assert_platform_read_actor(
    p_actor_user_id,p_session_id
  );

  select pg_catalog.count(*) into v_pending_provisioning
  from public.provisioning_operations operation
  where operation.status='compensation_required'::public.provisioning_status
     or (
       operation.status in (
         'reserved'::public.provisioning_status,
         'auth_created'::public.provisioning_status
       )
       and operation.updated_at<v_checked_at-interval '15 minutes'
     );

  select pg_catalog.count(*) into v_pending_company
  from private.company_access_reconciliations reconciliation
  where reconciliation.status='pending';

  select pg_catalog.count(*) into v_pending_member
  from private.member_auth_access_reconciliations reconciliation
  where reconciliation.status='pending';

  select pg_catalog.count(*) into v_pending_file_cleanup
  from public.file_upload_intents intent
  where intent.status='cleanup_required'::public.upload_intent_status;

  select pg_catalog.count(*) into v_scan_failures
  from public.file_objects file_object
  where file_object.scan_status='failed'::public.file_scan_status;

  select coalesce(pg_catalog.sum(usage.used_bytes),0)::bigint,
         coalesce(pg_catalog.sum(usage.reserved_bytes),0)::bigint,
         pg_catalog.count(*) filter (
           where usage.used_bytes*5+usage.reserved_bytes*5
             >=usage.quota_bytes*4
         )::bigint
  into v_storage_bytes,v_reserved_storage_bytes,v_companies_near_quota
  from private.company_storage_usage usage;

  with expected_used as (
    select file_object.company_id,
           coalesce(pg_catalog.sum(file_object.byte_size),0)::bigint as bytes
    from public.file_objects file_object
    where file_object.promoted_at is not null
      and file_object.quota_released_at is null
    group by file_object.company_id
  ), expected_reserved as (
    select intent.company_id,
           coalesce(pg_catalog.sum(intent.quota_hold_bytes),0)::bigint as bytes
    from public.file_upload_intents intent
    where intent.quota_hold_bytes>0
    group by intent.company_id
  )
  select pg_catalog.count(*)::bigint into v_quota_drift_alerts
  from private.company_storage_usage usage
  left join expected_used on expected_used.company_id=usage.company_id
  left join expected_reserved on expected_reserved.company_id=usage.company_id
  where usage.used_bytes<>coalesce(expected_used.bytes,0)
     or usage.reserved_bytes<>coalesce(expected_reserved.bytes,0);

  return pg_catalog.jsonb_build_object(
    'checkedAt',v_checked_at,
    'pendingCompensations',
      v_pending_provisioning+v_pending_company+v_pending_member,
    'pendingCompanyAccessReconciliations',v_pending_company,
    'pendingMemberAccessReconciliations',v_pending_member,
    'pendingFileCleanup',v_pending_file_cleanup,
    'scanFailures',v_scan_failures,
    'storageBytes',v_storage_bytes,
    'reservedStorageBytes',v_reserved_storage_bytes,
    'companiesNearQuota',v_companies_near_quota,
    'quotaDriftAlerts',v_quota_drift_alerts
  );
end;
$$;

create function private.internal_get_platform_dashboard(
  p_actor_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $$
declare
  v_checked_at timestamptz := pg_catalog.clock_timestamp();
  v_active_companies bigint;
  v_archived_companies bigint;
  v_active_admins bigint;
  v_active_users bigint;
  v_active_bank_accounts bigint;
  v_archived_bank_accounts bigint;
  v_pending_provisioning bigint;
  v_pending_company bigint;
  v_pending_member bigint;
begin
  perform private.assert_platform_read_actor(p_actor_user_id,p_session_id);

  select pg_catalog.count(*) filter (
           where company.status='active'::public.company_status
         )::bigint,
         pg_catalog.count(*) filter (
           where company.status='archived'::public.company_status
         )::bigint
  into v_active_companies,v_archived_companies
  from public.companies company;

  select pg_catalog.count(*) filter (
           where membership.role='company_admin'::public.membership_role
         )::bigint,
         pg_catalog.count(*)::bigint
  into v_active_admins,v_active_users
  from public.company_memberships membership
  join public.profiles profile on profile.user_id=membership.user_id
  join public.companies company on company.id=membership.company_id
  where membership.status='active'::public.membership_status
    and profile.is_active
    and company.status='active'::public.company_status;

  select pg_catalog.count(*) filter (
           where bank.status='active'::public.bank_account_status
         )::bigint,
         pg_catalog.count(*) filter (
           where bank.status='archived'::public.bank_account_status
         )::bigint
  into v_active_bank_accounts,v_archived_bank_accounts
  from public.company_bank_accounts bank;

  select pg_catalog.count(*) into v_pending_provisioning
  from public.provisioning_operations operation
  where operation.status='compensation_required'::public.provisioning_status
     or (
       operation.status in (
         'reserved'::public.provisioning_status,
         'auth_created'::public.provisioning_status
       )
       and operation.updated_at<v_checked_at-interval '15 minutes'
     );

  select pg_catalog.count(*) into v_pending_company
  from private.company_access_reconciliations reconciliation
  where reconciliation.status='pending';

  select pg_catalog.count(*) into v_pending_member
  from private.member_auth_access_reconciliations reconciliation
  where reconciliation.status='pending';

  return pg_catalog.jsonb_build_object(
    'checkedAt',v_checked_at,
    'activeCompanies',v_active_companies,
    'archivedCompanies',v_archived_companies,
    'activeAdmins',v_active_admins,
    'activeUsers',v_active_users,
    'activeBankAccounts',v_active_bank_accounts,
    'archivedBankAccounts',v_archived_bank_accounts,
    'pendingCompensations',
      v_pending_provisioning+v_pending_company+v_pending_member,
    'pendingCompanyAccessReconciliations',v_pending_company,
    'pendingMemberAccessReconciliations',v_pending_member
  );
end;
$$;

revoke execute on function private.assert_platform_read_actor(uuid,uuid),
  private.platform_audit_safe_metadata(jsonb),
  private.internal_list_platform_audit_events(
    uuid,uuid,text,text,public.audit_outcome,timestamptz,uuid,integer
  ),
  private.internal_get_platform_health(uuid,uuid),
  private.internal_list_platform_admins(uuid,uuid,text,timestamptz,uuid,integer),
  private.internal_get_platform_dashboard(uuid,uuid)
from public,anon,authenticated,service_role,axsys_bff;

grant execute on function private.internal_list_platform_audit_events(
  uuid,uuid,text,text,public.audit_outcome,timestamptz,uuid,integer
), private.internal_get_platform_health(uuid,uuid)
 , private.internal_list_platform_admins(uuid,uuid,text,timestamptz,uuid,integer)
 , private.internal_get_platform_dashboard(uuid,uuid)
to axsys_bff;

comment on function private.internal_list_platform_audit_events(
  uuid,uuid,text,text,public.audit_outcome,timestamptz,uuid,integer
) is 'BFF-only platform audit keyset read; actor/session/Super Admin revalidated.';
comment on function private.internal_get_platform_health(uuid,uuid)
is 'BFF-only aggregate health read; no tenant identifiers or PII returned.';
comment on function private.internal_list_platform_admins(
  uuid,uuid,text,timestamptz,uuid,integer
) is 'BFF-only global company-admin directory with bounded keyset pagination.';
comment on function private.internal_get_platform_dashboard(uuid,uuid)
is 'BFF-only global administrative counters without tenant identifiers or PII.';
