begin;
\ir helpers/fixtures.inc
select no_plan();

create function test_helpers.activate_cross_saga_session(
  p_user uuid,p_session uuid,p_correlation uuid
) returns void language plpgsql as $$
begin
  perform test_helpers.create_auth_session(
    p_session,p_user,statement_timestamp()-interval '1 minute'
  );
  perform private.register_auth_session(p_session,p_user,false);
  perform private.write_authenticated_audit_event(
    p_user,p_session,'auth.login','session',null,'success',null,p_correlation,
    null,null,'{"rememberMe":false}'::jsonb
  );
end $$;

select test_helpers.create_company_user(
  '27500000-0000-4000-8000-000000000001','cross-admin@example.test',
  '37500000-0000-4000-8000-000000000001','47500000-0000-4000-8000-000000000001',
  'company_admin','{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '27500000-0000-4000-8000-000000000002','cross-member@example.test',
  '37500000-0000-4000-8000-000000000001','47500000-0000-4000-8000-000000000002',
  'member','{}'::public.module_key[]
);
select test_helpers.activate_cross_saga_session(
  '27500000-0000-4000-8000-000000000001',
  '97500000-0000-4000-8000-000000000001',
  '87500000-0000-4000-8000-000000000001'
);

select test_helpers.set_jwt(
  '27500000-0000-4000-8000-000000000001',
  '97500000-0000-4000-8000-000000000001'
);
select lives_ok(
  $$select public.company_update_membership(
    '47500000-0000-4000-8000-000000000002','Cross Member','member','active','{}',
    null,1,'87500000-0000-4000-8000-000000000010')$$,
  'member unban generation starts while company is active'
);
update public.companies
set status='archived',archived_at=pg_catalog.clock_timestamp(),
    archived_by='27500000-0000-4000-8000-000000000001'
where id='37500000-0000-4000-8000-000000000001';
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27500000-0000-4000-8000-000000000001','97500000-0000-4000-8000-000000000001',
    '47500000-0000-4000-8000-000000000002','87500000-0000-4000-8000-000000000010',
    true,null,'87500000-0000-4000-8000-000000000011')$$,
  'late member unban completion is rederived after company archive'
);
select results_eq(
  $$select desired_state,status,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47500000-0000-4000-8000-000000000002'
    order by generation desc limit 1$$,
  $$values ('banned','pending','AUTH_ADMIN_STALE_EFFECT')$$,
  'company archive reopens stale member unban as pending ban'
);

update public.companies
set status='active',archived_at=null,archived_by=null
where id='37500000-0000-4000-8000-000000000001';
select test_helpers.set_jwt(
  '27500000-0000-4000-8000-000000000001',
  '97500000-0000-4000-8000-000000000001'
);
select lives_ok(
  $$select public.company_update_membership(
    '47500000-0000-4000-8000-000000000002','Cross Member','member','suspended','{}',
    'cross saga administrative suspension',2,
    '87500000-0000-4000-8000-000000000012')$$,
  'member suspension supersedes the earlier pending unban'
);
select lives_ok(
  $$select private.internal_complete_member_auth_access_reconciliation(
    '27500000-0000-4000-8000-000000000001','97500000-0000-4000-8000-000000000001',
    '47500000-0000-4000-8000-000000000002','87500000-0000-4000-8000-000000000012',
    true,null,'87500000-0000-4000-8000-000000000013')$$,
  'member ban converges before old company unban completion'
);

insert into private.company_access_reconciliations(
  id,company_id,company_version,target_status,affected_user_ids,actor_user_id,
  correlation_id,created_at,updated_at
) values (
  '67500000-0000-4000-8000-000000000001',
  '37500000-0000-4000-8000-000000000001',
  (select version from public.companies where id='37500000-0000-4000-8000-000000000001'),
  'active',array['27500000-0000-4000-8000-000000000002'::uuid],
  '27500000-0000-4000-8000-000000000001','87500000-0000-4000-8000-000000000014',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
);
update private.company_access_reconciliations
set status='complete',attempt_count=1,
    last_completion_correlation_id='87500000-0000-4000-8000-000000000015',
    completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
where id='67500000-0000-4000-8000-000000000001';
select results_eq(
  $$select desired_state,status,last_error_code
    from private.member_auth_access_reconciliations
    where membership_id='47500000-0000-4000-8000-000000000002'
    order by generation desc limit 1$$,
  $$values ('banned','pending','AUTH_ADMIN_STALE_EFFECT')$$,
  'late company unban completion reopens the latest suspended-member ban marker'
);

select * from finish();
rollback;
