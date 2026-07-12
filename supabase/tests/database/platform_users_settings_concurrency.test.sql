\ir helpers/fixtures.inc

create temporary table task3_dblink_extension_state (
  was_present boolean not null
);
insert into task3_dblink_extension_state (was_present)
select exists (select 1 from pg_extension where extname = 'dblink');

create extension if not exists dblink with schema extensions;

-- Remove only fixed Task 3 fixtures if a previously interrupted test left
-- them committed. Trigger disable/delete/enable is one atomic transaction, so
-- production never observes the guard disabled.
begin;
do $$
begin
  if to_regprocedure(
    'private.task3_test_suspend_membership(text,uuid,uuid,double precision)'
  ) is not null then
    execute 'drop function private.task3_test_suspend_membership(text,uuid,uuid,double precision)';
  end if;
  if to_regclass('private.task3_test_concurrency_results') is not null then
    execute 'drop table private.task3_test_concurrency_results';
  end if;
end
$$;
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
delete from public.company_memberships
where id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id = '30000000-0000-4000-8000-000000000001';
delete from public.companies
where id = '30000000-0000-4000-8000-000000000001';
delete from public.profiles
where user_id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);
delete from auth.users
where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);
commit;

-- These rows must be committed so both dblink workers observe the same
-- company. They are removed atomically after finish().
begin;
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000001',
  'concurrent-admin-a1@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000002',
  'concurrent-admin-a2@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'company_admin',
  '{}'::public.module_key[]
);

create table private.task3_test_concurrency_results (
  worker text primary key,
  sqlstate text not null,
  message text not null,
  recorded_at timestamptz not null default clock_timestamp()
);

create function private.task3_test_suspend_membership(
  p_worker text,
  p_membership_id uuid,
  p_suspended_by uuid,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    update public.company_memberships
    set status = 'suspended',
        suspended_at = clock_timestamp(),
        suspended_by = p_suspended_by,
        suspension_reason = 'Concurrent invariant test'
    where id = p_membership_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'task3_test_membership_missing';
    end if;

    perform pg_catalog.pg_sleep(p_hold_seconds);
    insert into private.task3_test_concurrency_results(worker, sqlstate, message)
    values (p_worker, '00000', 'ok');
    return '00000';
  exception
    when others then
      insert into private.task3_test_concurrency_results(worker, sqlstate, message)
      values (p_worker, sqlstate, sqlerrm);
      return sqlstate;
  end;
end;
$$;
commit;

begin;
select no_plan();

select is(
  extensions.dblink_connect(
    'task3_worker_a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'worker A establishes an independent database session'
);
select is(
  extensions.dblink_connect(
    'task3_worker_b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'worker B establishes an independent database session'
);

select is(
  extensions.dblink_send_query(
    'task3_worker_a',
    $$select private.task3_test_suspend_membership(
        'worker_a',
        '40000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        1.0
      ) as result$$
  ),
  1,
  'worker A starts suspending the first active admin asynchronously'
);

select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task3_worker_a'),
  1,
  'worker A still holds the transaction while worker B is launched'
);

select is(
  extensions.dblink_send_query(
    'task3_worker_b',
    $$select private.task3_test_suspend_membership(
        'worker_b',
        '40000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        0.0
      ) as result$$
  ),
  1,
  'worker B concurrently attempts to suspend the other active admin'
);

select results_eq(
  $$select result
    from extensions.dblink_get_result('task3_worker_a') as result(result text)$$,
  $$values ('00000'::text)$$,
  'the first concurrent suspension commits'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task3_worker_b') as result(result text)$$,
  $$values ('23514'::text)$$,
  'the second concurrent suspension receives SQLSTATE 23514'
);

select results_eq(
  $$select worker, sqlstate, message
    from private.task3_test_concurrency_results
    order by worker$$,
  $$values
    ('worker_a'::text, '00000'::text, 'ok'::text),
    ('worker_b'::text, '23514'::text, 'last_active_company_admin'::text)$$,
  'concurrent workers record one success and exact last-admin rejection'
);
select results_eq(
  $$select id
    from public.company_memberships
    where company_id = '30000000-0000-4000-8000-000000000001'
      and role = 'company_admin'
      and status = 'active'
    order by id$$,
  $$values ('40000000-0000-4000-8000-000000000002'::uuid)$$,
  'exactly one active company admin remains after the race'
);

select throws_ok(
  format(
    'update public.company_memberships set company_id = %L where id = %L',
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001'
  ),
  'P0001',
  'AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE',
  'membership cannot move between tenants'
);
select throws_ok(
  $$update public.company_memberships
    set user_id = '20000000-0000-4000-8000-000000000002'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE',
  'membership cannot be reassigned to another identity'
);
select throws_ok(
  format(
    'delete from public.company_memberships where id = %L',
    '40000000-0000-4000-8000-000000000001'
  ),
  '23514',
  'membership_delete_forbidden',
  'memberships are suspended, never deleted'
);
select throws_ok(
  format(
    'delete from public.company_memberships where id = %L',
    '40000000-0000-4000-8000-000000000002'
  ),
  '23514',
  'membership_delete_forbidden',
  'even the remaining active admin cannot be deleted'
);

select is(
  extensions.dblink_disconnect('task3_worker_a'),
  'OK',
  'worker A disconnects cleanly'
);
select is(
  extensions.dblink_disconnect('task3_worker_b'),
  'OK',
  'worker B disconnects cleanly'
);

select * from finish();
commit;

-- Restore a pristine database even though the true workers committed.
begin;
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
delete from public.company_memberships
where id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id = '30000000-0000-4000-8000-000000000001';
delete from public.companies
where id = '30000000-0000-4000-8000-000000000001';
delete from public.profiles
where user_id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);
delete from auth.users
where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);
drop function private.task3_test_suspend_membership(text,uuid,uuid,double precision);
drop table private.task3_test_concurrency_results;
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
commit;

do $$
begin
  if not (select was_present from task3_dblink_extension_state) then
    execute 'drop extension dblink';
  end if;
end
$$;
