\ir helpers/fixtures.inc

begin;
create temporary table task6_company_dblink_extension_state (
  was_present boolean not null
);
insert into task6_company_dblink_extension_state(was_present)
select exists (select 1 from pg_extension where extname='dblink')
  and to_regclass('private.task6_test_company_run_marker') is null;
create extension if not exists dblink with schema extensions;
create table if not exists private.task6_test_company_run_marker (
  singleton boolean primary key default true check (singleton)
);
commit;

begin;
do $$
begin
  if to_regprocedure(
    'private.task6_test_update_company(text,double precision)'
  ) is not null then
    execute 'drop function private.task6_test_update_company(text,double precision)';
  end if;
  if to_regprocedure(
    'private.task6_test_archive_company(uuid,double precision)'
  ) is not null then
    execute 'drop function private.task6_test_archive_company(uuid,double precision)';
  end if;
  if to_regprocedure(
    'private.task6_test_complete_company_reconciliation(uuid,uuid[],uuid,double precision)'
  ) is not null then
    execute 'drop function private.task6_test_complete_company_reconciliation(uuid,uuid[],uuid,double precision)';
  end if;
end
$$;
alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
  '88000000-0000-4000-8000-000000000201',
  '88000000-0000-4000-8000-000000000211',
  '88000000-0000-4000-8000-000000000212'
);
alter table public.audit_events enable trigger user;
delete from auth.sessions
where id='96000000-0000-4000-8000-000000000201';
delete from private.company_access_reconciliations
where company_id='36000000-0000-4000-8000-000000000201';
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where company_id='36000000-0000-4000-8000-000000000201';
delete from public.company_memberships
where company_id='36000000-0000-4000-8000-000000000201';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id='36000000-0000-4000-8000-000000000201';
delete from public.companies
where id='36000000-0000-4000-8000-000000000201';
delete from public.platform_roles
where user_id='26000000-0000-4000-8000-000000000201';
delete from public.profiles
where user_id in (
  '26000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000202'
);
delete from auth.users
where id in (
  '26000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000202'
);
commit;

begin;
select test_helpers.create_auth_user(
  '26000000-0000-4000-8000-000000000201',
  'platform-management-race@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '26000000-0000-4000-8000-000000000201',
  'platform-management-race@example.test',
  'Platform Management Race'
);
insert into public.platform_roles(user_id,role,is_active)
values ('26000000-0000-4000-8000-000000000201','super_admin',true);
select test_helpers.create_auth_session(
  '96000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000201',
  pg_catalog.statement_timestamp() - interval '1 minute'
);
select private.register_auth_session(
  '96000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000201',
  false
);
select private.write_authenticated_audit_event(
  '26000000-0000-4000-8000-000000000201',
  '96000000-0000-4000-8000-000000000201',
  'auth.login','session',null,'success',null,
  '88000000-0000-4000-8000-000000000201',null,null,
  '{"rememberMe":false}'::jsonb
);
select test_helpers.create_company_user(
  '26000000-0000-4000-8000-000000000202',
  'management-race-admin@example.test',
  '36000000-0000-4000-8000-000000000201',
  '46000000-0000-4000-8000-000000000201',
  'company_admin',
  array['administrative']::public.module_key[]
);

create function private.task6_test_update_company(
  p_legal_name text,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.internal_update_company(
      '26000000-0000-4000-8000-000000000201',
      '96000000-0000-4000-8000-000000000201',
      '36000000-0000-4000-8000-000000000201',
      p_legal_name,
      'Empresa CAS',
      'cas@example.test',
      null,
      'America/Fortaleza',
      1,
      '88000000-0000-4000-8000-000000000210'
    );
    perform pg_catalog.pg_sleep(p_hold_seconds);
    return '00000';
  exception
    when others then
      return sqlstate;
  end;
end;
$$;

create function private.task6_test_archive_company(
  p_correlation_id uuid,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.internal_set_company_status(
      '26000000-0000-4000-8000-000000000201',
      '96000000-0000-4000-8000-000000000201',
      '36000000-0000-4000-8000-000000000201',
      'archived'::public.company_status,
      2,
      'Encerramento concorrente autorizado.',
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

create function private.task6_test_complete_company_reconciliation(
  p_reconciliation_id uuid,
  p_failed_user_ids uuid[],
  p_correlation_id uuid,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  begin
    v_result := private.internal_complete_company_access_reconciliation(
      '26000000-0000-4000-8000-000000000201',
      '96000000-0000-4000-8000-000000000201',
      p_reconciliation_id,
      p_failed_user_ids,
      p_correlation_id
    );
    perform pg_catalog.pg_sleep(p_hold_seconds);
    return '00000:' || (v_result->>'status') || ':'
      || (v_result->>'attemptCount');
  exception
    when others then
      return sqlstate;
  end;
end;
$$;

revoke execute on function private.task6_test_update_company(
  text,double precision
), private.task6_test_archive_company(
  uuid,double precision
), private.task6_test_complete_company_reconciliation(
  uuid,uuid[],uuid,double precision
) from public, anon, authenticated, service_role, axsys_bff;
commit;

begin;
select no_plan();

select is(
  extensions.dblink_connect(
    'task6_company_worker_a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'company management worker A establishes an independent session'
);
select is(
  extensions.dblink_connect(
    'task6_company_worker_b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'company management worker B establishes an independent session'
);
select is(
  extensions.dblink_exec(
    'task6_company_worker_a','set statement_timeout = ''5s'''
  ),
  'SET',
  'company management worker A has a bounded timeout'
);
select is(
  extensions.dblink_exec(
    'task6_company_worker_b','set statement_timeout = ''5s'''
  ),
  'SET',
  'company management worker B has a bounded timeout'
);

select is(
  extensions.dblink_send_query(
    'task6_company_worker_a',
    $$select private.task6_test_update_company(
        'Empresa CAS Vencedora Ltda.',1.0
      ) as result$$
  ),
  1,
  'worker A begins the first expected-version update'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_a'),
  1,
  'worker A holds the management serialization lock after CAS success'
);
select is(
  extensions.dblink_send_query(
    'task6_company_worker_b',
    $$select private.task6_test_update_company(
        'Empresa CAS Perdedora Ltda.',0.0
      ) as result$$
  ),
  1,
  'worker B races the same company and expected version'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_b'),
  1,
  'worker B waits instead of overwriting an uncommitted winner'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  $$values ('00000'::text)$$,
  'first optimistic update commits'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  'first update worker drains its asynchronous command'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  $$values ('P0001'::text)$$,
  'second optimistic update receives the frozen version conflict SQLSTATE'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  'second update worker drains its asynchronous command'
);
select results_eq(
  $$select legal_name,version,status::text
    from public.companies
    where id='36000000-0000-4000-8000-000000000201'$$,
  $$values ('Empresa CAS Vencedora Ltda.',2::bigint,'active')$$,
  'CAS race persists only the winner and increments exactly once'
);

select is(
  extensions.dblink_send_query(
    'task6_company_worker_a',
    $$select private.task6_test_archive_company(
        '88000000-0000-4000-8000-000000000211',1.0
      ) as result$$
  ),
  1,
  'worker A begins the first expected-version archive'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_a'),
  1,
  'worker A holds company and audit changes in one transaction'
);
select is(
  extensions.dblink_send_query(
    'task6_company_worker_b',
    $$select private.task6_test_archive_company(
        '88000000-0000-4000-8000-000000000212',0.0
      ) as result$$
  ),
  1,
  'worker B races the same archive expected version'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_b'),
  1,
  'worker B waits while lifecycle and audit are uncommitted'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  $$values ('00000'::text)$$,
  'first archive commits lifecycle and audit'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  'winning archive worker drains its asynchronous command'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  $$values ('P0001'::text)$$,
  'second archive receives the frozen version conflict SQLSTATE'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  'losing archive worker drains its asynchronous command'
);
select results_eq(
  $$select company.status::text,company.version,
           company.archived_at is not null,company.archived_by,
           count(audit.id)::bigint
    from public.companies company
    left join public.audit_events audit
      on audit.resource_id=company.id
     and audit.action='company.archived'
     and audit.correlation_id in (
       '88000000-0000-4000-8000-000000000211',
       '88000000-0000-4000-8000-000000000212'
     )
    where company.id='36000000-0000-4000-8000-000000000201'
    group by company.id$$,
  $$values (
    'archived',3::bigint,true,
    '26000000-0000-4000-8000-000000000201'::uuid,1::bigint
  )$$,
  'archive race leaves one lifecycle transition and exactly one audit event'
);
select results_eq(
  $$select correlation_id,metadata
    from public.audit_events
    where action='company.archived'
      and resource_id='36000000-0000-4000-8000-000000000201'$$,
  $$values (
    '88000000-0000-4000-8000-000000000211'::uuid,
    '{"nextStatus":"archived","previousStatus":"active"}'::jsonb
  )$$,
  'only the winning archive correlation receives the redacted audit'
);
select results_eq(
  $$select count(*)::bigint,status,attempt_count,
           company_version,target_status::text,affected_user_ids
    from private.company_access_reconciliations
    where company_id='36000000-0000-4000-8000-000000000201'
    group by status,attempt_count,company_version,target_status,
             affected_user_ids$$,
  $$values (
    1::bigint,'pending',0,3::bigint,'archived',
    array['26000000-0000-4000-8000-000000000202'::uuid]
  )$$,
  'archive race creates exactly one pending reconciliation operation'
);

select is(
  extensions.dblink_send_query(
    'task6_company_worker_a',
    $$select private.task6_test_complete_company_reconciliation(
        (select id from private.company_access_reconciliations
         where company_id='36000000-0000-4000-8000-000000000201'
           and company_version=3),
        '{}'::uuid[],
        '88000000-0000-4000-8000-000000000221',1.0
      ) as result$$
  ),
  1,
  'worker A begins successful Auth reconciliation completion'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_a'),
  1,
  'worker A holds terminal reconciliation state uncommitted'
);
select is(
  extensions.dblink_send_query(
    'task6_company_worker_b',
    $$select private.task6_test_complete_company_reconciliation(
        (select id from private.company_access_reconciliations
         where company_id='36000000-0000-4000-8000-000000000201'
           and company_version=3),
        array['26000000-0000-4000-8000-000000000202'::uuid],
        '88000000-0000-4000-8000-000000000222',0.0
      ) as result$$
  ),
  1,
  'worker B reports a stale failed attempt against the same saga'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task6_company_worker_b'),
  1,
  'worker B waits for the locked saga instead of reopening it'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  $$values ('00000:complete:1'::text)$$,
  'first completion makes the saga terminal'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_a')
      as result(result text)$$,
  'winning completion worker drains its asynchronous command'
);
select results_eq(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  $$values ('P0001'::text)$$,
  'stale failed completion cannot reopen the terminal saga'
);
select is_empty(
  $$select result from extensions.dblink_get_result('task6_company_worker_b')
      as result(result text)$$,
  'stale completion worker drains its asynchronous command'
);
select results_eq(
  $$select status,attempt_count,failed_user_ids,
           last_completion_correlation_id,completed_at is not null
    from private.company_access_reconciliations
    where company_id='36000000-0000-4000-8000-000000000201'
      and company_version=3$$,
  $$values (
    'complete',1,'{}'::uuid[],
    '88000000-0000-4000-8000-000000000221'::uuid,true
  )$$,
  'completion race leaves one monotonic terminal result'
);

select is(
  extensions.dblink_disconnect('task6_company_worker_a'),
  'OK',
  'company management worker A disconnects cleanly'
);
select is(
  extensions.dblink_disconnect('task6_company_worker_b'),
  'OK',
  'company management worker B disconnects cleanly'
);
select * from finish();
commit;

begin;
alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
  '88000000-0000-4000-8000-000000000201',
  '88000000-0000-4000-8000-000000000211',
  '88000000-0000-4000-8000-000000000212'
);
alter table public.audit_events enable trigger user;
delete from auth.sessions
where id='96000000-0000-4000-8000-000000000201';
delete from private.company_access_reconciliations
where company_id='36000000-0000-4000-8000-000000000201';
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where company_id='36000000-0000-4000-8000-000000000201';
delete from public.company_memberships
where company_id='36000000-0000-4000-8000-000000000201';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id='36000000-0000-4000-8000-000000000201';
delete from public.companies
where id='36000000-0000-4000-8000-000000000201';
delete from public.platform_roles
where user_id='26000000-0000-4000-8000-000000000201';
delete from public.profiles
where user_id in (
  '26000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000202'
);
delete from auth.users
where id in (
  '26000000-0000-4000-8000-000000000201',
  '26000000-0000-4000-8000-000000000202'
);
drop function private.task6_test_update_company(text,double precision);
drop function private.task6_test_archive_company(uuid,double precision);
drop function private.task6_test_complete_company_reconciliation(
  uuid,uuid[],uuid,double precision
);
drop function test_helpers.create_auth_user(uuid,text);
drop function test_helpers.create_auth_session(uuid,uuid,timestamptz);
drop function test_helpers.create_company(uuid,text,text);
drop function test_helpers.create_company_user(
  uuid,text,uuid,uuid,public.membership_role,public.module_key[]
);
drop function test_helpers.set_jwt(uuid,uuid);
drop function test_helpers.clear_jwt();
drop schema test_helpers;
do $$
begin
  if not (select was_present from task6_company_dblink_extension_state) then
    execute 'drop extension dblink';
  end if;
end
$$;
drop table private.task6_test_company_run_marker;
commit;
