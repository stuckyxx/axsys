\ir helpers/fixtures.inc

create temporary table task4_retirement_dblink_extension_state (
  was_present boolean not null
);
insert into task4_retirement_dblink_extension_state (was_present)
select exists (select 1 from pg_extension where extname = 'dblink');

create extension if not exists dblink with schema extensions;

-- Remove only fixed fixtures if a prior interrupted run left committed rows.
begin;
do $$
begin
  if to_regprocedure(
    'private.task4_test_claim_authorization(text,uuid,double precision)'
  ) is not null then
    execute 'drop function private.task4_test_claim_authorization(text,uuid,double precision)';
  end if;
  if to_regprocedure(
    'private.task4_test_complete_authorization(text,uuid,uuid,bigint,double precision)'
  ) is not null then
    execute 'drop function private.task4_test_complete_authorization(text,uuid,uuid,bigint,double precision)';
  end if;
  if to_regclass('private.task4_test_retirement_claims') is not null then
    execute 'drop table private.task4_test_retirement_claims';
  end if;
  if to_regclass('private.task4_test_retirement_completions') is not null then
    execute 'drop table private.task4_test_retirement_completions';
  end if;
end
$$;
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id = '44000000-0000-4000-8000-000000000001';
delete from public.company_memberships
where id = '44000000-0000-4000-8000-000000000001';
alter table public.company_memberships enable trigger user;
delete from public.file_upload_intents
where id in (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000002'
);
delete from private.company_storage_usage
where company_id = '34000000-0000-4000-8000-000000000001';
delete from public.companies
where id = '34000000-0000-4000-8000-000000000001';
delete from public.profiles
where user_id = '24000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '24000000-0000-4000-8000-000000000001';
commit;

-- Commit two due intents so independent dblink workers can race them.
begin;
select test_helpers.create_company_user(
  '24000000-0000-4000-8000-000000000001',
  'retirement-race@example.test',
  '34000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'::public.module_key[]
);

insert into public.file_upload_intents (
  id, company_id, actor_user_id, purpose, target_resource_id,
  quarantine_object_path, declared_name, declared_mime, declared_size,
  status, quota_hold_bytes, authorization_issued_at,
  upload_authorization_expires_at, cleanup_not_before, version,
  created_at, updated_at
) values
  (
    '62000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '24000000-0000-4000-8000-000000000001',
    'retirement-race/one', 'one.png', 'image/png', 100,
    'issued', 200,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    1, statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '62000000-0000-4000-8000-000000000002',
    '34000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '24000000-0000-4000-8000-000000000001',
    'retirement-race/two', 'two.png', 'image/png', 100,
    'issued', 200,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    1, statement_timestamp() - interval '31 hours', statement_timestamp()
  );

update private.company_storage_usage
set reserved_bytes = 400,
    version = version + 1,
    updated_at = statement_timestamp()
where company_id = '34000000-0000-4000-8000-000000000001';

create table private.task4_test_retirement_claims (
  worker text primary key,
  intent_id uuid not null,
  claim_id uuid not null,
  expected_version bigint not null
);
create table private.task4_test_retirement_completions (
  worker text primary key,
  intent_id uuid not null,
  status public.upload_intent_status not null,
  released_bytes bigint not null,
  version bigint not null
);

create function private.task4_test_claim_authorization(
  p_worker text,
  p_claim_id uuid,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_claim record;
begin
  select claim.*
  into v_claim
  from private.claim_upload_authorizations_for_retirement(1, p_claim_id) claim;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'task4_retirement_claim_missing';
  end if;

  insert into private.task4_test_retirement_claims(
    worker, intent_id, claim_id, expected_version
  ) values (
    p_worker, v_claim.intent_id, v_claim.claim_id, v_claim.expected_version
  );
  perform pg_catalog.pg_sleep(p_hold_seconds);
  return v_claim.intent_id::text;
end;
$$;

create function private.task4_test_complete_authorization(
  p_worker text,
  p_intent_id uuid,
  p_claim_id uuid,
  p_expected_version bigint,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_completion record;
begin
  select completion.*
  into strict v_completion
  from private.complete_upload_authorization_retirement(
    p_intent_id,
    p_claim_id,
    p_expected_version
  ) completion;

  insert into private.task4_test_retirement_completions(
    worker, intent_id, status, released_bytes, version
  ) values (
    p_worker,
    v_completion.intent_id,
    v_completion.status,
    v_completion.released_bytes,
    v_completion.version
  );
  perform pg_catalog.pg_sleep(p_hold_seconds);
  return v_completion.released_bytes::text;
end;
$$;
commit;

begin;
select no_plan();

select is(
  extensions.dblink_connect(
    'task4_retirement_worker_a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'retirement worker A establishes an independent session'
);
select is(
  extensions.dblink_connect(
    'task4_retirement_worker_b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'retirement worker B establishes an independent session'
);

select is(
  extensions.dblink_send_query(
    'task4_retirement_worker_a',
    $$select private.task4_test_claim_authorization(
        'worker_a',
        '75000000-0000-4000-8000-000000000001',
        1.0
      ) as result$$
  ),
  1,
  'worker A starts a claim and holds its row lock'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_retirement_worker_a'),
  1,
  'worker A remains active while its claim lock is held'
);

select is(
  extensions.dblink_send_query(
    'task4_retirement_worker_b',
    $$select private.task4_test_claim_authorization(
        'worker_b',
        '75000000-0000-4000-8000-000000000002',
        0.0
      ) as result$$
  ),
  1,
  'worker B concurrently claims another due authorization'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_retirement_worker_b'),
  0,
  'worker B does not wait behind the row locked by worker A'
);

select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_b')
      as result(result text)$$,
  $$values ('62000000-0000-4000-8000-000000000002'::text)$$,
  'worker B skips the locked first intent and claims the second'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_b')
      as result(result text)$$,
  'worker B drains the completed asynchronous claim command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_a')
      as result(result text)$$,
  $$values ('62000000-0000-4000-8000-000000000001'::text)$$,
  'worker A commits its original claim'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_a')
      as result(result text)$$,
  'worker A drains the completed asynchronous claim command'
);

select results_eq(
  $$select worker, intent_id, claim_id, expected_version
    from private.task4_test_retirement_claims order by worker$$,
  $$values
    ('worker_a', '62000000-0000-4000-8000-000000000001'::uuid,
      '75000000-0000-4000-8000-000000000001'::uuid, 2::bigint),
    ('worker_b', '62000000-0000-4000-8000-000000000002'::uuid,
      '75000000-0000-4000-8000-000000000002'::uuid, 2::bigint)$$,
  'concurrent workers receive distinct intents and claim receipts'
);
select results_eq(
  $$select id, status::text, quota_hold_bytes, authorization_retired_at
    from public.file_upload_intents
    where id in (
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000002'
    ) order by id$$,
  $$values
    ('62000000-0000-4000-8000-000000000001'::uuid,
      'issued', 200::bigint, null::timestamptz),
    ('62000000-0000-4000-8000-000000000002'::uuid,
      'issued', 200::bigint, null::timestamptz)$$,
  'concurrent claims preserve status and delete-first quota holds'
);
select results_eq(
  $$select reserved_bytes, version
    from private.company_storage_usage
    where company_id = '34000000-0000-4000-8000-000000000001'$$,
  $$values (400::bigint, 2::bigint)$$,
  'concurrent claims never release quota'
);

select is(
  extensions.dblink_send_query(
    'task4_retirement_worker_a',
    $$select private.task4_test_complete_authorization(
        'worker_a',
        '62000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000001',
        2,
        1.0
      ) as result$$
  ),
  1,
  'worker A starts completion and holds the retired intent lock'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_retirement_worker_a'),
  1,
  'worker A remains active after its exact quota release'
);
select is(
  extensions.dblink_send_query(
    'task4_retirement_worker_b',
    $$select private.task4_test_complete_authorization(
        'worker_b',
        '62000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000001',
        2,
        0.0
      ) as result$$
  ),
  1,
  'worker B concurrently replays the same completion receipt'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_retirement_worker_b'),
  1,
  'worker B waits on the same intent instead of releasing quota concurrently'
);

select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_a')
      as result(result text)$$,
  $$values ('200'::text)$$,
  'the first completion releases the remaining capability hold'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_a')
      as result(result text)$$,
  'worker A drains the completed asynchronous completion command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_b')
      as result(result text)$$,
  $$values ('0'::text)$$,
  'the concurrent replay is an idempotent zero-byte completion'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_retirement_worker_b')
      as result(result text)$$,
  'worker B drains the completed asynchronous completion command'
);
select results_eq(
  $$select worker, intent_id, status::text, released_bytes, version
    from private.task4_test_retirement_completions order by worker$$,
  $$values
    ('worker_a', '62000000-0000-4000-8000-000000000001'::uuid,
      'expired', 200::bigint, 3::bigint),
    ('worker_b', '62000000-0000-4000-8000-000000000001'::uuid,
      'expired', 0::bigint, 3::bigint)$$,
  'concurrent double-complete records one release and one replay'
);
select results_eq(
  $$select intent.status::text, intent.quota_hold_bytes,
           intent.authorization_retired_at is not null,
           usage.reserved_bytes, usage.version
    from public.file_upload_intents intent
    join private.company_storage_usage usage
      on usage.company_id = intent.company_id
    where intent.id = '62000000-0000-4000-8000-000000000001'$$,
  $$values ('expired', 0::bigint, true, 200::bigint, 3::bigint)$$,
  'concurrent double-complete releases quota exactly once'
);

select is(
  extensions.dblink_disconnect('task4_retirement_worker_a'),
  'OK',
  'retirement worker A disconnects cleanly'
);
select is(
  extensions.dblink_disconnect('task4_retirement_worker_b'),
  'OK',
  'retirement worker B disconnects cleanly'
);

select * from finish();
commit;

-- Restore a pristine database after the independently committed workers.
begin;
delete from public.file_upload_intents
where id in (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000002'
);
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id = '44000000-0000-4000-8000-000000000001';
delete from public.company_memberships
where id = '44000000-0000-4000-8000-000000000001';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id = '34000000-0000-4000-8000-000000000001';
delete from public.companies
where id = '34000000-0000-4000-8000-000000000001';
delete from public.profiles
where user_id = '24000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '24000000-0000-4000-8000-000000000001';
drop function private.task4_test_claim_authorization(text,uuid,double precision);
drop function private.task4_test_complete_authorization(
  text,uuid,uuid,bigint,double precision
);
drop table private.task4_test_retirement_claims;
drop table private.task4_test_retirement_completions;
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
  if not (select was_present from task4_retirement_dblink_extension_state) then
    execute 'drop extension dblink';
  end if;
end
$$;
