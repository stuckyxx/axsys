begin;
\ir helpers/fixtures.inc

select no_plan();

create function test_helpers.activate_bank_platform_session(
  p_user_id uuid,
  p_session_id uuid,
  p_correlation_id uuid,
  p_created_at timestamptz default statement_timestamp() - interval '1 minute'
) returns void
language plpgsql
as $$
begin
  perform test_helpers.create_auth_session(p_session_id, p_user_id, p_created_at);
  perform private.register_auth_session(p_session_id, p_user_id, false);
  perform private.write_authenticated_audit_event(
    p_user_id,p_session_id,'auth.login','session',null,'success',null,
    p_correlation_id,null,null,'{"rememberMe":false}'::jsonb
  );
end;
$$;

select test_helpers.create_auth_user(
  '28000000-0000-4000-8000-000000000001',
  'bank-platform@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '28000000-0000-4000-8000-000000000001',
  'bank-platform@example.test',
  'Bank Platform'
);
insert into public.platform_roles(user_id,role,is_active)
values ('28000000-0000-4000-8000-000000000001','super_admin',true);
select test_helpers.activate_bank_platform_session(
  '28000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000001'
);
select test_helpers.activate_bank_platform_session(
  '28000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000002',
  '88000000-0000-4000-8000-000000000002',
  statement_timestamp() - interval '11 minutes'
);

select test_helpers.create_company(
  '38000000-0000-4000-8000-000000000001',
  'Empresa Bancaria A',
  '80123456000101'
);
select test_helpers.create_company(
  '38000000-0000-4000-8000-000000000002',
  'Empresa Bancaria B',
  '80123456000102'
);

create function test_helpers.capture_invalid_bank_payload_error()
returns jsonb language plpgsql as $$
declare v_state text; v_message text; v_detail text;
begin
  perform private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000009',
    '001','Banco Invalid','PLAINTEXT-BRANCH-123','AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','INVALID-ACCOUNT',
    'AQEBAQEBAQEBAQEB','AQEBAQEBAQEBAQEBAQEBAQ==',1,'5678',
    'checking','Sensitive Holder',null,null,null,null,null,false,null,
    '88000000-0000-4000-8000-000000000009'
  );
  return '{"unexpected":"success"}'::jsonb;
exception when others then
  get stacked diagnostics v_state=returned_sqlstate,v_message=message_text,
    v_detail=pg_exception_detail;
  return pg_catalog.jsonb_build_object(
    'state',v_state,'message',v_message,'detail',coalesce(v_detail,'')
  );
end $$;

select results_eq(
  $$select error->>'state',error->>'message',error->>'detail'
    from (select test_helpers.capture_invalid_bank_payload_error() error) captured$$,
  $$values ('22023','AXSYS_BANK_ACCOUNT_INPUT_INVALID','')$$,
  'invalid encrypted payload returns a stable error with no failing-row DETAIL'
);
select is_empty(
  $$select id from public.audit_events
    where correlation_id='88000000-0000-4000-8000-000000000009'$$,
  'invalid encrypted payload is atomic and unaudited'
);

create temporary table bank_results(label text primary key, payload jsonb);

insert into bank_results values (
  'first',
  private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000001',
    '001','Banco A','YnJhbmNoLWVuY3J5cHRlZA==','AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',1,'2345',
    'YWNjb3VudC1lbmNyeXB0ZWQ=','AQEBAQEBAQEBAQEB',
    'AQEBAQEBAQEBAQEBAQEBAQ==',1,'6543','checking','Titular A',
    'ZG9jdW1lbnQtZW5jcnlwdGVk','AgICAgICAgICAgIC',
    'AgICAgICAgICAgICAgICAg==',1,'8901',false,null,
    '88000000-0000-4000-8000-000000000011'
  )
);

select is((select payload->>'isDefault' from bank_results where label='first'),'true',
  'the first active account becomes default even when makeDefault is false');
select is((select payload->>'version' from bank_results where label='first'),'1',
  'create starts the CAS version at one');
select ok(
  not ((select payload from bank_results where label='first') ?| array[
    'branchCiphertext','branchIv','branchTag','accountCiphertext','accountIv',
    'accountTag','holderDocumentCiphertext','holderDocumentIv','holderDocumentTag'
  ]),
  'mutation result is masked-only'
);
select is((select payload->>'maskedBranch' from bank_results where label='first'),'2345',
  'branch read exposes only its last four digits');
select is((select payload->>'maskedAccount' from bank_results where label='first'),'6543',
  'account read exposes only its last four digits');
select is((select payload->>'maskedHolderDocument' from bank_results where label='first'),'••••8901',
  'holder document read is masked');

insert into bank_results values (
  'second',
  private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000002',
    '237','Banco B','YnJhbmNoLTI=','AwMDAwMDAwMDAwMD',
    'AwMDAwMDAwMDAwMDAwMDAw==',1,'0001',
    'YWNjb3VudC0y','BAQEBAQEBAQEBAQE',
    'BAQEBAQEBAQEBAQEBAQEBA==',1,'0002','payment','Titular B',
    null,null,null,null,null,false,null,
    '88000000-0000-4000-8000-000000000012'
  )
);

select is((select payload->>'isDefault' from bank_results where label='second'),'false',
  'a later account stays non-default when makeDefault is false');
select is((select count(*) from public.company_bank_accounts
  where company_id='38000000-0000-4000-8000-000000000001'
    and status='active' and is_default),1::bigint,
  'only one active default exists');

select lives_ok($$
  select private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000001',
    '001','Banco A Atualizado','YnJhbmNoLW5ldw==','BQUFBQUFBQUFBQUF',
    'BQUFBQUFBQUFBQUFBQUFBQ==',2,'1111',
    'YWNjb3VudC1uZXc=','BgYGBgYGBgYGBgYG',
    'BgYGBgYGBgYGBgYGBgYGBg==',2,'2222','savings','Titular A',
    null,null,null,null,null,false,1,
    '88000000-0000-4000-8000-000000000013'
  )
$$,'an update accepts the expected version and replaces encrypted fields atomically');

select throws_ok($$
  select private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000001',
    '001','Banco stale','YnJhbmNo','BwcHBwcHBwcHBwcH',
    'BwcHBwcHBwcHBwcHBwcHBw==',2,'1111','YWNjb3VudA==',
    'CAgICAgICAgICAgI','CAgICAgICAgICAgICAgICAg==',2,'2222',
    'checking','Titular A',null,null,null,null,null,false,1,
    '88000000-0000-4000-8000-000000000014'
  )
$$,'40001','AXSYS_BANK_ACCOUNT_VERSION_CONFLICT',
  'a stale update receives a stable CAS conflict');

select throws_ok($$
  select private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000002',
    '58000000-0000-4000-8000-000000000001',
    '001','Banco foreign','YnJhbmNo','BwcHBwcHBwcHBwcH',
    'BwcHBwcHBwcHBwcHBwcHBw==',2,'1111','YWNjb3VudA==',
    'CAgICAgICAgICAgI','CAgICAgICAgICAgICAgICAg==',2,'2222',
    'checking','Titular A',null,null,null,null,null,false,2,
    '88000000-0000-4000-8000-000000000015'
  )
$$,'P0001','AXSYS_BANK_ACCOUNT_NOT_FOUND',
  'wrong-company update is indistinguishable from a missing account');

insert into bank_results values (
  'default-second',
  private.internal_set_default_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000002',1,
    '88000000-0000-4000-8000-000000000016'
  )
);
select is((select payload->>'isDefault' from bank_results where label='default-second'),'true',
  'setting a default returns the promoted masked summary');
select is((select count(*) from public.company_bank_accounts
  where company_id='38000000-0000-4000-8000-000000000001'
    and status='active' and is_default),1::bigint,
  'default switch clears the old default in the same transaction');

select throws_ok($$
  select private.internal_archive_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000002',
    '58000000-0000-4000-8000-000000000001','raw free text',2,
    '88000000-0000-4000-8000-000000000017'
  )
$$,'22023','AXSYS_BANK_ARCHIVE_REASON_INVALID',
  'archive rejects free-text reasons before mutating the default');
select results_eq(
  $$select status::text,is_default,version from public.company_bank_accounts
    where id='58000000-0000-4000-8000-000000000002'$$,
  $$values ('active',true,2::bigint)$$,
  'invalid archive category is atomic');

select throws_ok($$
  select private.internal_archive_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000002',null,'BANK_ARCHIVE_ACCOUNT_CLOSED',2,
    '88000000-0000-4000-8000-000000000017'
  )
$$,'22023','AXSYS_REPLACEMENT_DEFAULT_REQUIRED',
  'archiving a default requires an active same-company replacement');

select lives_ok($$
  select private.internal_archive_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000002',
    '58000000-0000-4000-8000-000000000001','BANK_ARCHIVE_BANK_CHANGED',2,
    '88000000-0000-4000-8000-000000000018'
  )
$$,'archiving a default atomically promotes the requested active replacement');
select is((select is_default from public.company_bank_accounts
  where id='58000000-0000-4000-8000-000000000001'),true,
  'replacement is the sole default');
select is((select status::text from public.company_bank_accounts
  where id='58000000-0000-4000-8000-000000000002'),'archived',
  'archived target is no longer active');

select lives_ok($$
  select private.internal_archive_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000001',null,'BANK_ARCHIVE_ACCOUNT_CLOSED',4,
    '88000000-0000-4000-8000-000000000019'
  )
$$,'the last active default may be archived without a replacement');
select is((select count(*) from public.company_bank_accounts
  where company_id='38000000-0000-4000-8000-000000000001'
    and status='active' and is_default),0::bigint,
  'a company with no active accounts has no default');

select throws_ok($$
  select private.internal_upsert_bank_account(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    '38000000-0000-4000-8000-000000000001',
    '58000000-0000-4000-8000-000000000003',
    '341','Banco C','YnJhbmNo','CQkJCQkJCQkJCQkJ',
    'CQkJCQkJCQkJCQkJCQkJCQ==',1,'1234','YWNjb3VudA==',
    'CgoKCgoKCgoKCgoK','CgoKCgoKCgoKCgoKCgoKCg==',1,'5678',
    'checking','Titular C',null,null,null,null,null,false,null,
    '88000000-0000-4000-8000-000000000020'
  )
$$,'42501','AXSYS_RECENT_AUTH_REQUIRED',
  'mutations require a platform session authenticated in the last ten minutes');

select is(
  jsonb_array_length(private.internal_list_company_bank_accounts(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001'
  )),
  2,
  'platform masked list includes active and archived summaries'
);
select ok(
  private.internal_list_company_bank_accounts(
    '28000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001'
  )::text !~ '(branchCiphertext|accountCiphertext|holderDocumentCiphertext|YnJhbmNo|YWNjb3VudC1uZXc)',
  'platform list never serializes ciphertext or known encrypted values'
);

select is_empty($$
  select event.id
  from public.audit_events event
  where event.resource_type='bank_account'
    and (
      event.metadata::text ~ '(YnJhbmNo|YWNjb3Vud|ZG9jdW1lbnQ)'
      or event.metadata ?| array[
        'branch','account','holderDocument','branchCiphertext','accountCiphertext',
        'holderDocumentCiphertext','iv','tag'
      ]
    )
$$,'audit metadata contains no plaintext, ciphertext, IV, tag or full document');
select results_eq($$
  select distinct event.action::text collate "default" as action
  from public.audit_events event
  where event.resource_type='bank_account'
  order by action
$$,$$values ('bank_account.archived'),('bank_account.created'),
  ('bank_account.default_changed'),('bank_account.updated')$$,
  'all committed bank lifecycle mutations are audited');
select results_eq(
  $$select correlation_id,reason_code
    from public.audit_events
    where correlation_id in (
      '88000000-0000-4000-8000-000000000018',
      '88000000-0000-4000-8000-000000000019'
    ) order by correlation_id$$,
  $$values
    ('88000000-0000-4000-8000-000000000018'::uuid,'BANK_ARCHIVE_BANK_CHANGED'),
    ('88000000-0000-4000-8000-000000000019'::uuid,'BANK_ARCHIVE_ACCOUNT_CLOSED')$$,
  'archive audit persists only the closed request category'
);

select * from finish();
rollback;
