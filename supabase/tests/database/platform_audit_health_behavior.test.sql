begin;
\ir helpers/fixtures.inc

select no_plan();

create function test_helpers.activate_task9_platform_session(
  p_user_id uuid,p_session_id uuid,p_correlation_id uuid
) returns void language plpgsql as $$
begin
  perform test_helpers.create_auth_session(
    p_session_id,p_user_id,pg_catalog.statement_timestamp()-interval '1 minute'
  );
  perform private.register_auth_session(p_session_id,p_user_id,false);
  perform private.write_authenticated_audit_event(
    p_user_id,p_session_id,'auth.login','session',null,'success',null,
    p_correlation_id,null,null,'{"rememberMe":false}'::jsonb
  );
end;
$$;

select test_helpers.create_auth_user(
  '29000000-0000-4000-8000-000000000901','task9-platform@example.test'
);
insert into public.profiles(user_id,email,display_name) values (
  '29000000-0000-4000-8000-000000000901',
  'task9-platform@example.test','Task 9 Platform'
);
insert into public.platform_roles(user_id,role,is_active) values (
  '29000000-0000-4000-8000-000000000901','super_admin',true
);
select test_helpers.activate_task9_platform_session(
  '29000000-0000-4000-8000-000000000901',
  '99000000-0000-4000-8000-000000000901',
  '89000000-0000-4000-8000-000000000901'
);

select test_helpers.create_company_user(
  '29000000-0000-4000-8000-000000000902',
  'task9-tenant@example.test',
  '39000000-0000-4000-8000-000000000901',
  '49000000-0000-4000-8000-000000000901',
  'company_admin','{}'::public.module_key[]
);
select test_helpers.activate_task9_platform_session(
  '29000000-0000-4000-8000-000000000902',
  '99000000-0000-4000-8000-000000000902',
  '89000000-0000-4000-8000-000000000902'
);
select test_helpers.create_company_user(
  '29000000-0000-4000-8000-000000000903',
  'quota-admin@example.test',
  '39000000-0000-4000-8000-000000000902',
  '49000000-0000-4000-8000-000000000902',
  'company_admin',array['financial']::public.module_key[]
);
update public.companies set legal_name='Task 9 Quota'
where id='39000000-0000-4000-8000-000000000902';
update public.company_memberships set created_at='2099-07-12 10:00:00+00'
where id in (
  '49000000-0000-4000-8000-000000000901',
  '49000000-0000-4000-8000-000000000902'
);

insert into public.audit_events(
  id,scope,company_id,actor_user_id,action,resource_type,resource_id,
  outcome,reason_code,correlation_id,metadata,occurred_at
) values
  (
    '69000000-0000-4000-8000-000000000901','platform',null,
    '29000000-0000-4000-8000-000000000901','company.archived','company',
    '39000000-0000-4000-8000-000000000901','success',null,
    '89000000-0000-4000-8000-000000000911',
    '{"previousStatus":"active","nextStatus":"archived","secret":"never","firstAdminUserId":"29000000-0000-4000-8000-000000000902"}',
    '2099-07-12 12:03:00+00'
  ),
  (
    '69000000-0000-4000-8000-000000000902','platform',null,
    '29000000-0000-4000-8000-000000000901','bank_account.created','bank_account',
    '59000000-0000-4000-8000-000000000901','success',null,
    '89000000-0000-4000-8000-000000000912',
    '{"bankCode":"001","accountLast4":"1234","madeDefault":true,"keyVersion":7,"moduleCount":"leak@example.test"}',
    '2099-07-12 12:02:00+00'
  ),
  (
    '69000000-0000-4000-8000-000000000903','platform',null,
    '29000000-0000-4000-8000-000000000901','company.created','company',
    '39000000-0000-4000-8000-000000000902','success',null,
    '89000000-0000-4000-8000-000000000913',
    '{"moduleCount":3,"accessReconciliation":"pending","unexpected":{"email":"pii@example.test"}}',
    '2099-07-12 12:01:00+00'
  ),
  (
    '69000000-0000-4000-8000-000000000904','tenant',
    '39000000-0000-4000-8000-000000000901',
    '29000000-0000-4000-8000-000000000902','user.updated','membership',
    '49000000-0000-4000-8000-000000000901','success',null,
    '89000000-0000-4000-8000-000000000914','{"moduleCount":3}',
    '2099-07-12 12:04:00+00'
  );

create temporary table task9_results(label text primary key,result jsonb not null);
grant select,insert on task9_results to axsys_bff;
grant axsys_bff to postgres;

set local role axsys_bff;
insert into task9_results values
  ('admins-page-1',private.internal_list_platform_admins(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901',null,null,null,1
  )),
  ('admins-page-2',private.internal_list_platform_admins(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901',null,
    '2099-07-12 10:00:00+00','49000000-0000-4000-8000-000000000902',100
  )),
  ('admins-search',private.internal_list_platform_admins(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901','quota',null,null,100
  ));
reset role;

select results_eq(
  $$select label,pg_catalog.jsonb_path_query_array(
             result,'$.items[*].membershipId'
           ),result->'nextCursor'
      from task9_results where label like 'admins-%'
      order by label$$,
  $$values
    ('admins-page-1','["49000000-0000-4000-8000-000000000902"]'::jsonb,
      '{"createdAt":"2099-07-12T10:00:00+00:00","membershipId":"49000000-0000-4000-8000-000000000902"}'::jsonb),
    ('admins-page-2','["49000000-0000-4000-8000-000000000901"]'::jsonb,'null'::jsonb),
    ('admins-search','["49000000-0000-4000-8000-000000000902"]'::jsonb,'null'::jsonb)$$,
  'global admins use stable created-at plus membership-id keyset and normalized search'
);
select results_eq(
  $$select item->>'companyLegalName',item->>'email',item->>'displayName',
           item->>'status',item->'modules',item->>'accessState',
           (select pg_catalog.jsonb_agg(key order by key)
              from pg_catalog.jsonb_object_keys(item) key)
      from task9_results result
      cross join lateral pg_catalog.jsonb_array_elements(result.result->'items') item
     where result.label='admins-search'$$,
  $$values (
    'Task 9 Quota','quota-admin@example.test','quota-admin','active',
    '["financial"]'::jsonb,'active',
    '["accessState","companyId","companyLegalName","createdAt","displayName","email","membershipId","modules","mustChangePassword","status","temporaryPasswordExpiresAt","version"]'::jsonb
  )$$,
  'admin DTO exposes only approved administrative identity and access fields'
);
select throws_ok(
  $$select private.internal_list_platform_admins(
      '29000000-0000-4000-8000-000000000901',
      '99000000-0000-4000-8000-000000000901',null,null,null,101)$$,
  '22023','AXSYS_PLATFORM_ADMINS_INPUT_INVALID',
  'admin directory rejects limits above one hundred'
);
select throws_ok(
  $$select private.internal_list_platform_admins(
      '29000000-0000-4000-8000-000000000901',
      '99000000-0000-4000-8000-000000000901',null,clock_timestamp(),null,10)$$,
  '22023','AXSYS_PLATFORM_ADMINS_INPUT_INVALID',
  'admin directory cursor is an inseparable pair'
);
select throws_ok(
  $$select private.internal_list_platform_admins(
      '29000000-0000-4000-8000-000000000902',
      '99000000-0000-4000-8000-000000000902',null,null,null,10)$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'tenant administrator cannot read the global admin directory'
);

set local role axsys_bff;
insert into task9_results values (
  'audit-page-1',private.internal_list_platform_audit_events(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901',
    null,null,null,null,null,2
  )
);
reset role;

select is(
  (select pg_catalog.jsonb_array_length(result) from task9_results where label='audit-page-1'),
  2,
  'audit page honors the requested bounded limit'
);
select results_eq(
  $$select item->>'id',
           (select pg_catalog.jsonb_agg(key order by key)
              from pg_catalog.jsonb_object_keys(item) key)
      from task9_results result
      cross join lateral pg_catalog.jsonb_array_elements(result.result) item
     where result.label='audit-page-1'
     order by item->>'occurredAt' desc,item->>'id' desc$$,
  $$values
    ('69000000-0000-4000-8000-000000000901','["action","actorUserId","correlationId","id","metadata","occurredAt","outcome","reasonCode","resourceId","resourceType"]'::jsonb),
    ('69000000-0000-4000-8000-000000000902','["action","actorUserId","correlationId","id","metadata","occurredAt","outcome","reasonCode","resourceId","resourceType"]'::jsonb)$$,
  'audit result contains exactly the ten allowlisted camel-case fields'
);
select results_eq(
  $$select item->>'id',item->'metadata'
      from task9_results result
      cross join lateral pg_catalog.jsonb_array_elements(result.result) item
     where result.label='audit-page-1'
     order by item->>'occurredAt' desc,item->>'id' desc$$,
  $$values
    ('69000000-0000-4000-8000-000000000901','{"nextStatus":"archived","previousStatus":"active"}'::jsonb),
    ('69000000-0000-4000-8000-000000000902','{"accountLast4":"1234","bankCode":"001","madeDefault":true}'::jsonb)$$,
  'metadata removes unknown keys and invalid values without returning PII'
);

set local role axsys_bff;
insert into task9_results values (
  'audit-page-2',private.internal_list_platform_audit_events(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901',
    null,null,null,'2099-07-12 12:02:00+00',
    '69000000-0000-4000-8000-000000000902',1
  )
),(
  'audit-filter',private.internal_list_platform_audit_events(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901',
    'company.created','company','success',null,null,100
  )
);
reset role;
select results_eq(
  $$select label,pg_catalog.jsonb_path_query_array(result,'$[*].id')
      from task9_results where label in ('audit-filter','audit-page-2')
      order by label$$,
  $$values
    ('audit-filter','["69000000-0000-4000-8000-000000000903"]'::jsonb),
    ('audit-page-2','["69000000-0000-4000-8000-000000000903"]'::jsonb)$$,
  'audit supports exact filters and strict occurred-at plus id keyset pagination'
);

select throws_ok(
  $$select private.internal_list_platform_audit_events(
      '29000000-0000-4000-8000-000000000901',
      '99000000-0000-4000-8000-000000000901',
      null,null,null,null,null,101)$$,
  '22023','AXSYS_PLATFORM_AUDIT_INPUT_INVALID',
  'audit rejects limits above one hundred'
);
select throws_ok(
  $$select private.internal_list_platform_audit_events(
      '29000000-0000-4000-8000-000000000901',
      '99000000-0000-4000-8000-000000000901',
      null,null,null,clock_timestamp(),null,10)$$,
  '22023','AXSYS_PLATFORM_AUDIT_INPUT_INVALID',
  'audit cursor timestamp and id must be supplied as a pair'
);
select throws_ok(
  $$select private.internal_list_platform_audit_events(
      '29000000-0000-4000-8000-000000000902',
      '99000000-0000-4000-8000-000000000902',
      null,null,null,null,null,10)$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'tenant administrator cannot pass the platform-scoped session guard'
);

insert into public.provisioning_operations(
  id,idempotency_key,request_hash,kind,actor_user_id,company_id,
  subject_email_hash,status,correlation_id,created_at,updated_at
) values
  (
    '79000000-0000-4000-8000-000000000901',repeat('a',64),repeat('b',64),
    'company_member','29000000-0000-4000-8000-000000000902',
    '39000000-0000-4000-8000-000000000901',repeat('c',64),
    'compensation_required','89000000-0000-4000-8000-000000000921',
    clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes'
  ),
  (
    '79000000-0000-4000-8000-000000000902',repeat('d',64),repeat('e',64),
    'company_member','29000000-0000-4000-8000-000000000902',
    '39000000-0000-4000-8000-000000000901',repeat('f',64),
    'auth_created','89000000-0000-4000-8000-000000000922',
    clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes'
  ),
  (
    '79000000-0000-4000-8000-000000000903',repeat('1',64),repeat('2',64),
    'company_member','29000000-0000-4000-8000-000000000902',
    '39000000-0000-4000-8000-000000000901',repeat('3',64),
    'reserved','89000000-0000-4000-8000-000000000923',
    clock_timestamp(),clock_timestamp()
  );

insert into private.company_access_reconciliations(
  id,company_id,company_version,target_status,affected_user_ids,status,
  actor_user_id,correlation_id
) values (
  '74000000-0000-4000-8000-000000000901',
  '39000000-0000-4000-8000-000000000901',1,'archived',
  array['29000000-0000-4000-8000-000000000902'::uuid],'pending',
  '29000000-0000-4000-8000-000000000901',
  '89000000-0000-4000-8000-000000000924'
);
insert into private.member_auth_access_reconciliations(
  id,membership_id,company_id,target_user_id,desired_state,generation,status,
  actor_user_id,operation_correlation_id
) values (
  '75000000-0000-4000-8000-000000000901',
  '49000000-0000-4000-8000-000000000901',
  '39000000-0000-4000-8000-000000000901',
  '29000000-0000-4000-8000-000000000902','banned',1,'pending',
  '29000000-0000-4000-8000-000000000901',
  '89000000-0000-4000-8000-000000000925'
);

insert into public.file_upload_intents(
  id,company_id,actor_user_id,purpose,quarantine_object_path,
  declared_name,declared_mime,declared_size,status,quota_hold_bytes,
  authorization_issued_at,upload_authorization_expires_at,cleanup_not_before
) values (
  '76000000-0000-4000-8000-000000000901',
  '39000000-0000-4000-8000-000000000901',
  '29000000-0000-4000-8000-000000000902','profile_avatar',
  '39000000/29000000/76000000/file.webp','avatar.webp','image/webp',10,
  'cleanup_required',20,clock_timestamp()-interval '30 hours',
  clock_timestamp()-interval '28 hours',clock_timestamp()-interval '3 hours'
);
insert into public.file_objects(
  id,company_id,owner_user_id,purpose,bucket,object_path,original_name,
  detected_mime,byte_size,sha256,scan_status,status,created_by
) values (
  '77000000-0000-4000-8000-000000000901',
  '39000000-0000-4000-8000-000000000901',
  '29000000-0000-4000-8000-000000000902','profile_avatar','axsys-private',
  '39000000/profile_avatar/77000000.webp','avatar.webp','image/webp',10,
  repeat('4',64),'failed','rejected',
  '29000000-0000-4000-8000-000000000902'
);
update private.company_storage_usage
set quota_bytes=104857600,used_bytes=83886080,reserved_bytes=20
where company_id='39000000-0000-4000-8000-000000000901';

insert into public.company_bank_accounts(
  id,company_id,bank_code,bank_name,
  branch_ciphertext,branch_iv,branch_tag,branch_key_version,branch_last4,
  account_ciphertext,account_iv,account_tag,account_key_version,account_last4,
  account_type,holder_name,status,is_default,created_by,updated_by,archived_at
) values
  (
    '58000000-0000-4000-8000-000000000901',
    '39000000-0000-4000-8000-000000000901','001','Banco Ativo',
    'YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'0001',
    'YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'1234',
    'checking','Empresa A','active',false,
    '29000000-0000-4000-8000-000000000901',
    '29000000-0000-4000-8000-000000000901',null
  ),
  (
    '58000000-0000-4000-8000-000000000902',
    '39000000-0000-4000-8000-000000000902','002','Banco Arquivado',
    'YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'0002',
    'YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'5678',
    'checking','Empresa B','archived',false,
    '29000000-0000-4000-8000-000000000901',
    '29000000-0000-4000-8000-000000000901',clock_timestamp()
  );

set local role axsys_bff;
insert into task9_results values (
  'health',private.internal_get_platform_health(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901'
  )
),(
  'dashboard',private.internal_get_platform_dashboard(
    '29000000-0000-4000-8000-000000000901',
    '99000000-0000-4000-8000-000000000901'
  )
);
reset role;

select results_eq(
  $$select (select pg_catalog.count(*)::integer
              from pg_catalog.jsonb_object_keys(result)),
           (result->>'pendingCompensations')::bigint,
           (result->>'pendingCompanyAccessReconciliations')::bigint,
           (result->>'pendingMemberAccessReconciliations')::bigint,
           (result->>'pendingFileCleanup')::bigint,
           (result->>'scanFailures')::bigint,
           (result->>'storageBytes')::bigint,
           (result->>'reservedStorageBytes')::bigint,
           (result->>'companiesNearQuota')::bigint,
           (result->>'quotaDriftAlerts')::bigint,
           (result->>'checkedAt')::timestamptz is not null
      from task9_results where label='health'$$,
  $$values (10,4::bigint,1::bigint,1::bigint,1::bigint,1::bigint,
            83886080::bigint,20::bigint,1::bigint,1::bigint,true)$$,
  'health returns the strict aggregate shape with real reconciliation and quota data'
);

select results_eq(
  $$select (select pg_catalog.count(*)::integer
              from pg_catalog.jsonb_object_keys(result)),
           (result->>'activeCompanies')::bigint,
           (result->>'archivedCompanies')::bigint,
           (result->>'activeAdmins')::bigint,
           (result->>'activeUsers')::bigint,
           (result->>'activeBankAccounts')::bigint,
           (result->>'archivedBankAccounts')::bigint,
           (result->>'pendingCompensations')::bigint,
           (result->>'pendingCompanyAccessReconciliations')::bigint,
           (result->>'pendingMemberAccessReconciliations')::bigint,
           (result->>'checkedAt')::timestamptz is not null
      from task9_results where label='dashboard'$$,
  $$values (10,2::bigint,0::bigint,2::bigint,2::bigint,1::bigint,1::bigint,
            4::bigint,1::bigint,1::bigint,true)$$,
  'dashboard returns exact global administrative counters without pagination or PII'
);

select throws_ok(
  $$select private.internal_get_platform_dashboard(
      '29000000-0000-4000-8000-000000000902',
      '99000000-0000-4000-8000-000000000902')$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'tenant administrator cannot read platform dashboard totals'
);

select throws_ok(
  $$select private.internal_get_platform_health(
      '29000000-0000-4000-8000-000000000902',
      '99000000-0000-4000-8000-000000000902')$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'tenant administrator cannot pass the platform health session guard'
);

update public.platform_roles set is_active=false
where user_id='29000000-0000-4000-8000-000000000901';
select throws_ok(
  $$select private.internal_get_platform_health(
      '29000000-0000-4000-8000-000000000901',
      '99000000-0000-4000-8000-000000000901')$$,
  '42501','AXSYS_PLATFORM_REQUIRED',
  'deactivated Super Admin is revalidated at call time'
);

select * from finish();
rollback;
