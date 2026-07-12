\ir helpers/fixtures.inc
begin;
select plan(45);

create function test_helpers.activate_task7_session(p_user uuid,p_session uuid,p_correlation uuid)
returns void language plpgsql as $$
begin
  perform test_helpers.create_auth_session(p_session,p_user,statement_timestamp()-interval '1 minute');
  perform private.register_auth_session(p_session,p_user,false);
  perform private.write_authenticated_audit_event(
    p_user,p_session,'auth.login','session',null,'success',null,p_correlation,
    null,null,'{"rememberMe":false}'::jsonb
  );
end $$;

select test_helpers.create_company_user(
  '27100000-0000-4000-8000-000000000001','admin-a@example.test',
  '37100000-0000-4000-8000-000000000001','47100000-0000-4000-8000-000000000001',
  'company_admin',array['administrative']::module_key[]
);
select test_helpers.create_company_user(
  '27100000-0000-4000-8000-000000000002','member-a@example.test',
  '37100000-0000-4000-8000-000000000001','47100000-0000-4000-8000-000000000002',
  'member',array['financial']::module_key[]
);
select test_helpers.create_company_user(
  '27100000-0000-4000-8000-000000000003','admin-b@example.test',
  '37100000-0000-4000-8000-000000000002','47100000-0000-4000-8000-000000000003',
  'company_admin','{}'::module_key[]
);
select test_helpers.activate_task7_session(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
  '87100000-0000-4000-8000-000000000001'
);
select test_helpers.create_auth_user(
  '27100000-0000-4000-8000-000000000010','platform-task7@example.test'
);
insert into public.profiles(user_id,email,display_name) values
 ('27100000-0000-4000-8000-000000000010','platform-task7@example.test','Platform Task Seven');
insert into public.platform_roles(user_id,role,is_active) values
 ('27100000-0000-4000-8000-000000000010','super_admin',true);
select test_helpers.activate_task7_session(
  '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
  '87100000-0000-4000-8000-000000000010'
);
select test_helpers.activate_task7_session(
  '27100000-0000-4000-8000-000000000003','97100000-0000-4000-8000-000000000003',
  '87100000-0000-4000-8000-000000000003'
);

create temporary table task7_results(label text primary key,result jsonb not null);
grant select,insert on task7_results to authenticated,axsys_bff;
grant axsys_bff to postgres;
grant usage on schema extensions to authenticated,axsys_bff;
do $$
declare pgtap_function record;
begin
  for pgtap_function in
    select function.oid::regprocedure::text signature
    from pg_proc function
    join pg_depend dependency on dependency.classid='pg_proc'::regclass
      and dependency.objid=function.oid and dependency.deptype='e'
    join pg_extension extension on extension.oid=dependency.refobjid
      and extension.extname='pgtap'
  loop
    execute format('grant execute on function %s to authenticated, axsys_bff',
      pgtap_function.signature);
  end loop;
end $$;

select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into task7_results values ('context',public.company_get_api_access_context());
insert into task7_results values ('reserve',public.company_reserve_member_provisioning(
  repeat('a',64),repeat('b',64),repeat('c',64),'87100000-0000-4000-8000-000000000011'
));
select throws_ok(
  $$select public.company_reserve_member_provisioning(
    repeat('a',64),repeat('d',64),repeat('c',64),'87100000-0000-4000-8000-000000000012')$$,
  'P0001','AXSYS_IDEMPOTENCY_KEY_REUSED','request hash is bound to the idempotency hash'
);
reset role;

select is((select result->>'companyId' from task7_results where label='context'),
  '37100000-0000-4000-8000-000000000001','context derives the caller company');
select is((select result->>'membershipId' from task7_results where label='context'),
  '47100000-0000-4000-8000-000000000001','context derives the caller membership');
select is((select result->>'companyStatus' from task7_results where label='context'),
  'active','context exposes only own company status');
select is((select count(*) from public.provisioning_operations where kind='company_member'
  and company_id='37100000-0000-4000-8000-000000000001'),1::bigint,
  'reservation stores exactly one tenant-bound operation');

select test_helpers.create_auth_user(
  '28100000-0000-4000-8000-000000000001','new-member@example.test'
);
update auth.users set raw_app_meta_data=pg_catalog.jsonb_build_object(
  'axsys_provisioning_operation_id',
  (select result->>'id' from task7_results where label='reserve')
) where id='28100000-0000-4000-8000-000000000001';
set local role axsys_bff;
select is(private.internal_find_provisioning_auth_user(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
  (select (result->>'id')::uuid from task7_results where label='reserve'),
  'new-member@example.test'),'28100000-0000-4000-8000-000000000001'::uuid,
  'exact operation metadata and normalized email recover the Auth user');
select is(private.internal_find_provisioning_auth_user(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
  (select (result->>'id')::uuid from task7_results where label='reserve'),
  'absent@example.test'),null::uuid,'wrong email returns no identity without enumeration');
select throws_ok(
  $$select private.internal_find_provisioning_auth_user(
    '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
    (select (result->>'id')::uuid from task7_results where label='reserve'),
    'new-member@example.test')$$,
  '23514','AXSYS_PROVISIONING_OPERATION_INVALID',
  'another actor cannot recover an operation identity');
select private.internal_mark_provisioning_auth_created(
  (select (result->>'id')::uuid from task7_results where label='reserve'),
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
  '28100000-0000-4000-8000-000000000001'
);
reset role;

select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into task7_results values ('commit',public.company_commit_member_provisioning(
  (select (result->>'id')::uuid from task7_results where label='reserve'),
  '28100000-0000-4000-8000-000000000001','New Member','new-member@example.test',
  'member',array['financial','certificates']::module_key[],
  '87100000-0000-4000-8000-000000000011'
));
reset role;

select is((select result->>'accessState' from task7_results where label='commit'),
  'password_change_required','new member is fail-closed behind provisional password');
select is((select result->>'role' from task7_results where label='commit'),'member',
  'company flow preserves the allowlisted requested role');
select ok((select must_change_password and temporary_password_expires_at
  between statement_timestamp()+interval '23 hours' and statement_timestamp()+interval '25 hours'
  from public.profiles where user_id='28100000-0000-4000-8000-000000000001'),
  'commit atomically sets the 24-hour provisional password gate');
select is((select count(*) from public.audit_events where action='user.created'
  and resource_id=(select (result->>'membershipId')::uuid from task7_results where label='commit')),
  1::bigint,'creation emits one tenant audit event');

select test_helpers.create_auth_user(
  '28100000-0000-4000-8000-000000000010','new-platform-admin@example.test'
);
set local role axsys_bff;
insert into task7_results values ('platform-reserve',
  private.internal_reserve_company_admin_provisioning(
    '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
    '37100000-0000-4000-8000-000000000001',repeat('7',64),repeat('8',64),repeat('9',64),
    '87100000-0000-4000-8000-000000000030'));
select throws_ok(
  $$select private.internal_mark_provisioning_auth_created(
    (select (result->>'id')::uuid from task7_results where label='platform-reserve'),
    '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
    '28100000-0000-4000-8000-000000000010')$$,
  '23514','AXSYS_PROVISIONING_AUTH_USER_INVALID',
  'orphan Auth identity without exact operation metadata cannot be bound');
reset role;
update auth.users set raw_app_meta_data=pg_catalog.jsonb_build_object(
  'axsys_provisioning_operation_id',
  (select result->>'id' from task7_results where label='platform-reserve')
) where id='28100000-0000-4000-8000-000000000010';
set local role axsys_bff;
select private.internal_mark_provisioning_auth_created(
  (select (result->>'id')::uuid from task7_results where label='platform-reserve'),
  '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
  '28100000-0000-4000-8000-000000000010');
select throws_ok(
  $$select private.internal_commit_company_admin_provisioning(
    '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
    (select (result->>'id')::uuid from task7_results where label='platform-reserve'),
    '28100000-0000-4000-8000-000000000010','37100000-0000-4000-8000-000000000001',
    'New Platform Admin','different@example.test','{}',
    '87100000-0000-4000-8000-000000000030')$$,
  '23514','AXSYS_PROVISIONING_AUTH_USER_INVALID',
  'commit cannot persist an email different from the operation-bound Auth identity');
insert into task7_results values ('platform-commit',
  private.internal_commit_company_admin_provisioning(
    '27100000-0000-4000-8000-000000000010','97100000-0000-4000-8000-000000000010',
    (select (result->>'id')::uuid from task7_results where label='platform-reserve'),
    '28100000-0000-4000-8000-000000000010','37100000-0000-4000-8000-000000000001',
    'New Platform Admin','new-platform-admin@example.test','{}',
    '87100000-0000-4000-8000-000000000030'));
reset role;
select is((select result->>'role' from task7_results where label='platform-commit'),
  'company_admin','platform provisioning forces the company administrator role');
select is((select result->>'accessState' from task7_results where label='platform-commit'),
  'password_change_required','platform provisioning applies the same password gate');
select is((select count(*) from public.company_memberships where
  user_id='28100000-0000-4000-8000-000000000010' and
  company_id='37100000-0000-4000-8000-000000000001'),1::bigint,
  'platform provisioning remains bound to its reserved company');

set local role axsys_bff;
select throws_ok(
  $$select private.internal_get_company_user(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000003')$$,
  'P0001','AXSYS_MEMBERSHIP_NOT_FOUND','cross-tenant detail is a neutral not-found'
);
reset role;

select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select public.company_update_membership(
    '47100000-0000-4000-8000-000000000003','Admin B','member','active','{}',null,1,
    '87100000-0000-4000-8000-000000000020')$$,
  'P0001','AXSYS_MEMBERSHIP_NOT_FOUND','cross-tenant mutation is a neutral not-found'
);
select throws_ok(
  $$select public.company_update_membership(
    '47100000-0000-4000-8000-000000000001','Admin A','company_admin','active',
    array['financial']::module_key[],null,1,'87100000-0000-4000-8000-000000000021')$$,
  '42501','AXSYS_SELF_PRIVILEGE_CHANGE','an admin cannot change own modules'
);
reset role;
update public.profiles
set must_change_password=true,
    temporary_password_expires_at=statement_timestamp()+interval '1 hour'
where user_id='27100000-0000-4000-8000-000000000002';
set local role authenticated;
insert into task7_results values ('suspend',public.company_update_membership(
  '47100000-0000-4000-8000-000000000002','Member A','member','suspended',
  array['financial']::module_key[],'administrative suspension',1,
  '87100000-0000-4000-8000-000000000022'
));
select throws_ok(
  $$select public.company_update_membership(
    '47100000-0000-4000-8000-000000000002','Member A','member','active',
    array['financial']::module_key[],null,1,'87100000-0000-4000-8000-000000000023')$$,
  'P0001','AXSYS_VERSION_CONFLICT','stale version loses the CAS race'
);
reset role;
select is((select result->>'accessState' from task7_results where label='suspend'),
  'suspended','suspension outranks the provisional-password gate');
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'$$,
  $$values ('banned','pending',0,null::text)$$,
  'suspension atomically persists a pending desired Auth ban without PII'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000022',
    false,'AUTH_ADMIN_UNAVAILABLE','87100000-0000-4000-8000-000000000026')$$,
  'failed Auth ban is recorded for health/retry without reopening DB access'
);
reset role;
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'$$,
  $$values ('banned','pending',1,'AUTH_ADMIN_UNAVAILABLE')$$,
  'failed Auth ban remains pending and observable'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000022',
    true,null,'87100000-0000-4000-8000-000000000027')$$,
  'successful retry completes the durable Auth ban reconciliation'
);
reset role;
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'$$,
  $$values ('banned','completed',2,null::text)$$,
  'successful Auth ban retry closes the pending marker'
);
select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
select lives_ok(
  $$select public.company_update_membership(
    '47100000-0000-4000-8000-000000000002','Member A','member','active',
    array['financial']::module_key[],null,2,
    '87100000-0000-4000-8000-000000000028')$$,
  'reactivation creates the next desired Auth generation'
);
reset role;
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
      and operation_correlation_id='87100000-0000-4000-8000-000000000028'$$,
  $$values ('active','pending',0,null::text)$$,
  'reactivation persists the latest desired unban generation'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000028',
    true,null,'87100000-0000-4000-8000-000000000029')$$,
  'latest desired unban generation completes'
);
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000022',
    true,null,'87100000-0000-4000-8000-000000000030')$$,
  'late completion of the old ban generation is accepted as stale'
);
reset role;
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
      and operation_correlation_id='87100000-0000-4000-8000-000000000028'$$,
  $$values ('active','pending',2,'AUTH_ADMIN_STALE_EFFECT')$$,
  'stale external completion reopens the latest desired state for retry'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000028',
    true,null,'87100000-0000-4000-8000-000000000031')$$,
  'worker retry reapplies and closes the latest desired state'
);
reset role;
select results_eq(
  $$select desired_state,status,attempt_count,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
      and operation_correlation_id='87100000-0000-4000-8000-000000000028'$$,
  $$values ('active','completed',3,null::text)$$,
  'latest desired Auth state is completed only after reapplication'
);
select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
select lives_ok(
  $$select public.company_update_membership(
    '47100000-0000-4000-8000-000000000002','Member A','member','suspended',
    array['financial']::module_key[],'second administrative suspension',3,
    '87100000-0000-4000-8000-000000000032')$$,
  'new suspension creates a newer desired ban generation'
);
reset role;
select results_eq(
  $$select desired_state,status,generation
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
    order by generation desc limit 1$$,
  $$values ('banned','pending',3::bigint)$$,
  'new suspension is the third monotonic Auth generation'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000032',
    true,null,'87100000-0000-4000-8000-000000000033')$$,
  'latest desired ban generation completes'
);
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000028',
    true,null,'87100000-0000-4000-8000-000000000034')$$,
  'late completion of the old unban generation is accepted as stale'
);
reset role;
select results_eq(
  $$select desired_state,status,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
    order by generation desc limit 1$$,
  $$values ('banned','pending','AUTH_ADMIN_STALE_EFFECT')$$,
  'stale unban completion reopens the latest desired ban for retry'
);
set local role axsys_bff;
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000002','87100000-0000-4000-8000-000000000032',
    true,null,'87100000-0000-4000-8000-000000000035')$$,
  'worker reapplies the latest desired ban after stale unban'
);
reset role;
select results_eq(
  $$select desired_state,status,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47100000-0000-4000-8000-000000000002'
    order by generation desc limit 1$$,
  $$values ('banned','completed',null::text)$$,
  'latest desired ban converges only after reapplication'
);
select is((select state::text from private.auth_session_controls
  where user_id='27100000-0000-4000-8000-000000000002' limit 1),null,
  'suspension does not fabricate a session row');
select is((select metadata ? 'reason' from public.audit_events
  where correlation_id='87100000-0000-4000-8000-000000000022'),false,
  'raw suspension reason never enters audit metadata');

update public.companies set status='archived',archived_at=clock_timestamp(),
  archived_by='27100000-0000-4000-8000-000000000001'
where id='37100000-0000-4000-8000-000000000001';
select test_helpers.set_jwt(
  '27100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000001'
);
set local role authenticated;
select is(public.company_get_api_access_context()->>'companyStatus','archived',
  'own archived tenant remains distinguishable without exposing another tenant');
select throws_ok(
  $$select public.company_reserve_member_provisioning(
    repeat('e',64),repeat('f',64),repeat('1',64),'87100000-0000-4000-8000-000000000024')$$,
  '42501','AXSYS_COMPANY_ADMIN_REQUIRED','archived tenant cannot mutate memberships'
);
reset role;

select * from finish();
rollback;
