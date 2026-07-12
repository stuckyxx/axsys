\ir helpers/fixtures.inc

begin;
create temporary table task4_download_dblink_extension_state (
  was_present boolean not null
);
insert into task4_download_dblink_extension_state (was_present)
select exists (select 1 from pg_extension where extname = 'dblink')
  and to_regclass('private.task4_test_download_run_marker') is null;

create extension if not exists dblink with schema extensions;
create table if not exists private.task4_test_download_run_marker (
  singleton boolean primary key default true check (singleton)
);
commit;

-- Remove only fixed fixtures if a prior interrupted run left committed rows.
begin;
do $$
begin
  if to_regprocedure(
    'private.task4_test_create_download(text,uuid,uuid,double precision)'
  ) is not null then
    execute 'drop function private.task4_test_create_download(text,uuid,uuid,double precision)';
  end if;
  if to_regprocedure(
    'private.task4_test_complete_download(text,text,text,double precision)'
  ) is not null then
    execute 'drop function private.task4_test_complete_download(text,text,text,double precision)';
  end if;
  if to_regprocedure(
    'private.task4_test_finalize_downloads(double precision)'
  ) is not null then
    execute 'drop function private.task4_test_finalize_downloads(double precision)';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'private.download_attempts'::regclass
      and trigger_row.tgname = 'task4_test_pause_download_begin'
      and not trigger_row.tgisinternal
  ) then
    execute 'drop trigger task4_test_pause_download_begin on private.download_attempts';
  end if;
  if to_regprocedure(
    'private.task4_test_pause_download_begin()'
  ) is not null then
    execute 'drop function private.task4_test_pause_download_begin()';
  end if;
  if to_regclass('private.task4_test_download_tokens') is not null then
    execute 'drop table private.task4_test_download_tokens';
  end if;
end
$$;
delete from private.download_attempts
where correlation_id in (
  '86000000-0000-4000-8000-000000000101',
  '86000000-0000-4000-8000-000000000102',
  '86000000-0000-4000-8000-000000000103'
);
delete from public.file_objects
where id = '66000000-0000-4000-8000-000000000103';
delete from auth.sessions
where id = '96000000-0000-4000-8000-000000000103';
alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
    '86000000-0000-4000-8000-000000000101',
    '86000000-0000-4000-8000-000000000102',
    '86000000-0000-4000-8000-000000000103',
    '85000000-0000-4000-8000-000000000103'
  );
alter table public.audit_events enable trigger user;
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id = '46000000-0000-4000-8000-000000000103';
delete from public.company_memberships
where id = '46000000-0000-4000-8000-000000000103';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id in (
  '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000002'
);
delete from public.companies
where id in (
  '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000002'
);
delete from public.profiles
where user_id = '26000000-0000-4000-8000-000000000103';
delete from auth.users
where id = '26000000-0000-4000-8000-000000000103';
commit;

-- These fixtures must commit so the independent dblink workers can race them.
begin;
select test_helpers.create_company(
  '36000000-0000-4000-8000-000000000001',
  'Download Race Ltda',
  '30303030000130'
);
select test_helpers.create_company_user(
  '26000000-0000-4000-8000-000000000103',
  'download-auth-race@example.test',
  '36000000-0000-4000-8000-000000000002',
  '46000000-0000-4000-8000-000000000103',
  'member',
  '{}'::public.module_key[]
);
select test_helpers.create_auth_session(
  '96000000-0000-4000-8000-000000000103',
  '26000000-0000-4000-8000-000000000103',
  pg_catalog.statement_timestamp() - interval '1 minute'
);
select private.register_auth_session(
  '96000000-0000-4000-8000-000000000103',
  '26000000-0000-4000-8000-000000000103',
  false
);
select private.write_authenticated_audit_event(
  '26000000-0000-4000-8000-000000000103',
  '96000000-0000-4000-8000-000000000103',
  'auth.login',
  'session',
  null,
  'success',
  null,
  '85000000-0000-4000-8000-000000000103',
  null,
  null,
  '{"rememberMe":false}'::jsonb
);

insert into public.file_objects (
  id,
  company_id,
  owner_user_id,
  purpose,
  bucket,
  object_path,
  original_name,
  detected_mime,
  byte_size,
  sha256,
  scan_status,
  status,
  created_by,
  created_at,
  promoted_at
) values (
  '66000000-0000-4000-8000-000000000103',
  '36000000-0000-4000-8000-000000000002',
  '26000000-0000-4000-8000-000000000103',
  'profile_avatar',
  'axsys-private',
  '36000000-0000-4000-8000-000000000002/profile_avatar/66000000-0000-4000-8000-000000000103.webp',
  'race-avatar.png',
  'image/webp',
  1024,
  repeat('9', 64),
  'clean',
  'ready',
  '26000000-0000-4000-8000-000000000103',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
);

create function private.task4_test_pause_download_begin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.correlation_id =
     '86000000-0000-4000-8000-000000000103'::uuid then
    perform pg_catalog.pg_sleep(1.0);
  end if;
  return new;
end;
$$;

create trigger task4_test_pause_download_begin
before insert on private.download_attempts
for each row execute function private.task4_test_pause_download_begin();

create table private.task4_test_download_tokens (
  label text primary key,
  attempt_id uuid not null unique,
  completion_nonce text not null
);

create function private.task4_test_create_download(
  p_label text,
  p_resource_id uuid,
  p_correlation_id uuid,
  p_age_minutes double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_completion_nonce text;
begin
  select audit_attempt.attempt_id, audit_attempt.completion_nonce
  into strict v_attempt_id, v_completion_nonce
  from private.begin_download_audit_core(
    null,
    null,
    '36000000-0000-4000-8000-000000000001',
    'file',
    p_resource_id,
    p_correlation_id
  ) audit_attempt;

  update private.download_attempts attempt
  set started_at = pg_catalog.clock_timestamp()
    - pg_catalog.make_interval(secs => p_age_minutes * 60.0)
  where attempt.id = v_attempt_id;

  insert into private.task4_test_download_tokens(
    label,
    attempt_id,
    completion_nonce
  ) values (
    p_label,
    v_attempt_id,
    v_completion_nonce
  );

  return p_resource_id::text;
end;
$$;

create function private.task4_test_complete_download(
  p_label text,
  p_outcome text,
  p_byte_class text,
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_token private.task4_test_download_tokens%rowtype;
begin
  select token.*
  into strict v_token
  from private.task4_test_download_tokens token
  where token.label = p_label;

  perform private.complete_download_audit(
    v_token.attempt_id,
    v_token.completion_nonce,
    p_outcome,
    p_byte_class
  );
  perform pg_catalog.pg_sleep(p_hold_seconds);
  return p_outcome;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

create function private.task4_test_finalize_downloads(
  p_hold_seconds double precision
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_finalized integer;
begin
  v_finalized := private.finalize_stale_download_attempts();
  perform pg_catalog.pg_sleep(p_hold_seconds);
  return v_finalized::text;
end;
$$;

revoke execute on function private.task4_test_create_download(
  text,uuid,uuid,double precision
), private.task4_test_complete_download(
  text,text,text,double precision
), private.task4_test_finalize_downloads(double precision),
  private.task4_test_pause_download_begin()
from public, anon, authenticated, service_role, axsys_bff;

select private.task4_test_create_download(
  'completion-wins',
  '66000000-0000-4000-8000-000000000101',
  '86000000-0000-4000-8000-000000000101',
  16.0
);
commit;

begin;
select no_plan();

select is(
  extensions.dblink_connect(
    'task4_download_worker_a',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'download worker A establishes an independent session'
);
select is(
  extensions.dblink_connect(
    'task4_download_worker_b',
    'host=host.docker.internal port=54322 dbname=' || current_database()
      || ' user=postgres password=postgres connect_timeout=5'
  ),
  'OK',
  'download worker B establishes an independent session'
);
select is(
  extensions.dblink_exec(
    'task4_download_worker_a',
    'set statement_timeout = ''5s'''
  ),
  'SET',
  'download worker A has a bounded statement timeout'
);
select is(
  extensions.dblink_exec(
    'task4_download_worker_b',
    'set statement_timeout = ''5s'''
  ),
  'SET',
  'download worker B has a bounded statement timeout'
);

select is(
  extensions.dblink_send_query(
    'task4_download_worker_a',
    $$select private.task4_test_complete_download(
        'completion-wins',
        'completed',
        'under_1_mib',
        1.0
      ) as result$$
  ),
  1,
  'completion worker starts and holds the terminal attempt row lock'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_a'),
  1,
  'completion remains active while its transaction owns the row lock'
);

select is(
  extensions.dblink_send_query(
    'task4_download_worker_b',
    $$select private.task4_test_finalize_downloads(0.0) as result$$
  ),
  1,
  'the stale sweeper races the locked completion attempt'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_b'),
  0,
  'the stale sweeper skips the locked completion without waiting'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  $$values ('0'::text)$$,
  'the stale sweeper cannot abandon an in-flight completion'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  'the stale worker drains its asynchronous command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  $$values ('completed'::text)$$,
  'the completion winner commits its nonce CAS'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  'the completion worker drains its asynchronous command'
);

select results_eq(
  $$select attempt.outcome, attempt.byte_class, attempt.nonce_hash,
           attempt.completed_at is not null
    from private.download_attempts attempt
    where attempt.correlation_id =
      '86000000-0000-4000-8000-000000000101'$$,
  $$values ('completed','under_1_mib',null::text,true)$$,
  'completion wins with exactly one terminal private outcome'
);
select results_eq(
  $$select event.outcome::text, event.reason_code, event.metadata
    from public.audit_events event
    where event.action = 'file.download'
      and event.correlation_id =
        '86000000-0000-4000-8000-000000000101'$$,
  $$values ('success',null::text,
    '{"accessKind":"public","byteClass":"under_1_mib","downloadOutcome":"completed"}'::jsonb)$$,
  'completion wins with exactly one matching public audit row'
);

select is(
  extensions.dblink_send_query(
    'task4_download_worker_b',
    $$select private.task4_test_create_download(
        'stale-wins',
        '66000000-0000-4000-8000-000000000102',
        '86000000-0000-4000-8000-000000000102',
        16.0
      ) as result$$
  ),
  1,
  'a second committed stale attempt is created for the inverse race'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  $$values ('66000000-0000-4000-8000-000000000102'::text)$$,
  'the inverse-race attempt receives its fixed resource identifier'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  'the setup worker drains its asynchronous command'
);

select is(
  extensions.dblink_send_query(
    'task4_download_worker_a',
    $$select private.task4_test_finalize_downloads(1.0) as result$$
  ),
  1,
  'the stale worker claims and holds the second terminal attempt row lock'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_a'),
  1,
  'the stale winner remains active while its transaction owns the row lock'
);
select is(
  extensions.dblink_send_query(
    'task4_download_worker_b',
    $$select private.task4_test_complete_download(
        'stale-wins',
        'completed',
        'under_1_mib',
        0.0
      ) as result$$
  ),
  1,
  'completion races the stale claim with the original nonce'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_b'),
  1,
  'completion waits on the same row until the stale winner commits'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  $$values ('1'::text)$$,
  'the stale worker commits exactly one abandoned attempt'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  'the stale worker drains its asynchronous command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  $$values ('23514:download_audit_completion_invalid'::text)$$,
  'the losing completion cannot replay a nonce consumed by abandonment'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  'the losing completion worker drains its asynchronous command'
);

select results_eq(
  $$select attempt.outcome, attempt.byte_class, attempt.nonce_hash,
           attempt.completed_at is not null
    from private.download_attempts attempt
    where attempt.correlation_id =
      '86000000-0000-4000-8000-000000000102'$$,
  $$values ('abandoned','unknown',null::text,true)$$,
  'stale wins with exactly one terminal private outcome'
);
select results_eq(
  $$select event.outcome::text, event.reason_code, event.metadata
    from public.audit_events event
    where event.action = 'file.download'
      and event.correlation_id =
        '86000000-0000-4000-8000-000000000102'$$,
  $$values ('failure','DOWNLOAD_ABANDONED',
    '{"accessKind":"public","byteClass":"unknown","downloadOutcome":"abandoned"}'::jsonb)$$,
  'stale wins with exactly one matching public audit row'
);
select is(
  (select count(*) from public.audit_events
    where action = 'file.download'
      and correlation_id in (
        '86000000-0000-4000-8000-000000000101',
        '86000000-0000-4000-8000-000000000102'
      )),
  2::bigint,
  'both lock orderings produce one audit row per attempt and no duplicate'
);
select is(
  (select count(*) from private.download_execution_context),
  0::bigint,
  'both concurrent outcomes leave no execution context residue'
);

select is(
  extensions.dblink_send_query(
    'task4_download_worker_a',
    $$select count(*)::text as result
      from private.authorize_image_file_download(
        '26000000-0000-4000-8000-000000000103',
        '96000000-0000-4000-8000-000000000103',
        '66000000-0000-4000-8000-000000000103',
        '86000000-0000-4000-8000-000000000103'
      ) authorized_file$$
  ),
  1,
  'authenticated authorizer revalidates before its paused audit begin'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_a'),
  1,
  'the deterministic audit-begin gate pauses the authorizer transaction'
);
select is(
  extensions.dblink_send_query(
    'task4_download_worker_b',
    $$update public.company_memberships
      set status = 'suspended',
          suspended_at = pg_catalog.clock_timestamp(),
          suspended_by = '26000000-0000-4000-8000-000000000103',
          suspension_reason = 'Concurrent download authorization revocation'
      where id = '46000000-0000-4000-8000-000000000103'
      returning status::text as result$$
  ),
  1,
  'membership suspension races the paused authorization'
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('task4_download_worker_b'),
  1,
  'identity suspension waits for the authorizer global lock instead of revoking mid-snapshot'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  $$values ('1'::text)$$,
  'authorization commits its capability from one serialized identity state'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_a')
      as result(result text)$$,
  'the serialized authorizer drains its asynchronous command'
);
select results_eq(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  $$values ('suspended'::text)$$,
  'membership suspension commits only after authorization releases identity locks'
);
select is_empty(
  $$select result
    from extensions.dblink_get_result('task4_download_worker_b')
      as result(result text)$$,
  'the serialized suspension drains its asynchronous command'
);
select results_eq(
  $$select membership.status::text, count(attempt.id)::bigint
    from public.company_memberships membership
    left join private.download_attempts attempt
      on attempt.actor_user_id = membership.user_id
     and attempt.correlation_id =
       '86000000-0000-4000-8000-000000000103'
    where membership.id = '46000000-0000-4000-8000-000000000103'
    group by membership.status$$,
  $$values ('suspended',1::bigint)$$,
  'the race leaves one pre-revocation capability and the later suspended identity'
);

select is(
  extensions.dblink_disconnect('task4_download_worker_a'),
  'OK',
  'download worker A disconnects cleanly'
);
select is(
  extensions.dblink_disconnect('task4_download_worker_b'),
  'OK',
  'download worker B disconnects cleanly'
);

select * from finish();
commit;

-- Restore a pristine database after the independently committed workers.
begin;
delete from private.download_attempts
where correlation_id in (
  '86000000-0000-4000-8000-000000000101',
  '86000000-0000-4000-8000-000000000102',
  '86000000-0000-4000-8000-000000000103'
);
delete from public.file_objects
where id = '66000000-0000-4000-8000-000000000103';
delete from auth.sessions
where id = '96000000-0000-4000-8000-000000000103';
alter table public.audit_events disable trigger user;
delete from public.audit_events
where correlation_id in (
    '86000000-0000-4000-8000-000000000101',
    '86000000-0000-4000-8000-000000000102',
    '86000000-0000-4000-8000-000000000103',
    '85000000-0000-4000-8000-000000000103'
  );
alter table public.audit_events enable trigger user;
drop trigger task4_test_pause_download_begin
on private.download_attempts;
drop function private.task4_test_pause_download_begin();
drop function private.task4_test_create_download(
  text,uuid,uuid,double precision
);
drop function private.task4_test_complete_download(
  text,text,text,double precision
);
drop function private.task4_test_finalize_downloads(double precision);
drop table private.task4_test_download_tokens;
alter table public.company_memberships disable trigger user;
delete from public.member_modules
where membership_id = '46000000-0000-4000-8000-000000000103';
delete from public.company_memberships
where id = '46000000-0000-4000-8000-000000000103';
alter table public.company_memberships enable trigger user;
delete from private.company_storage_usage
where company_id in (
  '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000002'
);
delete from public.companies
where id in (
  '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000002'
);
delete from public.profiles
where user_id = '26000000-0000-4000-8000-000000000103';
delete from auth.users
where id = '26000000-0000-4000-8000-000000000103';
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
drop table private.task4_test_download_run_marker;
commit;

do $$
begin
  if not (select was_present from task4_download_dblink_extension_state) then
    execute 'drop extension dblink';
  end if;
end
$$;
