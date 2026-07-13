begin;
\ir helpers/fixtures.inc
select no_plan();

create function test_helpers.activate_task11_session(
  p_user_id uuid,p_session_id uuid,p_correlation_id uuid
) returns void language plpgsql as $$
begin
  perform test_helpers.create_auth_session(
    p_session_id,p_user_id,pg_catalog.statement_timestamp()-interval '1 minute'
  );
  perform private.register_auth_session(p_session_id,p_user_id,false);
  perform private.write_authenticated_audit_event(
    p_user_id,p_session_id,'auth.login','session',null,'success',null,
    p_correlation_id,null,null,'{"rememberMe":false}'::jsonb
  );
end;
$$;

select test_helpers.create_company_user(
  '2a000000-0000-4000-8000-000000000001','settings-admin@example.test',
  '3a000000-0000-4000-8000-000000000001',
  '4a000000-0000-4000-8000-000000000001','company_admin','{}'
);
select test_helpers.create_company_user(
  '2a000000-0000-4000-8000-000000000002','settings-editor@example.test',
  '3a000000-0000-4000-8000-000000000001',
  '4a000000-0000-4000-8000-000000000002','member',
  array['administrative']::public.module_key[]
);
select test_helpers.create_company_user(
  '2a000000-0000-4000-8000-000000000003','settings-finance@example.test',
  '3a000000-0000-4000-8000-000000000001',
  '4a000000-0000-4000-8000-000000000003','member',
  array['financial']::public.module_key[]
);
select test_helpers.create_company_user(
  '2a000000-0000-4000-8000-000000000004','settings-foreign@example.test',
  '3a000000-0000-4000-8000-000000000004',
  '4a000000-0000-4000-8000-000000000004','company_admin','{}'
);

select test_helpers.activate_task11_session(
  '2a000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001'
);
select test_helpers.activate_task11_session(
  '2a000000-0000-4000-8000-000000000002',
  '9a000000-0000-4000-8000-000000000002',
  '8a000000-0000-4000-8000-000000000002'
);
select test_helpers.activate_task11_session(
  '2a000000-0000-4000-8000-000000000003',
  '9a000000-0000-4000-8000-000000000003',
  '8a000000-0000-4000-8000-000000000003'
);
select test_helpers.activate_task11_session(
  '2a000000-0000-4000-8000-000000000004',
  '9a000000-0000-4000-8000-000000000004',
  '8a000000-0000-4000-8000-000000000004'
);

insert into public.company_settings(company_id,updated_by) values
  ('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001'),
  ('3a000000-0000-4000-8000-000000000004','2a000000-0000-4000-8000-000000000004');

insert into public.file_objects(
  id,company_id,owner_user_id,purpose,bucket,object_path,original_name,
  detected_mime,byte_size,sha256,scan_status,status,created_by,promoted_at
) values
  ('7a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',
   '2a000000-0000-4000-8000-000000000001','profile_avatar','axsys-private',
   '3a/avatars/old.webp','old.webp','image/webp',10,repeat('1',64),'clean','ready',
   '2a000000-0000-4000-8000-000000000001',clock_timestamp()),
  ('7a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000001',
   '2a000000-0000-4000-8000-000000000001','profile_avatar','axsys-private',
   '3a/avatars/new.webp','new.webp','image/webp',10,repeat('2',64),'clean','ready',
   '2a000000-0000-4000-8000-000000000001',clock_timestamp()),
  ('7a000000-0000-4000-8000-000000000003','3a000000-0000-4000-8000-000000000001',
   null,'company_letterhead','axsys-private','3a/branding/letter.webp','letter.webp',
   'image/webp',10,repeat('3',64),'clean','ready',
   '2a000000-0000-4000-8000-000000000001',clock_timestamp()),
  ('7a000000-0000-4000-8000-000000000004','3a000000-0000-4000-8000-000000000001',
   null,'company_signature','axsys-private','3a/branding/sign.webp','sign.webp',
   'image/webp',10,repeat('4',64),'clean','ready',
   '2a000000-0000-4000-8000-000000000001',clock_timestamp()),
  ('7a000000-0000-4000-8000-000000000005','3a000000-0000-4000-8000-000000000004',
   null,'company_letterhead','axsys-private','foreign/letter.webp','foreign.webp',
   'image/webp',10,repeat('5',64),'clean','ready',
   '2a000000-0000-4000-8000-000000000004',clock_timestamp());
update public.profiles set avatar_file_id='7a000000-0000-4000-8000-000000000001'
where user_id='2a000000-0000-4000-8000-000000000001';

insert into public.company_bank_accounts(
  id,company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
  branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
  account_key_version,account_last4,account_type,holder_name,status,is_default,
  created_by,updated_by
) values (
  '5a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',
  '001','Banco Seguro','YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'0001',
  'YQ==','MTIzNDU2Nzg5MDEy','MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'1234','checking',
  'Empresa Segura','active',true,'2a000000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001'
);

create temporary table task11_results(label text primary key,result jsonb);
grant select,insert on task11_results to axsys_bff;
grant axsys_bff to postgres;

set local role axsys_bff;
insert into task11_results values
  ('profile-get',private.internal_get_own_profile(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001')),
  ('profile-update',private.internal_update_own_profile(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    'Nome Seguro Atualizado',2,'8a000000-0000-4000-8000-000000000011')),
  ('profile-avatar',private.internal_attach_own_avatar(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000002',3,'8a000000-0000-4000-8000-000000000012'));
reset role;

select results_eq(
  $$select label,result->>'email',result->>'displayName',result->>'avatarFileId',
           (result->>'version')::bigint,
           (select jsonb_agg(key order by key) from jsonb_object_keys(result) key)
      from task11_results where label like 'profile-%' order by label$$,
  $$values
    ('profile-avatar','settings-admin@example.test','Nome Seguro Atualizado',
      '7a000000-0000-4000-8000-000000000002',4::bigint,
      '["avatarFileId","displayName","email","preferredTheme","userId","version"]'::jsonb),
    ('profile-get','settings-admin@example.test','settings-admin',
      '7a000000-0000-4000-8000-000000000001',2::bigint,
      '["avatarFileId","displayName","email","preferredTheme","userId","version"]'::jsonb),
    ('profile-update','settings-admin@example.test','Nome Seguro Atualizado',
      '7a000000-0000-4000-8000-000000000001',3::bigint,
      '["avatarFileId","displayName","email","preferredTheme","userId","version"]'::jsonb)$$,
  'own profile reads and CAS writes return the exact safe DTO'
);
select results_eq(
  $$select status::text,retirement_not_before is not null from public.file_objects
    where id='7a000000-0000-4000-8000-000000000001'$$,
  $$values ('archived',true)$$,
  'avatar replacement retires the previous ready object after thirty days'
);
select throws_ok(
  $$select private.internal_update_own_profile(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    'Stale',2,'8a000000-0000-4000-8000-000000000013')$$,
  '40001','AXSYS_PROFILE_VERSION_CONFLICT','profile update enforces CAS'
);
select throws_ok(
  $$select private.internal_get_own_profile(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000004')$$,
  '23514','AXSYS_PROFILE_SESSION_INVALID','actor/session crossing is denied'
);

update auth.users set email='settings-admin-confirmed@example.test',
  email_confirmed_at=clock_timestamp(),updated_at=clock_timestamp()
where id='2a000000-0000-4000-8000-000000000001';
set local role axsys_bff;
insert into task11_results values ('profile-email',private.internal_sync_confirmed_profile_email(
  '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000014'));
reset role;
select results_eq(
  $$select result->>'email',(result->>'version')::bigint from task11_results
    where label='profile-email'$$,
  $$values ('settings-admin-confirmed@example.test',5::bigint)$$,
  'confirmed email sync derives current Auth email without accepting email input'
);

set local role axsys_bff;
insert into task11_results values
  ('settings-admin',private.internal_get_own_company_settings(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001')),
  ('settings-finance',private.internal_get_own_company_settings(
    '2a000000-0000-4000-8000-000000000003','9a000000-0000-4000-8000-000000000003')),
  ('settings-update',private.internal_update_own_company_settings(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    'Representante Seguro','Diretor','replace','YQ==','MTIzNDU2Nzg5MDEy',
    'MTIzNDU2Nzg5MDEyMzQ1Ng==',1,'4321',5.25,'Rua Um','10',null,'Centro',
    'Fortaleza','CE','60000000','7a000000-0000-4000-8000-000000000003',
    '7a000000-0000-4000-8000-000000000004',1,
    '8a000000-0000-4000-8000-000000000021'));
reset role;

select results_eq(
  $$select label,(result->>'canEdit')::boolean,(result->>'version')::bigint,
           jsonb_array_length(result->'banks'),result->>'maskedRepresentativeDocument'
      from task11_results where label like 'settings-%' order by label$$,
  $$values
    ('settings-admin',true,1::bigint,1,null::text),
    ('settings-finance',false,1::bigint,1,null::text),
    ('settings-update',true,2::bigint,1,'••••4321')$$,
  'settings read rules, masked banks and encrypted-document mask are authoritative'
);
select ok(
  (select result::text !~ '(YQ==|MTIzNDU2|ciphertext|documentIv)'
     from task11_results where label='settings-update'),
  'settings DTO never returns ciphertext, IV or tag'
);
select throws_ok(
  $$select private.internal_update_own_company_settings(
    '2a000000-0000-4000-8000-000000000003','9a000000-0000-4000-8000-000000000003',
    null,null,'preserve',null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,1,
    '8a000000-0000-4000-8000-000000000022')$$,
  '42501','AXSYS_COMPANY_SETTINGS_WRITE_REQUIRED','financial membership is read-only'
);
select throws_ok(
  $$select private.internal_update_own_company_settings(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    repeat('X',500),null,'preserve',null,null,null,null,null,0,null,null,null,null,
    null,null,null,null,null,2,'8a000000-0000-4000-8000-000000000024')$$,
  '22023','AXSYS_COMPANY_SETTINGS_INPUT_INVALID',
  'settings rejects oversized institutional text before persistence'
);
select throws_ok(
  $$select private.internal_update_own_company_settings(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    null,null,'preserve',null,null,null,null,null,0,null,null,null,null,null,null,null,
    '7a000000-0000-4000-8000-000000000005',null,2,
    '8a000000-0000-4000-8000-000000000023')$$,
  'P0001','AXSYS_INVALID_LETTERHEAD_FILE','foreign branding file is denied'
);

set local role axsys_bff;
insert into task11_results values
  ('draft-admin',private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    '{"representativeName":"Rascunho","taxRate":7.5}'::jsonb,2,null,
    '8a000000-0000-4000-8000-000000000031')),
  ('draft-editor',private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002',
    '{"addressCity":"Fortaleza"}'::jsonb,2,null,
    '8a000000-0000-4000-8000-000000000032')),
  ('draft-get-admin',private.internal_get_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001'));
reset role;
select results_eq(
  $$select label,result->'payload',(result->>'version')::bigint
      from task11_results where label in ('draft-admin','draft-editor','draft-get-admin')
      order by label$$,
  $$values
    ('draft-admin','{"representativeName":"Rascunho","taxRate":7.5}'::jsonb,1::bigint),
    ('draft-editor','{"addressCity":"Fortaleza"}'::jsonb,1::bigint),
    ('draft-get-admin','{"representativeName":"Rascunho","taxRate":7.5}'::jsonb,1::bigint)$$,
  'drafts are isolated by company and actor with exact payload/version'
);
select throws_ok(
  $$select private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    '{"cpf":"12345678901"}'::jsonb,2,1,'8a000000-0000-4000-8000-000000000033')$$,
  '22023','AXSYS_COMPANY_SETTINGS_DRAFT_INVALID','draft rejects plaintext CPF/unknown keys'
);
select throws_ok(
  $$select private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    '{"representativeName":{"nested":"invalid"}}'::jsonb,2,1,
    '8a000000-0000-4000-8000-000000000036')$$,
  '22023','AXSYS_COMPANY_SETTINGS_DRAFT_INVALID',
  'draft rejects nested values in scalar fields'
);
select throws_ok(
  $$select private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000003','9a000000-0000-4000-8000-000000000003',
    '{}'::jsonb,2,null,'8a000000-0000-4000-8000-000000000034')$$,
  '42501','AXSYS_COMPANY_SETTINGS_WRITE_REQUIRED','financial member cannot persist drafts'
);
select throws_ok(
  $$select private.internal_upsert_own_company_settings_draft(
    '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',
    '{}'::jsonb,2,9,'8a000000-0000-4000-8000-000000000035')$$,
  '40001','AXSYS_DRAFT_VERSION_CONFLICT','draft update requires exact version'
);
set local role axsys_bff;
select private.internal_delete_own_company_settings_draft(
  '2a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001');
reset role;
select results_eq(
  $$select user_id from public.company_settings_drafts order by user_id$$,
  $$values ('2a000000-0000-4000-8000-000000000002'::uuid)$$,
  'delete removes only the current actor draft'
);

select is_empty(
  $$select metadata::text from public.audit_events
    where correlation_id in (
      '8a000000-0000-4000-8000-000000000011',
      '8a000000-0000-4000-8000-000000000012',
      '8a000000-0000-4000-8000-000000000014',
      '8a000000-0000-4000-8000-000000000021'
    ) and metadata::text ~ '(settings-admin|Representante|YQ==|4321|7a000000)'$$,
  'Task11 audit metadata contains no names, email, document or file IDs'
);

select * from finish();
rollback;
