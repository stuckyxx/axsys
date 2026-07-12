begin;
\ir helpers/fixtures.inc

select no_plan();

grant usage on schema extensions to axsys_bff;
grant axsys_bff to postgres;
do $$
declare
  pgtap_function record;
begin
  for pgtap_function in
    select function.oid::regprocedure::text as signature
    from pg_proc function
    join pg_depend dependency
      on dependency.classid = 'pg_proc'::regclass
     and dependency.objid = function.oid
     and dependency.deptype = 'e'
    join pg_extension extension
      on extension.oid = dependency.refobjid
     and extension.extname = 'pgtap'
  loop
    execute format('grant execute on function %s to axsys_bff', pgtap_function.signature);
  end loop;
end
$$;

create function test_helpers.activate_file_session(
  p_user_id uuid,
  p_session_id uuid,
  p_correlation_id uuid
) returns void
language plpgsql
as $$
begin
  perform test_helpers.create_auth_session(
    p_session_id,
    p_user_id,
    statement_timestamp() - interval '1 minute'
  );
  perform private.register_auth_session(p_session_id, p_user_id, false);
  perform private.write_authenticated_audit_event(
    p_user_id,
    p_session_id,
    'auth.login',
    'session',
    null,
    'success',
    null,
    p_correlation_id,
    null,
    null,
    '{"rememberMe":false}'::jsonb
  );
end;
$$;

select test_helpers.create_company_user(
  '21000000-0000-4000-8000-000000000001',
  'files-admin-a@example.test',
  '31000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '21000000-0000-4000-8000-000000000002',
  'files-admin-b@example.test',
  '31000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000002',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.activate_file_session(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001'
);
select test_helpers.activate_file_session(
  '21000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002'
);

create temporary table task4_results (
  label text primary key,
  payload jsonb not null
);
grant select, insert, update on task4_results to axsys_bff;

set local role axsys_bff;

insert into task4_results(label, payload)
select 'reservation', private.reserve_image_upload_intent(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'company_letterhead',
  'brand.png',
  'image/png',
  1024
);

insert into task4_results(label, payload)
select 'authorization', private.activate_file_upload_authorization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reservation')
);

insert into task4_results(label, payload)
select 'begin', private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reservation')
);

select is(
  (select payload ->> 'kind' from task4_results where label = 'begin'),
  'finalizing',
  'begin performs the issued to finalizing CAS'
);
select results_eq(
  $$select key from task4_results, lateral jsonb_object_keys(payload) key
    where label = 'begin' order by key$$,
  $$values ('intent'), ('kind')$$,
  'begin returns only the state discriminator and server-only intent'
);
select results_eq(
  $$select key
    from task4_results,
      lateral jsonb_object_keys(payload -> 'intent') key
    where label = 'begin'
    order by key$$,
  $$values
    ('actorUserId'), ('cleanupNotBefore'), ('companyId'), ('declaredMime'),
    ('declaredName'), ('declaredSize'), ('id'), ('purpose'), ('quarantinePath')$$,
  'finalizable intent contract has exact keys'
);

insert into task4_results(label, payload)
select 'ready', to_jsonb(private.internal_finalize_file_upload(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reservation'),
  '51000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001/company_letterhead/51000000-0000-4000-8000-000000000001.webp',
  'image/webp',
  'webp',
  700,
  repeat('a', 64),
  '82000000-0000-4000-8000-000000000001'
));

select is(
  (select payload ->> 'status' from task4_results where label = 'ready'),
  'ready',
  'finalize creates a ready file object'
);
select is(
  (select payload ->> 'scan_status' from task4_results where label = 'ready'),
  'clean',
  'finalize persists the clean scanner state'
);

reset role;

select results_eq(
  $$select used_bytes, reserved_bytes
    from private.company_storage_usage
    where company_id = '31000000-0000-4000-8000-000000000001'$$,
  $$values (700::bigint, 1024::bigint)$$,
  'finalize converts only the promotion slot and retains the capability hold'
);
select results_eq(
  $$select status::text, quota_hold_bytes, file_object_id
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task4_results where label = 'reservation'
    )$$,
  $$values ('ready', 1024::bigint, '51000000-0000-4000-8000-000000000001'::uuid)$$,
  'finalize links the intent without retiring its authorization'
);

set local role axsys_bff;

insert into task4_results(label, payload)
select 'ready-replay', private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reservation')
);
select is(
  (select payload ->> 'kind' from task4_results where label = 'ready-replay'),
  'ready',
  'begin returns the same committed file on replay'
);

select throws_ok(
  $$select private.internal_begin_file_finalization(
      '21000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000002',
      (select (payload ->> 'intentId')::uuid from task4_results where label = 'reservation')
    )$$,
  '42501',
  'file_upload_not_found',
  'another tenant receives the same not-found boundary'
);

insert into task4_results(label, payload)
select 'reject-reservation', private.reserve_image_upload_intent(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'profile_avatar',
  'avatar.png',
  'image/png',
  2048
);
select private.activate_file_upload_authorization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reject-reservation')
);
select private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reject-reservation')
);
select private.internal_reject_file_upload(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'reject-reservation'),
  'MALWARE_DETECTED'
);

reset role;

select results_eq(
  $$select status::text, quota_hold_bytes
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task4_results where label = 'reject-reservation'
    )$$,
  $$values ('rejected', 2048::bigint)$$,
  'reject releases only promotion quota and keeps capability quota'
);
select results_eq(
  $$select used_bytes, reserved_bytes
    from private.company_storage_usage
    where company_id = '31000000-0000-4000-8000-000000000001'$$,
  $$values (700::bigint, 3072::bigint)$$,
  'ready and rejected intents remain fully accounted'
);
select is(
  (
    select count(*)::bigint
    from public.audit_events event
    where event.action in ('file.upload_finalized', 'file.upload_rejected')
      and event.company_id = '31000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'terminal upload transitions emit one audit row each'
);

set local role axsys_bff;

insert into task4_results(label, payload)
select 'retry-reservation', private.reserve_image_upload_intent(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'profile_avatar',
  'retry.png',
  'image/png',
  512
);
select private.activate_file_upload_authorization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'retry-reservation')
);
select private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'retry-reservation')
);
select private.internal_release_file_finalization_for_retry(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'retry-reservation'),
  'FILE_SCANNER_UNAVAILABLE'
);

reset role;

select results_eq(
  $$select status::text, quota_hold_bytes, cleanup_error_code
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task4_results where label = 'retry-reservation'
    )$$,
  $$values ('issued', 1024::bigint, 'FILE_SCANNER_UNAVAILABLE')$$,
  'retry restores issued state without releasing either quota slot'
);

set local role axsys_bff;

select private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'retry-reservation')
);
select private.internal_mark_file_cleanup_required(
  '21000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'retry-reservation'),
  'FILE_PRIVATE_UPLOAD_AMBIGUOUS'
);

reset role;

select results_eq(
  $$select status::text, quota_hold_bytes, cleanup_error_code
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task4_results where label = 'retry-reservation'
    )$$,
  $$values ('cleanup_required', 1024::bigint, 'FILE_PRIVATE_UPLOAD_AMBIGUOUS')$$,
  'ambiguous private upload keeps both quota slots for reconciliation'
);

set local role axsys_bff;

insert into task4_results(label, payload)
select 'path-reservation', private.reserve_image_upload_intent(
  '21000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  'profile_avatar',
  'path.png',
  'image/png',
  256
);
select private.activate_file_upload_authorization(
  '21000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'path-reservation')
);
select private.internal_begin_file_finalization(
  '21000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'path-reservation')
);
select throws_ok(
  $$select private.internal_finalize_file_upload(
      '21000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000002',
      (select (payload ->> 'intentId')::uuid from task4_results where label = 'path-reservation'),
      '51000000-0000-4000-8000-000000000002',
      '31000000-0000-4000-8000-000000000001/profile_avatar/51000000-0000-4000-8000-000000000002.webp',
      'image/webp',
      'webp',
      200,
      repeat('b', 64),
      '82000000-0000-4000-8000-000000000002'
    )$$,
  '23514',
  'file_finalize_state_invalid',
  'a caller cannot redirect promotion into another tenant path'
);
select private.internal_release_file_finalization_for_retry(
  '21000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  (select (payload ->> 'intentId')::uuid from task4_results where label = 'path-reservation'),
  'FILE_FINALIZATION_UNAVAILABLE'
);
select throws_ok(
  $$select private.internal_mark_file_cleanup_required(
      '21000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000002',
      (select (payload ->> 'intentId')::uuid from task4_results where label = 'path-reservation'),
      'UNBOUNDED_REASON'
    )$$,
  '22023',
  'file_cleanup_reason_invalid',
  'cleanup reasons use a closed allowlist'
);

reset role;

select results_eq(
  $$select company_id, used_bytes, reserved_bytes
    from private.company_storage_usage
    where company_id in (
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002'
    )
    order by company_id$$,
  $$values
    ('31000000-0000-4000-8000-000000000001'::uuid, 700::bigint, 4096::bigint),
    ('31000000-0000-4000-8000-000000000002'::uuid, 0::bigint, 512::bigint)$$,
  'failed path, retry and cleanup states forgive no quota'
);

select ok(
  has_function_privilege(
    'axsys_bff',
    'private.internal_finalize_file_upload(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.internal_finalize_file_upload(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.internal_finalize_file_upload(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid)',
    'EXECUTE'
  ),
  'only the BFF role may execute finalize'
);
select ok(
  has_function_privilege(
    'axsys_bff',
    'private.internal_begin_file_finalization(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.internal_begin_file_finalization(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.internal_begin_file_finalization(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'only the BFF role may begin finalization'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.internal_reject_file_upload(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role cannot mutate upload state'
);

select * from finish();
rollback;
