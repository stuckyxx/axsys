\ir helpers/fixtures.inc

begin;
create extension if not exists dblink with schema extensions;

select test_helpers.create_auth_user(
  '29000000-0000-4000-8000-000000000001','bank-race@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '29000000-0000-4000-8000-000000000001',
  'bank-race@example.test','Bank Race'
);
insert into public.platform_roles(user_id,role,is_active)
values ('29000000-0000-4000-8000-000000000001','super_admin',true);
select test_helpers.create_auth_session(
  '99000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '1 minute'
);
select private.register_auth_session(
  '99000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',false
);
select private.write_authenticated_audit_event(
  '29000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'auth.login','session',null,'success',null,
  '89000000-0000-4000-8000-000000000001',null,null,
  '{"rememberMe":false}'::jsonb
);
select test_helpers.create_company(
  '39000000-0000-4000-8000-000000000001',
  'Empresa Bank Race','90123456000101'
);
commit;

create or replace function private.task8_race_create(
  p_account_id uuid,
  p_correlation_id uuid
) returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform pg_catalog.set_config('statement_timeout','8s',true);
  perform private.internal_upsert_bank_account(
    '29000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',p_account_id,
    '001','Banco Race','YnJhbmNo','AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','YWNjb3VudA==',
    'AQEBAQEBAQEBAQEB','AQEBAQEBAQEBAQEBAQEBAQ==',1,
    right(replace(p_account_id::text,'-',''),4),'checking','Titular Race',
    null,null,null,null,null,true,null,p_correlation_id
  );
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

select plan(12);
select is(
  extensions.dblink_connect(
    'task8a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),'OK','worker A connects'
);
select is(
  extensions.dblink_connect(
    'task8b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),'OK','worker B connects'
);
select is(extensions.dblink_send_query(
  'task8a',
  $$select private.task8_race_create(
    '59000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000011'
  )$$
),1,'worker A starts a default create');
select is(extensions.dblink_send_query(
  'task8b',
  $$select private.task8_race_create(
    '59000000-0000-4000-8000-000000000002',
    '89000000-0000-4000-8000-000000000012'
  )$$
),1,'worker B starts a competing default create');

create temporary table task8_race_results(result text);
insert into task8_race_results
select result from extensions.dblink_get_result('task8a') as t(result text);
insert into task8_race_results
select result from extensions.dblink_get_result('task8b') as t(result text);
select is_empty(
  $$select result from extensions.dblink_get_result('task8a') as t(result text)$$,
  'worker A result is fully drained'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task8b') as t(result text)$$,
  'worker B result is fully drained'
);
select is((select count(*) from task8_race_results where result='ok'),2::bigint,
  'both serialized creates commit without unique violations or deadlocks');
select is((select count(*) from public.company_bank_accounts
  where company_id='39000000-0000-4000-8000-000000000001'
    and status='active'),2::bigint,
  'both active accounts are preserved');
select is((select count(*) from public.company_bank_accounts
  where company_id='39000000-0000-4000-8000-000000000001'
    and status='active' and is_default),1::bigint,
  'the company advisory lock deterministically preserves exactly one default');
select is((select count(*) from public.audit_events
  where correlation_id in (
    '89000000-0000-4000-8000-000000000011',
    '89000000-0000-4000-8000-000000000012'
  )),2::bigint,'both committed creates emit one audit event each');
select is(extensions.dblink_disconnect('task8a'),'OK','worker A disconnects');
select is(extensions.dblink_disconnect('task8b'),'OK','worker B disconnects');
select * from finish();

drop function private.task8_race_create(uuid,uuid);

begin;
alter table public.audit_events disable trigger user;
delete from public.audit_events where correlation_id in (
  '89000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000011',
  '89000000-0000-4000-8000-000000000012'
);
alter table public.audit_events enable trigger user;
delete from public.company_bank_accounts
where company_id='39000000-0000-4000-8000-000000000001';
delete from auth.sessions where id='99000000-0000-4000-8000-000000000001';
delete from private.company_storage_usage
where company_id='39000000-0000-4000-8000-000000000001';
delete from public.companies where id='39000000-0000-4000-8000-000000000001';
delete from public.platform_roles
where user_id='29000000-0000-4000-8000-000000000001';
delete from public.profiles
where user_id='29000000-0000-4000-8000-000000000001';
delete from auth.users
where id='29000000-0000-4000-8000-000000000001';
commit;
