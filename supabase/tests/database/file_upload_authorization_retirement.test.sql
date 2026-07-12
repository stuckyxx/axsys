begin;
\ir helpers/fixtures.inc

select no_plan();

select has_function(
  'private'::name,
  'claim_upload_authorizations_for_retirement'::name,
  array['integer','uuid']
);
select has_function(
  'private'::name,
  'complete_upload_authorization_retirement'::name,
  array['uuid','uuid','bigint']
);
select has_function(
  'private'::name,
  'release_upload_authorization_retirement_claim'::name,
  array['uuid','uuid','bigint','text']
);
select has_function(
  'private'::name,
  'cancel_stale_reserved_upload_intents'::name,
  array['integer']
);

select results_eq(
  $$select function.proname::text collate "default",
           pg_get_function_identity_arguments(function.oid)::text collate "default",
           pg_get_function_result(function.oid)::text collate "default",
           owner.rolname::text collate "default",
           function.prosecdef,
           ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_roles owner on owner.oid = function.proowner
    where namespace.nspname = 'private'
      and function.proname in (
        'claim_upload_authorizations_for_retirement',
        'complete_upload_authorization_retirement',
        'release_upload_authorization_retirement_claim',
        'cancel_stale_reserved_upload_intents'
      )
    order by function.proname$$,
  $$values
    ('cancel_stale_reserved_upload_intents', 'p_limit integer',
      'TABLE(intent_id uuid, released_bytes bigint, version bigint)',
      'postgres', true, true),
    ('claim_upload_authorizations_for_retirement',
      'p_limit integer, p_worker_id uuid',
      'TABLE(intent_id uuid, quarantine_object_path text, retirement_status upload_intent_status, claim_id uuid, expected_version bigint)',
      'postgres', true, true),
    ('complete_upload_authorization_retirement',
      'p_intent_id uuid, p_claim_id uuid, p_expected_version bigint',
      'TABLE(intent_id uuid, status upload_intent_status, released_bytes bigint, version bigint, authorization_retired_at timestamp with time zone)',
      'postgres', true, true),
    ('release_upload_authorization_retirement_claim',
      'p_intent_id uuid, p_claim_id uuid, p_expected_version bigint, p_error_code text',
      'bigint', 'postgres', true, true)$$,
  'retirement routines freeze signatures, results, owner, definer and search_path'
);

select results_eq(
  $$select function.proname::text collate "default",
           position('FOR UPDATE SKIP LOCKED' in upper(pg_get_functiondef(function.oid))) > 0
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'claim_upload_authorizations_for_retirement',
        'cancel_stale_reserved_upload_intents'
      )
    order by function.proname$$,
  $$values
    ('cancel_stale_reserved_upload_intents', true),
    ('claim_upload_authorizations_for_retirement', true)$$,
  'both queue consumers use non-blocking row claims'
);

select results_eq(
  $$select class.relname::text collate "default",
           pg_get_indexdef(index.indexrelid)::text collate "default",
           pg_get_expr(index.indpred, index.indrelid)::text collate "default"
    from pg_index index
    join pg_class class on class.oid = index.indexrelid
    where index.indrelid = 'public.file_upload_intents'::regclass
      and class.relname = 'file_upload_intents_stale_reserved_idx'$$,
  $$values (
    'file_upload_intents_stale_reserved_idx',
    'CREATE INDEX file_upload_intents_stale_reserved_idx ON public.file_upload_intents USING btree (company_id, created_at, id) WHERE ((status = ''reserved''::upload_intent_status) AND (authorization_retired_at IS NULL))',
    '((status = ''reserved''::upload_intent_status) AND (authorization_retired_at IS NULL))'
  )$$,
  'stale reserved cleanup has a matching partial index'
);

select test_helpers.create_company_user(
  '23000000-0000-4000-8000-000000000001',
  'retirement-admin@example.test',
  '33000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'::public.module_key[]
);

insert into public.file_upload_intents (
  id,
  company_id,
  actor_user_id,
  purpose,
  target_resource_id,
  quarantine_object_path,
  declared_name,
  declared_mime,
  declared_size,
  status,
  quota_hold_bytes,
  authorization_issued_at,
  upload_authorization_expires_at,
  cleanup_not_before,
  authorization_cleanup_claim_id,
  authorization_cleanup_claimed_at,
  cleanup_error_code,
  version,
  created_at,
  updated_at
) values
  (
    '61000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/issued-due', 'issued.png', 'image/png', 100,
    'issued', 200,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, null, 10,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000002',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/ready-due', 'ready.png', 'image/png', 110,
    'ready', 110,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, null, 20,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000003',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/rejected-due', 'rejected.png', 'image/png', 120,
    'rejected', 120,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, 'MALWARE_DETECTED', 30,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000004',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/cleanup-due', 'cleanup.png', 'image/png', 130,
    'cleanup_required', 260,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, 'FILE_PRIVATE_UPLOAD_AMBIGUOUS', 40,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000005',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/issued-early', 'early.png', 'image/png', 140,
    'issued', 280,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '25 hours 15 minutes',
    null, null, null, 50,
    statement_timestamp() - interval '2 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000006',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/active-lease', 'active-lease.png', 'image/png', 150,
    'issued', 300,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    '73000000-0000-4000-8000-000000000001', statement_timestamp(), null, 60,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000007',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/stale-lease', 'stale-lease.png', 'image/png', 160,
    'issued', 320,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    '73000000-0000-4000-8000-000000000002',
    statement_timestamp() - interval '16 minutes', null, 70,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000008',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/reserved-stale', 'reserved-stale.png', 'image/png', 170,
    'reserved', 340,
    null, null, null, null, null, null, 80,
    statement_timestamp() - interval '31 minutes', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000009',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/reserved-fresh', 'reserved-fresh.png', 'image/png', 180,
    'reserved', 360,
    null, null, null, null, null, null, 90,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000010',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/finalizing-due', 'finalizing.png', 'image/png', 190,
    'finalizing', 380,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, null, 100,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000011',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/expired-due', 'expired.png', 'image/png', 200,
    'expired', 400,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    null, null, null, 110,
    statement_timestamp() - interval '31 hours', statement_timestamp()
  );

update private.company_storage_usage usage
set reserved_bytes = (
      select sum(intent.quota_hold_bytes)
      from public.file_upload_intents intent
      where intent.company_id = usage.company_id
    ),
    version = usage.version + 1,
    updated_at = statement_timestamp()
where usage.company_id = '33000000-0000-4000-8000-000000000001';

create temporary table retirement_claims (
  batch text not null,
  intent_id uuid not null,
  quarantine_object_path text not null,
  retirement_status public.upload_intent_status not null,
  claim_id uuid not null,
  expected_version bigint not null
);
create temporary table retirement_completions (
  batch text not null,
  intent_id uuid not null,
  status public.upload_intent_status not null,
  released_bytes bigint not null,
  version bigint not null,
  authorization_retired_at timestamptz not null
);
create temporary table reserved_cancellations (
  batch text not null,
  intent_id uuid not null,
  released_bytes bigint not null,
  version bigint not null
);
grant select, insert on retirement_claims,
  retirement_completions,
  reserved_cancellations to axsys_bff;
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
    execute format(
      'grant execute on function %s to axsys_bff',
      pgtap_function.signature
    );
  end loop;
end
$$;

set local role axsys_bff;
insert into retirement_claims
select 'initial', claim.*
from private.claim_upload_authorizations_for_retirement(
  10,
  '74000000-0000-4000-8000-000000000001'
) claim;
reset role;

select is(
  (select count(*) from retirement_claims where batch = 'initial'),
  7::bigint,
  'claim takes every due activated intent except an unexpired lease'
);
select results_eq(
  $$select intent_id, quarantine_object_path, retirement_status::text,
           claim_id, expected_version
    from retirement_claims where batch = 'initial' order by intent_id$$,
  $$values
    ('61000000-0000-4000-8000-000000000001'::uuid,
      'retirement/issued-due', 'expired',
      '74000000-0000-4000-8000-000000000001'::uuid, 11::bigint),
    ('61000000-0000-4000-8000-000000000002'::uuid,
      'retirement/ready-due', 'ready',
      '74000000-0000-4000-8000-000000000001'::uuid, 21::bigint),
    ('61000000-0000-4000-8000-000000000003'::uuid,
      'retirement/rejected-due', 'rejected',
      '74000000-0000-4000-8000-000000000001'::uuid, 31::bigint),
    ('61000000-0000-4000-8000-000000000004'::uuid,
      'retirement/cleanup-due', 'expired',
      '74000000-0000-4000-8000-000000000001'::uuid, 41::bigint),
    ('61000000-0000-4000-8000-000000000007'::uuid,
      'retirement/stale-lease', 'expired',
      '74000000-0000-4000-8000-000000000001'::uuid, 71::bigint),
    ('61000000-0000-4000-8000-000000000010'::uuid,
      'retirement/finalizing-due', 'expired',
      '74000000-0000-4000-8000-000000000001'::uuid, 101::bigint),
    ('61000000-0000-4000-8000-000000000011'::uuid,
      'retirement/expired-due', 'expired',
      '74000000-0000-4000-8000-000000000001'::uuid, 111::bigint)$$,
  'claim returns only delete-first fields and the exact terminal transition'
);
select results_eq(
  $$select id, status::text, quota_hold_bytes, authorization_retired_at
    from public.file_upload_intents
    where id in (
      '61000000-0000-4000-8000-000000000005',
      '61000000-0000-4000-8000-000000000006',
      '61000000-0000-4000-8000-000000000008',
      '61000000-0000-4000-8000-000000000009'
    ) order by id$$,
  $$values
    ('61000000-0000-4000-8000-000000000005'::uuid, 'issued', 280::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000006'::uuid, 'issued', 300::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000008'::uuid, 'reserved', 340::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000009'::uuid, 'reserved', 360::bigint, null::timestamptz)$$,
  'too-early, active-lease and reserved intents are not claimed'
);
select results_eq(
  $$select reserved_bytes, version from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'$$,
  $$values (3070::bigint, 2::bigint)$$,
  'claim changes no quota before Storage deletion'
);
select results_eq(
  $$select id, status::text, quota_hold_bytes, authorization_retired_at
    from public.file_upload_intents
    where id in (select intent_id from retirement_claims where batch = 'initial')
    order by id$$,
  $$values
    ('61000000-0000-4000-8000-000000000001'::uuid, 'issued', 200::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000002'::uuid, 'ready', 110::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000003'::uuid, 'rejected', 120::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000004'::uuid, 'cleanup_required', 260::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000007'::uuid, 'issued', 320::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000010'::uuid, 'finalizing', 380::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000011'::uuid, 'expired', 400::bigint, null::timestamptz)$$,
  'claim preserves every business state until delete-first completion'
);

set local role axsys_bff;
select throws_ok(
  $$select * from private.complete_upload_authorization_retirement(
      '61000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000099',
      11
    )$$,
  '23514',
  'upload_retirement_claim_invalid',
  'wrong claim cannot forgive quota'
);
select throws_ok(
  $$select private.release_upload_authorization_retirement_claim(
      '61000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000001',
      11,
      'UNBOUNDED_FAILURE'
    )$$,
  '22023',
  'upload_retirement_reason_invalid',
  'retry failure codes use a closed allowlist'
);
select is(
  private.release_upload_authorization_retirement_claim(
    '61000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000001',
    11,
    'FILE_QUARANTINE_DELETE_UNAVAILABLE'
  ),
  12::bigint,
  'delete failure releases only the lease for retry'
);
reset role;

select results_eq(
  $$select status::text, quota_hold_bytes, authorization_retired_at,
           authorization_cleanup_claim_id, authorization_cleanup_claimed_at,
           cleanup_error_code, version
    from public.file_upload_intents
    where id = '61000000-0000-4000-8000-000000000001'$$,
  $$values ('issued', 200::bigint, null::timestamptz, null::uuid,
    null::timestamptz, 'FILE_QUARANTINE_DELETE_UNAVAILABLE', 12::bigint)$$,
  'failed Storage deletion preserves status and quota while making lease retryable'
);
select is(
  (select reserved_bytes from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'),
  3070::bigint,
  'wrong claim and retry release forgive no quota'
);

set local role axsys_bff;
insert into retirement_claims
select 'retry', claim.*
from private.claim_upload_authorizations_for_retirement(
  10,
  '74000000-0000-4000-8000-000000000002'
) claim;
reset role;

select results_eq(
  $$select intent_id, claim_id, expected_version
    from retirement_claims where batch = 'retry'$$,
  $$values (
    '61000000-0000-4000-8000-000000000001'::uuid,
    '74000000-0000-4000-8000-000000000002'::uuid,
    13::bigint
  )$$,
  'released lease is immediately claimable by a retry worker'
);

set local role axsys_bff;
select throws_ok(
  $$select * from private.complete_upload_authorization_retirement(
      '61000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000002',
      12
    )$$,
  '23514',
  'upload_retirement_claim_invalid',
  'wrong expected version cannot forgive quota'
);
insert into retirement_completions
select 'issued', completion.*
from private.complete_upload_authorization_retirement(
  '61000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  13
) completion;
insert into retirement_completions
select 'issued-replay', completion.*
from private.complete_upload_authorization_retirement(
  '61000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  13
) completion;
insert into retirement_completions
select 'remaining', completion.*
from retirement_claims claim
cross join lateral private.complete_upload_authorization_retirement(
  claim.intent_id,
  claim.claim_id,
  claim.expected_version
) completion
where claim.batch = 'initial'
  and claim.intent_id <> '61000000-0000-4000-8000-000000000001';
reset role;

select results_eq(
  $$select batch, status::text, released_bytes, version
    from retirement_completions
    where intent_id = '61000000-0000-4000-8000-000000000001'
    order by batch$$,
  $$values
    ('issued', 'expired', 200::bigint, 14::bigint),
    ('issued-replay', 'expired', 0::bigint, 14::bigint)$$,
  'complete is idempotent and releases the issued hold exactly once'
);
select results_eq(
  $$select id, status::text, quota_hold_bytes,
           authorization_retired_at is not null,
           authorization_cleanup_claim_id,
           version
    from public.file_upload_intents
    where id in (
      '61000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000002',
      '61000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000004',
      '61000000-0000-4000-8000-000000000007',
      '61000000-0000-4000-8000-000000000010',
      '61000000-0000-4000-8000-000000000011'
    ) order by id$$,
  $$values
    ('61000000-0000-4000-8000-000000000001'::uuid, 'expired', 0::bigint, true,
      '74000000-0000-4000-8000-000000000002'::uuid, 14::bigint),
    ('61000000-0000-4000-8000-000000000002'::uuid, 'ready', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 22::bigint),
    ('61000000-0000-4000-8000-000000000003'::uuid, 'rejected', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 32::bigint),
    ('61000000-0000-4000-8000-000000000004'::uuid, 'expired', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 42::bigint),
    ('61000000-0000-4000-8000-000000000007'::uuid, 'expired', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 72::bigint),
    ('61000000-0000-4000-8000-000000000010'::uuid, 'expired', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 102::bigint),
    ('61000000-0000-4000-8000-000000000011'::uuid, 'expired', 0::bigint, true,
      '74000000-0000-4000-8000-000000000001'::uuid, 112::bigint)$$,
  'complete preserves ready/rejected and safely expires nonterminal activated states'
);
select results_eq(
  $$select reserved_bytes, version from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'$$,
  $$values (1280::bigint, 9::bigint)$$,
  'seven completions subtract every remaining capability hold exactly once'
);

update public.file_upload_intents
set authorization_cleanup_claimed_at = statement_timestamp() - interval '16 minutes'
where id = '61000000-0000-4000-8000-000000000006';

set local role axsys_bff;
insert into retirement_claims
select 'recovered', claim.*
from private.claim_upload_authorizations_for_retirement(
  1,
  '74000000-0000-4000-8000-000000000003'
) claim;
insert into retirement_completions
select 'recovered', completion.*
from retirement_claims claim
cross join lateral private.complete_upload_authorization_retirement(
  claim.intent_id,
  claim.claim_id,
  claim.expected_version
) completion
where claim.batch = 'recovered';
reset role;

select results_eq(
  $$select intent_id, claim_id, expected_version
    from retirement_claims where batch = 'recovered'$$,
  $$values (
    '61000000-0000-4000-8000-000000000006'::uuid,
    '74000000-0000-4000-8000-000000000003'::uuid,
    61::bigint
  )$$,
  'expired lease is recoverable by another worker'
);
select results_eq(
  $$select status::text, quota_hold_bytes, authorization_retired_at is not null
    from public.file_upload_intents
    where id = '61000000-0000-4000-8000-000000000006'$$,
  $$values ('expired', 0::bigint, true)$$,
  'recovered lease completes the same safe retirement path'
);

set local role axsys_bff;
insert into reserved_cancellations
select 'stale', cancellation.*
from private.cancel_stale_reserved_upload_intents(10) cancellation;
insert into reserved_cancellations
select 'replay', cancellation.*
from private.cancel_stale_reserved_upload_intents(10) cancellation;
reset role;

select results_eq(
  $$select intent_id, released_bytes, version
    from reserved_cancellations where batch = 'stale'$$,
  $$values (
    '61000000-0000-4000-8000-000000000008'::uuid,
    340::bigint,
    81::bigint
  )$$,
  'reserved-stale cleanup cancels only a never-issued old reservation'
);
select is_empty(
  $$select intent_id from reserved_cancellations where batch = 'replay'$$,
  'reserved-stale cleanup is idempotent'
);
select results_eq(
  $$select id, status::text, quota_hold_bytes,
           authorization_issued_at is not null,
           authorization_retired_at is not null
    from public.file_upload_intents
    where id in (
      '61000000-0000-4000-8000-000000000005',
      '61000000-0000-4000-8000-000000000008',
      '61000000-0000-4000-8000-000000000009'
    ) order by id$$,
  $$values
    ('61000000-0000-4000-8000-000000000005'::uuid, 'issued', 280::bigint,
      true, false),
    ('61000000-0000-4000-8000-000000000008'::uuid, 'cancelled', 0::bigint,
      false, true),
    ('61000000-0000-4000-8000-000000000009'::uuid, 'reserved', 360::bigint,
      false, false)$$,
  'reserved cleanup cannot touch activated or fresh reservations'
);
select results_eq(
  $$select reserved_bytes,
           (select sum(quota_hold_bytes)::bigint
              from public.file_upload_intents
              where company_id = usage.company_id) as live_holds
    from private.company_storage_usage usage
    where company_id = '33000000-0000-4000-8000-000000000001'$$,
  $$values (640::bigint, 640::bigint)$$,
  'final reserved quota equals the exact sum of all live holds'
);

insert into public.file_upload_intents (
  id, company_id, actor_user_id, purpose, target_resource_id,
  quarantine_object_path, declared_name, declared_mime, declared_size,
  status, quota_hold_bytes, authorization_issued_at,
  upload_authorization_expires_at, cleanup_not_before, version,
  created_at, updated_at
) values (
  '61000000-0000-4000-8000-000000000012',
  '33000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'profile_avatar',
  '23000000-0000-4000-8000-000000000001',
  'retirement/quota-drift', 'quota-drift.png', 'image/png', 400,
  'issued', 800,
  statement_timestamp() - interval '30 hours',
  statement_timestamp() - interval '28 hours',
  statement_timestamp() - interval '3 hours 45 minutes',
  120, statement_timestamp() - interval '31 hours', statement_timestamp()
);

set local role axsys_bff;
insert into retirement_claims
select 'quota-drift', claim.*
from private.claim_upload_authorizations_for_retirement(
  1,
  '74000000-0000-4000-8000-000000000004'
) claim;
select throws_ok(
  $$select * from private.complete_upload_authorization_retirement(
      '61000000-0000-4000-8000-000000000012',
      '74000000-0000-4000-8000-000000000004',
      121
    )$$,
  '23514',
  'upload_retirement_quota_invalid',
  'counter drift fails closed instead of forgiving a hold'
);
reset role;

select results_eq(
  $$select status::text, quota_hold_bytes, authorization_retired_at,
           authorization_cleanup_claim_id, version
    from public.file_upload_intents
    where id = '61000000-0000-4000-8000-000000000012'$$,
  $$values ('issued', 800::bigint, null::timestamptz,
    '74000000-0000-4000-8000-000000000004'::uuid, 121::bigint)$$,
  'failed quota completion preserves the claim and full hold for repair'
);
select is(
  (select reserved_bytes from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'),
  640::bigint,
  'failed quota completion changes no counter bytes'
);

insert into public.file_upload_intents (
  id, company_id, actor_user_id, purpose, target_resource_id,
  quarantine_object_path, declared_name, declared_mime, declared_size,
  status, quota_hold_bytes, authorization_issued_at,
  upload_authorization_expires_at, cleanup_not_before, version,
  created_at, updated_at
) values
  (
    '61000000-0000-4000-8000-000000000013',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/issued-state-drift', 'issued-state-drift.png', 'image/png', 210,
    'issued', 210,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    130, statement_timestamp() - interval '31 hours', statement_timestamp()
  ),
  (
    '61000000-0000-4000-8000-000000000014',
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '23000000-0000-4000-8000-000000000001',
    'retirement/ready-state-drift', 'ready-state-drift.png', 'image/png', 220,
    'ready', 440,
    statement_timestamp() - interval '30 hours',
    statement_timestamp() - interval '28 hours',
    statement_timestamp() - interval '3 hours 45 minutes',
    140, statement_timestamp() - interval '31 hours', statement_timestamp()
  );
update private.company_storage_usage
set reserved_bytes = 1000,
    version = version + 1,
    updated_at = statement_timestamp()
where company_id = '33000000-0000-4000-8000-000000000001';

set local role axsys_bff;
insert into retirement_claims
select 'state-drift', claim.*
from private.claim_upload_authorizations_for_retirement(
  2,
  '74000000-0000-4000-8000-000000000005'
) claim;
select throws_ok(
  $$select * from private.complete_upload_authorization_retirement(
      '61000000-0000-4000-8000-000000000013',
      '74000000-0000-4000-8000-000000000005',
      131
    )$$,
  '23514',
  'upload_retirement_state_invalid',
  'issued intent with only one hold slot fails closed'
);
select throws_ok(
  $$select * from private.complete_upload_authorization_retirement(
      '61000000-0000-4000-8000-000000000014',
      '74000000-0000-4000-8000-000000000005',
      141
    )$$,
  '23514',
  'upload_retirement_state_invalid',
  'ready intent with two hold slots fails closed'
);
reset role;

select results_eq(
  $$select id, status::text, quota_hold_bytes, authorization_retired_at
    from public.file_upload_intents
    where id in (
      '61000000-0000-4000-8000-000000000013',
      '61000000-0000-4000-8000-000000000014'
    ) order by id$$,
  $$values
    ('61000000-0000-4000-8000-000000000013'::uuid,
      'issued', 210::bigint, null::timestamptz),
    ('61000000-0000-4000-8000-000000000014'::uuid,
      'ready', 440::bigint, null::timestamptz)$$,
  'status/hold drift remains claimed and unreleased for reconciliation'
);
select is(
  (select reserved_bytes from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'),
  1000::bigint,
  'status/hold drift changes no quota counter'
);

update private.company_storage_usage
set reserved_bytes = 640,
    version = version + 1,
    updated_at = statement_timestamp()
where company_id = '33000000-0000-4000-8000-000000000001';
insert into public.file_upload_intents (
  id, company_id, actor_user_id, purpose, target_resource_id,
  quarantine_object_path, declared_name, declared_mime, declared_size,
  status, quota_hold_bytes, version, created_at, updated_at
) values (
  '61000000-0000-4000-8000-000000000015',
  '33000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'profile_avatar',
  '23000000-0000-4000-8000-000000000001',
  'retirement/reserved-state-drift', 'reserved-state-drift.png', 'image/png', 230,
  'reserved', 230, 150,
  statement_timestamp() - interval '31 minutes', statement_timestamp()
);

set local role axsys_bff;
select throws_ok(
  $$select * from private.cancel_stale_reserved_upload_intents(10)$$,
  '23514',
  'stale_reservation_state_invalid',
  'stale reserved intent missing its second hold slot fails closed'
);
reset role;

select results_eq(
  $$select status::text, quota_hold_bytes, authorization_retired_at
    from public.file_upload_intents
    where id = '61000000-0000-4000-8000-000000000015'$$,
  $$values ('reserved', 230::bigint, null::timestamptz)$$,
  'stale reserved drift remains fully held for reconciliation'
);
select is(
  (select reserved_bytes from private.company_storage_usage
    where company_id = '33000000-0000-4000-8000-000000000001'),
  640::bigint,
  'stale reserved drift changes no quota counter'
);

select ok(
  (
    select bool_and(
      has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
      and not has_function_privilege('anon', function.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', function.oid, 'EXECUTE')
      and not has_function_privilege('service_role', function.oid, 'EXECUTE')
    )
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'claim_upload_authorizations_for_retirement',
        'complete_upload_authorization_retirement',
        'release_upload_authorization_retirement_claim',
        'cancel_stale_reserved_upload_intents'
      )
  ),
  'only axsys_bff can execute authorization retirement routines'
);

select * from finish();
rollback;
