\ir helpers/fixtures.inc

begin;
create extension if not exists dblink with schema extensions;
alter table public.audit_events disable trigger user;
delete from public.audit_events where correlation_id in (
  '87200000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002',
  '87200000-0000-4000-8000-000000000003','87200000-0000-4000-8000-000000000006',
  '87200000-0000-4000-8000-000000000007'
);
alter table public.audit_events enable trigger user;
delete from auth.sessions where id in (
  '97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002'
);
delete from public.provisioning_operations where id in (
  '67200000-0000-4000-8000-000000000001','67200000-0000-4000-8000-000000000002'
);
alter table public.company_memberships disable trigger user;
delete from private.member_auth_access_reconciliations
where company_id='37200000-0000-4000-8000-000000000001';
delete from public.member_modules where company_id='37200000-0000-4000-8000-000000000001';
delete from public.company_memberships where company_id='37200000-0000-4000-8000-000000000001';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage where company_id='37200000-0000-4000-8000-000000000001';
delete from public.companies where id='37200000-0000-4000-8000-000000000001';
delete from public.platform_roles where user_id='27200000-0000-4000-8000-000000000001';
delete from public.profiles where user_id in (
  '27200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
  '27200000-0000-4000-8000-000000000003'
);
delete from auth.users where id in (
  '27200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
  '27200000-0000-4000-8000-000000000003'
);
commit;

begin;
select test_helpers.create_auth_user('27200000-0000-4000-8000-000000000001','race-platform@example.test');
insert into public.profiles(user_id,email,display_name) values
 ('27200000-0000-4000-8000-000000000001','race-platform@example.test','Race Platform');
insert into public.platform_roles(user_id,role,is_active) values
 ('27200000-0000-4000-8000-000000000001','super_admin',true);
select test_helpers.create_auth_session(
 '97200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
 statement_timestamp()-interval '1 minute');
select private.register_auth_session(
 '97200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',false);
select private.write_authenticated_audit_event(
 '27200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',
 'auth.login','session',null,'success',null,'87200000-0000-4000-8000-000000000001',
 null,null,'{"rememberMe":false}'::jsonb);
select test_helpers.create_company_user(
 '27200000-0000-4000-8000-000000000002','race-admin-a@example.test',
 '37200000-0000-4000-8000-000000000001','47200000-0000-4000-8000-000000000001',
 'company_admin','{}'::module_key[]);
select test_helpers.create_auth_session(
 '97200000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000002',
 statement_timestamp()-interval '1 minute');
insert into private.auth_session_controls(
 session_id,user_id,auth_created_at,remember_me,state,absolute_expires_at,
 created_at,updated_at
) values (
 '97200000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000002',
 (select created_at from auth.sessions where id='97200000-0000-4000-8000-000000000002'),
 false,'pending',
 statement_timestamp()+interval '8 hours',statement_timestamp()-interval '1 minute',
 statement_timestamp()-interval '1 minute'
);
select private.write_authenticated_audit_event(
 '27200000-0000-4000-8000-000000000002','97200000-0000-4000-8000-000000000002',
 'auth.login','session',null,'success',null,'87200000-0000-4000-8000-000000000006',
 null,null,'{"rememberMe":false}'::jsonb);
select test_helpers.create_company_user(
 '27200000-0000-4000-8000-000000000003','race-admin-b@example.test',
 '37200000-0000-4000-8000-000000000001','47200000-0000-4000-8000-000000000002',
 'company_admin','{}'::module_key[]);
select test_helpers.create_auth_user(
 '27200000-0000-4000-8000-000000000004','race-provisioned@example.test');
insert into public.provisioning_operations(
 id,idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
 status,correlation_id
) values
 ('67200000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),
  'company_member','27200000-0000-4000-8000-000000000001',
  '37200000-0000-4000-8000-000000000001',repeat('c',64),'reserved',
  '87200000-0000-4000-8000-000000000004'),
 ('67200000-0000-4000-8000-000000000002',repeat('d',64),repeat('e',64),
  'company_member','27200000-0000-4000-8000-000000000001',
  '37200000-0000-4000-8000-000000000001',repeat('f',64),'reserved',
  '87200000-0000-4000-8000-000000000005');
update auth.users set raw_app_meta_data=pg_catalog.jsonb_build_object(
  'axsys_provisioning_operation_id','67200000-0000-4000-8000-000000000001'
) where id='27200000-0000-4000-8000-000000000004';
commit;

create or replace function private.task7_race_demote(p_membership uuid,p_correlation uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
  perform private.internal_platform_update_company_admin(
    '27200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',
    p_membership,case when p_membership='47200000-0000-4000-8000-000000000001'
      then 'Race Admin A' else 'Race Admin B' end,
    'suspended','{}', 'concurrent administrative suspension',
    case when p_membership='47200000-0000-4000-8000-000000000001' then 2 else 1 end,
    p_correlation
  );
  return 'ok';
exception when others then return sqlerrm;
end $$;

create or replace function private.task7_race_hold_global_touch()
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  perform pg_catalog.pg_sleep(0.25);
  perform private.internal_platform_update_company_admin(
    '27200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',
    '47200000-0000-4000-8000-000000000001','Race Admin A','active','{}',null,1,
    '87200000-0000-4000-8000-000000000007');
  return 'ok';
exception when others then return sqlstate||':'||sqlerrm;
end $$;

create or replace function private.task7_race_directory()
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform 1 from private.list_company_user_directory(
    '27200000-0000-4000-8000-000000000002','97200000-0000-4000-8000-000000000002',
    null,10,null);
  return 'ok';
exception when others then return sqlstate||':'||sqlerrm;
end $$;

create or replace function private.task7_race_replay(p_operation uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform pg_catalog.pg_advisory_xact_lock(1672,0);
  perform pg_catalog.pg_sleep(0.25);
  if p_operation='67200000-0000-4000-8000-000000000001' then
    perform private.internal_reserve_company_admin_provisioning(
      '27200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',
      '37200000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64),
      '87200000-0000-4000-8000-000000000004');
  else
    perform private.internal_reserve_company_admin_provisioning(
      '27200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',
      '37200000-0000-4000-8000-000000000001',repeat('d',64),repeat('e',64),repeat('f',64),
      '87200000-0000-4000-8000-000000000005');
  end if;
  return 'ok';
exception when others then return sqlstate||':'||sqlerrm;
end $$;

create or replace function private.task7_race_mark()
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform private.internal_mark_provisioning_auth_created(
    '67200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
    '97200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000004');
  return 'ok';
exception when others then return sqlstate||':'||sqlerrm;
end $$;

create or replace function private.task7_race_compensate()
returns text language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform private.internal_mark_provisioning_compensation(
    '67200000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000001',
    '97200000-0000-4000-8000-000000000001','compensated','DB_COMMIT_FAILED');
  return 'ok';
exception when others then return sqlstate||':'||sqlerrm;
end $$;

select plan(30);
select is(extensions.dblink_connect('task7a','host=host.docker.internal port=54322 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5'),'OK','worker A connects');
select is(extensions.dblink_connect('task7b','host=host.docker.internal port=54322 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5'),'OK','worker B connects');
select is(extensions.dblink_send_query('task7a',
  $$select private.task7_race_hold_global_touch()$$),1,
  'platform mutation holds the global lock before target actor lock');
select pg_catalog.pg_sleep(0.05);
select is(extensions.dblink_send_query('task7b',
  $$select private.task7_race_directory()$$),1,
  'directory concurrently follows global before actor lock');

create temporary table task7_race_results(result text);
insert into task7_race_results select result from extensions.dblink_get_result('task7a') as t(result text);
insert into task7_race_results select result from extensions.dblink_get_result('task7b') as t(result text);
select is_empty($$select result from extensions.dblink_get_result('task7a') as t(result text)$$,
  'global-lock mutation result is fully drained');
select is_empty($$select result from extensions.dblink_get_result('task7b') as t(result text)$$,
  'directory result is fully drained');
select is((select count(*) from task7_race_results where result='ok'),2::bigint,
  'directory and mutation finish without deadlock');
select is((select version from public.company_memberships
  where id='47200000-0000-4000-8000-000000000001'),2::bigint,
  'serialized platform touch commits before the later suspension race');

truncate task7_race_results;
select is(extensions.dblink_send_query('task7a',$$select private.task7_race_demote(
 '47200000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002')$$),1,'worker A starts concurrently');
select is(extensions.dblink_send_query('task7b',$$select private.task7_race_demote(
 '47200000-0000-4000-8000-000000000002','87200000-0000-4000-8000-000000000003')$$),1,'worker B starts concurrently');

insert into task7_race_results select result from extensions.dblink_get_result('task7a') as t(result text);
insert into task7_race_results select result from extensions.dblink_get_result('task7b') as t(result text);
select is_empty($$select result from extensions.dblink_get_result('task7a') as t(result text)$$,
  'worker A drains the administrator race');
select is_empty($$select result from extensions.dblink_get_result('task7b') as t(result text)$$,
  'worker B drains the administrator race');

select is((select count(*) from task7_race_results where result='ok'),1::bigint,
  'exactly one concurrent administrator suspension commits');
select is((select count(*) from task7_race_results where result='AXSYS_LAST_ACTIVE_ADMIN'),1::bigint,
  'the competing suspension receives the stable last-admin conflict');
select is((select count(*) from public.company_memberships
  where company_id='37200000-0000-4000-8000-000000000001'
    and role='company_admin' and status='active'),1::bigint,
  'serialization preserves one active company administrator');
select is((select count(*) from public.audit_events where correlation_id in (
  '87200000-0000-4000-8000-000000000002','87200000-0000-4000-8000-000000000003')),
  1::bigint,'only the committed mutation emits an audit event');

truncate task7_race_results;
select is(extensions.dblink_send_query('task7a',
  $$select private.task7_race_replay('67200000-0000-4000-8000-000000000001')$$),
  1,'reservation replay holds the global lock');
select is(extensions.dblink_send_query('task7b',
  $$select private.task7_race_mark()$$),1,'auth-created transition races the replay');
insert into task7_race_results select result from extensions.dblink_get_result('task7a') as t(result text);
insert into task7_race_results select result from extensions.dblink_get_result('task7b') as t(result text);
select is_empty($$select result from extensions.dblink_get_result('task7a') as t(result text)$$,
  'replay worker drains the auth-created race');
select is_empty($$select result from extensions.dblink_get_result('task7b') as t(result text)$$,
  'mark worker drains the auth-created race');
select is((select count(*) from task7_race_results where result='ok'),2::bigint,
  'replay and auth-created transition finish without deadlock');
select is((select status::text from public.provisioning_operations
  where id='67200000-0000-4000-8000-000000000001'),'auth_created',
  'auth-created transition wins after the serialized replay');

truncate task7_race_results;
select is(extensions.dblink_send_query('task7a',
  $$select private.task7_race_replay('67200000-0000-4000-8000-000000000002')$$),
  1,'second reservation replay holds the global lock');
select is(extensions.dblink_send_query('task7b',
  $$select private.task7_race_compensate()$$),1,'compensation races the replay');
insert into task7_race_results select result from extensions.dblink_get_result('task7a') as t(result text);
insert into task7_race_results select result from extensions.dblink_get_result('task7b') as t(result text);
select is_empty($$select result from extensions.dblink_get_result('task7a') as t(result text)$$,
  'replay worker drains the compensation race');
select is_empty($$select result from extensions.dblink_get_result('task7b') as t(result text)$$,
  'compensation worker drains the compensation race');
select is((select count(*) from task7_race_results where result='ok'),2::bigint,
  'replay and compensation finish without deadlock');
select is((select status::text from public.provisioning_operations
  where id='67200000-0000-4000-8000-000000000002'),'compensated',
  'compensation wins after the serialized replay');

select is(extensions.dblink_disconnect('task7a'),'OK','worker A disconnects');
select is(extensions.dblink_disconnect('task7b'),'OK','worker B disconnects');
select * from finish();

drop function private.task7_race_demote(uuid,uuid);
drop function private.task7_race_replay(uuid);
drop function private.task7_race_mark();
drop function private.task7_race_compensate();
drop function private.task7_race_hold_global_touch();
drop function private.task7_race_directory();

begin;
alter table public.audit_events disable trigger user;
delete from public.audit_events where correlation_id in (
  '87200000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000002',
  '87200000-0000-4000-8000-000000000003','87200000-0000-4000-8000-000000000006',
  '87200000-0000-4000-8000-000000000007'
);
alter table public.audit_events enable trigger user;
delete from auth.sessions where id in (
  '97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002'
);
delete from public.provisioning_operations where id in (
  '67200000-0000-4000-8000-000000000001','67200000-0000-4000-8000-000000000002'
);
alter table public.company_memberships disable trigger user;
delete from private.member_auth_access_reconciliations
where company_id='37200000-0000-4000-8000-000000000001';
delete from public.member_modules where company_id='37200000-0000-4000-8000-000000000001';
delete from public.company_memberships where company_id='37200000-0000-4000-8000-000000000001';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage where company_id='37200000-0000-4000-8000-000000000001';
delete from public.companies where id='37200000-0000-4000-8000-000000000001';
delete from public.platform_roles where user_id='27200000-0000-4000-8000-000000000001';
delete from public.profiles where user_id in (
  '27200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
  '27200000-0000-4000-8000-000000000003'
);
delete from auth.users where id in (
  '27200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
  '27200000-0000-4000-8000-000000000003','27200000-0000-4000-8000-000000000004'
);
commit;
