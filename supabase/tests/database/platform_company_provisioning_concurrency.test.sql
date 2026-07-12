\ir helpers/fixtures.inc

begin;
create temporary table task5_company_dblink_extension_state (
  was_present boolean not null
);
insert into task5_company_dblink_extension_state (was_present)
select exists (select 1 from pg_extension where extname = 'dblink')
  and to_regclass('private.task5_test_company_run_marker') is null;

create extension if not exists dblink with schema extensions;
create table if not exists private.task5_test_company_run_marker (
  singleton boolean primary key default true check (singleton)
);
commit;

-- Remove only fixed fixtures if an interrupted run left committed state.
begin;
do $$
begin
  if to_regprocedure(
    'private.task5_test_reserve_company_provisioning(double precision)'
  ) is not null then
    execute 'drop function private.task5_test_reserve_company_provisioning(double precision)';
  end if;
  if to_regprocedure(
    'private.task5_test_commit_company_provisioning(uuid,uuid,uuid,uuid,double precision)'
  ) is not null then
    execute 'drop function private.task5_test_commit_company_provisioning(uuid,uuid,uuid,uuid,double precision)';
  end if;
  if to_regclass('private.task5_test_company_operation_refs') is not null then
    execute 'drop table private.task5_test_company_operation_refs';
  end if;
end
$$;

alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
  '83000000-0000-4000-8000-000000000201',
  '83000000-0000-4000-8000-000000000202',
  '83000000-0000-4000-8000-000000000203',
  '83000000-0000-4000-8000-000000000204'
);
alter table public.audit_events enable trigger user;

delete from public.provisioning_operations
where actor_user_id = '23000000-0000-4000-8000-000000000201'
   or correlation_id in (
     '83000000-0000-4000-8000-000000000202',
     '83000000-0000-4000-8000-000000000203',
     '83000000-0000-4000-8000-000000000204'
   );

alter table public.company_memberships disable trigger user;
delete from public.member_modules
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from public.company_memberships
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
alter table public.company_memberships enable trigger user;

delete from public.company_settings
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from private.company_storage_usage
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from public.companies
where id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);

delete from auth.sessions
where id = '93000000-0000-4000-8000-000000000201';
delete from public.platform_roles
where user_id = '23000000-0000-4000-8000-000000000201';
delete from public.profiles
where user_id in (
  '23000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000202'
);
delete from auth.users
where id in (
  '23000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000202'
);
commit;

-- Fixtures and wrappers must commit so independent dblink sessions see them.
begin;
select test_helpers.create_auth_user(
  '23000000-0000-4000-8000-000000000201',
  'platform-company-race@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '23000000-0000-4000-8000-000000000201',
  'platform-company-race@example.test',
  'Platform Company Race'
);
insert into public.platform_roles(user_id,role,is_active)
values (
  '23000000-0000-4000-8000-000000000201',
  'super_admin',
  true
);
select test_helpers.create_auth_session(
  '93000000-0000-4000-8000-000000000201',
  '23000000-0000-4000-8000-000000000201',
  pg_catalog.statement_timestamp() - interval '1 minute'
);
select private.register_auth_session(
  '93000000-0000-4000-8000-000000000201',
  '23000000-0000-4000-8000-000000000201',
  false
);
select private.write_authenticated_audit_event(
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  'auth.login',
  'session',
  null,
  'success',
  null,
  '83000000-0000-4000-8000-000000000201',
  null,
  null,
  '{"rememberMe":false}'::jsonb
);

select test_helpers.create_auth_user(
  '24000000-0000-4000-8000-000000000201',
  'company-race-admin-a@example.test'
);
select test_helpers.create_auth_user(
  '24000000-0000-4000-8000-000000000202',
  'company-race-admin-b@example.test'
);

create table private.task5_test_company_operation_refs (
  label text primary key,
  operation_id uuid not null unique
);

insert into private.task5_test_company_operation_refs(label,operation_id)
select 'cnpj-a', operation.id
from private.internal_reserve_company_provisioning(
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  repeat('1',64),repeat('2',64),repeat('3',64),
  '83000000-0000-4000-8000-000000000203'
) operation;
select private.internal_mark_provisioning_auth_created(
  (select operation_id from private.task5_test_company_operation_refs
    where label = 'cnpj-a'),
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000201'
);

insert into private.task5_test_company_operation_refs(label,operation_id)
select 'cnpj-b', operation.id
from private.internal_reserve_company_provisioning(
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  repeat('4',64),repeat('5',64),repeat('6',64),
  '83000000-0000-4000-8000-000000000204'
) operation;
select private.internal_mark_provisioning_auth_created(
  (select operation_id from private.task5_test_company_operation_refs
    where label = 'cnpj-b'),
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000202'
);

create function private.task5_test_reserve_company_provisioning(
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_operation_id uuid;
begin
  select operation.id
  into strict v_operation_id
  from private.internal_reserve_company_provisioning(
    '23000000-0000-4000-8000-000000000201',
    '93000000-0000-4000-8000-000000000201',
    repeat('7',64),repeat('8',64),repeat('9',64),
    '83000000-0000-4000-8000-000000000202'
  ) operation;
  perform pg_catalog.pg_sleep(p_hold_seconds);
  return v_operation_id::text;
end;
$$;

create function private.task5_test_commit_company_provisioning(
  p_operation_id uuid,
  p_auth_user_id uuid,
  p_company_id uuid,
  p_correlation_id uuid,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.internal_commit_company_provisioning(
      p_operation_id,
      '23000000-0000-4000-8000-000000000201',
      '93000000-0000-4000-8000-000000000201',
      p_auth_user_id,
      p_company_id,
      'Empresa Concorrente Ltda.',
      'Empresa Concorrente',
      '44555666000177',
      'contato-concorrente@example.test'::extensions.citext,
      null,
      'America/Fortaleza',
      case
        when p_auth_user_id = '24000000-0000-4000-8000-000000000201'::uuid
          then 'Administradora Concorrente A'
        else 'Administradora Concorrente B'
      end,
      case
        when p_auth_user_id = '24000000-0000-4000-8000-000000000201'::uuid
          then 'company-race-admin-a@example.test'::extensions.citext
        else 'company-race-admin-b@example.test'::extensions.citext
      end,
      array['administrative','financial']::public.module_key[],
      p_correlation_id
    );
    perform pg_catalog.pg_sleep(p_hold_seconds);
    return '00000';
  exception
    when others then
      return sqlstate;
  end;
end;
$$;

revoke execute on function private.task5_test_reserve_company_provisioning(
  double precision
), private.task5_test_commit_company_provisioning(
  uuid,uuid,uuid,uuid,double precision
) from public, anon, authenticated, service_role, axsys_bff;
commit;

begin;
select no_plan();
create temporary table task5_company_worker_results (
  label text primary key,
  result text not null
);

select is(
  extensions.dblink_connect(
    'task5_company_worker_a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'company provisioning worker A establishes an independent session'
);
select is(
  extensions.dblink_connect(
    'task5_company_worker_b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'company provisioning worker B establishes an independent session'
);
select is(
  extensions.dblink_exec(
    'task5_company_worker_a',
    'set statement_timeout = ''5s'''
  ),
  'SET',
  'company provisioning worker A has a bounded statement timeout'
);
select is(
  extensions.dblink_exec(
    'task5_company_worker_b',
    'set statement_timeout = ''5s'''
  ),
  'SET',
  'company provisioning worker B has a bounded statement timeout'
);

select is(
  extensions.dblink_send_query(
    'task5_company_worker_a',
    $$select private.task5_test_reserve_company_provisioning(1.0) as result$$
  ),
  1,
  'worker A reserves the shared idempotency key and holds the transaction'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task5_company_worker_a'),
  1,
  'worker A still owns the serialized provisioning lock'
);
select is(
  extensions.dblink_send_query(
    'task5_company_worker_b',
    $$select private.task5_test_reserve_company_provisioning(0.0) as result$$
  ),
  1,
  'worker B races the same actor and idempotency key'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task5_company_worker_b'),
  1,
  'worker B waits while worker A owns the provisioning lock'
);
insert into task5_company_worker_results(label,result)
select 'reserve-a', result
from extensions.dblink_get_result('task5_company_worker_a')
  as result(result text);
select results_eq(
  $$select result from task5_company_worker_results where label = 'reserve-a'$$,
  $$select id::text from public.provisioning_operations
    where actor_user_id = '23000000-0000-4000-8000-000000000201'
      and idempotency_key = repeat('7',64)$$,
  'worker A returns the sole reserved operation'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_a')
      as result(result text)$$,
  'worker A drains its asynchronous reservation command'
);
insert into task5_company_worker_results(label,result)
select 'reserve-b', result
from extensions.dblink_get_result('task5_company_worker_b')
  as result(result text);
select results_eq(
  $$select result from task5_company_worker_results where label = 'reserve-b'$$,
  $$select id::text from public.provisioning_operations
    where actor_user_id = '23000000-0000-4000-8000-000000000201'
      and idempotency_key = repeat('7',64)$$,
  'worker B converges on the same reserved operation'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_b')
      as result(result text)$$,
  'worker B drains its asynchronous reservation command'
);
select is(
  (select count(*) from public.provisioning_operations
    where actor_user_id = '23000000-0000-4000-8000-000000000201'
      and idempotency_key = repeat('7',64)),
  1::bigint,
  'the concurrent idempotency race persists exactly one journal row'
);

select is(
  extensions.dblink_send_query(
    'task5_company_worker_a',
    format(
      'select private.task5_test_commit_company_provisioning(%L,%L,%L,%L,1.0) as result',
      (select operation_id from private.task5_test_company_operation_refs
        where label = 'cnpj-a'),
      '24000000-0000-4000-8000-000000000201',
      '33000000-0000-4000-8000-000000000201',
      '83000000-0000-4000-8000-000000000203'
    )
  ),
  1,
  'worker A begins committing the first company for the duplicate CNPJ race'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task5_company_worker_a'),
  1,
  'worker A holds the transaction after creating its complete company graph'
);
select is(
  extensions.dblink_send_query(
    'task5_company_worker_b',
    format(
      'select private.task5_test_commit_company_provisioning(%L,%L,%L,%L,0.0) as result',
      (select operation_id from private.task5_test_company_operation_refs
        where label = 'cnpj-b'),
      '24000000-0000-4000-8000-000000000202',
      '33000000-0000-4000-8000-000000000202',
      '83000000-0000-4000-8000-000000000204'
    )
  ),
  1,
  'worker B races a different operation with the same normalized CNPJ'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task5_company_worker_b'),
  1,
  'worker B waits for serialized identity and provisioning state'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_a')
      as result(result text)$$,
  $$values ('00000'::text)$$,
  'the first duplicate-CNPJ worker commits successfully'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_a')
      as result(result text)$$,
  'the winning company worker drains its asynchronous command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_b')
      as result(result text)$$,
  $$values ('23505'::text)$$,
  'the second duplicate-CNPJ worker receives the unique-constraint SQLSTATE'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task5_company_worker_b')
      as result(result text)$$,
  'the losing company worker drains its asynchronous command'
);

select results_eq(
  $$select id, cnpj_normalized, timezone, status::text
    from public.companies
    where cnpj_normalized = '44555666000177'$$,
  $$values (
    '33000000-0000-4000-8000-000000000201'::uuid,
    '44555666000177','America/Fortaleza','active'
  )$$,
  'the duplicate-CNPJ race persists exactly the winning company'
);
select results_eq(
  $$select reference.label, operation.status::text, operation.company_id,
           operation.auth_user_id, operation.last_error_code
    from private.task5_test_company_operation_refs reference
    join public.provisioning_operations operation
      on operation.id = reference.operation_id
    order by reference.label$$,
  $$values
    ('cnpj-a','committed',
      '33000000-0000-4000-8000-000000000201'::uuid,
      '24000000-0000-4000-8000-000000000201'::uuid,null::text),
    ('cnpj-b','auth_created',null::uuid,
      '24000000-0000-4000-8000-000000000202'::uuid,null::text)$$,
  'winner is committed while the loser remains resumable for compensation'
);
select results_eq(
  $$select
      (select count(*) from public.profiles
       where user_id in (
         '24000000-0000-4000-8000-000000000201',
         '24000000-0000-4000-8000-000000000202'
       )),
      (select count(*) from public.company_memberships
       where company_id in (
         '33000000-0000-4000-8000-000000000201',
         '33000000-0000-4000-8000-000000000202'
       )),
      (select count(*) from public.member_modules
       where company_id in (
         '33000000-0000-4000-8000-000000000201',
         '33000000-0000-4000-8000-000000000202'
       )),
      (select count(*) from public.company_settings
       where company_id in (
         '33000000-0000-4000-8000-000000000201',
         '33000000-0000-4000-8000-000000000202'
       )),
      (select count(*) from private.company_storage_usage
       where company_id in (
         '33000000-0000-4000-8000-000000000201',
         '33000000-0000-4000-8000-000000000202'
       )),
      (select count(*) from public.audit_events
       where action = 'company.created'
         and correlation_id in (
           '83000000-0000-4000-8000-000000000203',
           '83000000-0000-4000-8000-000000000204'
         ))$$,
  $$values (1::bigint,1::bigint,2::bigint,1::bigint,1::bigint,1::bigint)$$,
  'losing transaction leaves no partial profile, membership, module, setting, quota or audit'
);

select private.internal_mark_provisioning_compensation(
  (select operation_id from private.task5_test_company_operation_refs
    where label = 'cnpj-b'),
  '23000000-0000-4000-8000-000000000201',
  '93000000-0000-4000-8000-000000000201',
  'compensated'::public.provisioning_status,
  'DB_COMMIT_FAILED'
);
select results_eq(
  $$select status::text, last_error_code, company_id
    from public.provisioning_operations
    where id = (
      select operation_id from private.task5_test_company_operation_refs
      where label = 'cnpj-b'
    )$$,
  $$values ('compensated','DB_COMMIT_FAILED',null::uuid)$$,
  'the losing operation accepts the closed compensation transition'
);
select is_empty(
  $$select operation.id from public.provisioning_operations operation
    where operation.actor_user_id = '23000000-0000-4000-8000-000000000201'
      and to_jsonb(operation)::text ~*
        '(company-race-admin|contato-concorrente|44555666000177|Empresa Concorrente)'$$,
  'concurrent journal rows retain no email, CNPJ or company name plaintext'
);

select is(
  extensions.dblink_disconnect('task5_company_worker_a'),
  'OK',
  'company provisioning worker A disconnects cleanly'
);
select is(
  extensions.dblink_disconnect('task5_company_worker_b'),
  'OK',
  'company provisioning worker B disconnects cleanly'
);

select * from finish();
commit;

-- Restore the pristine database after independently committed workers.
begin;
alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
  '83000000-0000-4000-8000-000000000201',
  '83000000-0000-4000-8000-000000000202',
  '83000000-0000-4000-8000-000000000203',
  '83000000-0000-4000-8000-000000000204'
);
alter table public.audit_events enable trigger user;

delete from public.provisioning_operations
where actor_user_id = '23000000-0000-4000-8000-000000000201';

alter table public.company_memberships disable trigger user;
delete from public.member_modules
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from public.company_memberships
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
alter table public.company_memberships enable trigger user;

delete from public.company_settings
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from private.company_storage_usage
where company_id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);
delete from public.companies
where id in (
  '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000202'
);

delete from auth.sessions
where id = '93000000-0000-4000-8000-000000000201';
delete from public.platform_roles
where user_id = '23000000-0000-4000-8000-000000000201';
delete from public.profiles
where user_id in (
  '23000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000202'
);
delete from auth.users
where id in (
  '23000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000201',
  '24000000-0000-4000-8000-000000000202'
);

drop function private.task5_test_reserve_company_provisioning(
  double precision
);
drop function private.task5_test_commit_company_provisioning(
  uuid,uuid,uuid,uuid,double precision
);
drop table private.task5_test_company_operation_refs;
drop function test_helpers.create_auth_user(uuid,text);
drop function test_helpers.create_auth_session(uuid,uuid,timestamptz);
drop function test_helpers.create_company(uuid,text,text);
drop function test_helpers.create_company_user(
  uuid,
  text,
  uuid,
  uuid,
  public.membership_role,
  public.module_key[]
);
drop function test_helpers.set_jwt(uuid,uuid);
drop function test_helpers.clear_jwt();
drop schema test_helpers;
do $$
begin
  if not (select was_present from task5_company_dblink_extension_state) then
    execute 'drop extension dblink';
  end if;
end
$$;
drop table private.task5_test_company_run_marker;
commit;
