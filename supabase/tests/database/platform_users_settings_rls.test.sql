begin;
\ir helpers/fixtures.inc

select no_plan();

-- pgTAP remains a test-only harness while the assertions execute under each
-- application role. Every grant below disappears with this transaction.
grant usage on schema extensions to anon, authenticated, axsys_bff;
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
      'grant execute on function %s to anon, authenticated, axsys_bff',
      pgtap_function.signature
    );
  end loop;
end
$$;

create function test_helpers.activate_platform_users_settings_session(
  p_user_id uuid,
  p_session_id uuid,
  p_correlation_id uuid,
  p_created_at timestamptz default statement_timestamp() - interval '1 minute'
) returns void
language plpgsql
as $$
begin
  perform test_helpers.create_auth_session(
    p_session_id,
    p_user_id,
    p_created_at
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

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000001',
  'platform@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '10000000-0000-4000-8000-000000000001',
  'platform@example.test',
  'Platform Admin'
);
insert into public.platform_roles (user_id)
values ('10000000-0000-4000-8000-000000000001');

select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000001',
  'admin-a@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'company_admin',
  array['administrative','financial']::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000002',
  'admin-a2@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000011',
  'member-a@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000011',
  'member',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000012',
  'finance-a@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000012',
  'member',
  array['financial']::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000101',
  'admin-b@example.test',
  '30000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000101',
  'company_admin',
  '{}'::public.module_key[]
);

select test_helpers.activate_platform_users_settings_session(
  '10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000100',
  '81000000-0000-4000-8000-000000000100'
);
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000101',
  '81000000-0000-4000-8000-000000000101'
);
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000102',
  '81000000-0000-4000-8000-000000000102'
);
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111',
  '81000000-0000-4000-8000-000000000111'
);
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000012',
  '90000000-0000-4000-8000-000000000112',
  '81000000-0000-4000-8000-000000000112'
);
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000101',
  '90000000-0000-4000-8000-000000000201',
  '81000000-0000-4000-8000-000000000201'
);

insert into public.company_settings (
  company_id,
  representative_name,
  representative_role,
  representative_document_ciphertext,
  representative_document_iv,
  representative_document_tag,
  representative_document_key_version,
  representative_document_last4,
  tax_rate,
  address_city,
  address_state,
  address_postal_code,
  updated_by
) values
  (
    '30000000-0000-4000-8000-000000000001',
    'Representante A',
    'Diretora',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '1234',
    4.50,
    'Fortaleza',
    'CE',
    '60000000',
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'Representante B',
    'Diretor',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '9876',
    2.00,
    'Recife',
    'PE',
    '50000000',
    '20000000-0000-4000-8000-000000000101'
  );

insert into public.company_settings_drafts (
  company_id,
  user_id,
  payload,
  base_version
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '{"addressCity":"Fortaleza"}',
    1
  ),
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '{"addressCity":"Sobral"}',
    1
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000101',
    '{"addressCity":"Recife"}',
    1
  );

insert into public.company_bank_accounts (
  id,
  company_id,
  bank_code,
  bank_name,
  branch_ciphertext,
  branch_iv,
  branch_tag,
  branch_key_version,
  branch_last4,
  account_ciphertext,
  account_iv,
  account_tag,
  account_key_version,
  account_last4,
  account_type,
  holder_name,
  holder_document_ciphertext,
  holder_document_iv,
  holder_document_tag,
  holder_document_key_version,
  holder_document_last4,
  status,
  is_default,
  created_by,
  updated_by,
  archived_at
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '001',
    'Banco A',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '0001',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '1234',
    'checking',
    'Titular A',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '4321',
    'active',
    true,
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '50000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000001',
    '104',
    'Banco Arquivado',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '0011',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '5678',
    'savings',
    'Titular Arquivado',
    null,
    null,
    null,
    null,
    null,
    'archived',
    false,
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    statement_timestamp()
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '237',
    'Banco B',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '0002',
    'c2VjcmV0',
    'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAA==',
    1,
    '9999',
    'payment',
    'Titular B',
    null,
    null,
    null,
    null,
    null,
    'active',
    true,
    '20000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000101',
    null
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
  promoted_at
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'profile_avatar',
    'axsys-private',
    'company-a/profile/avatar.webp',
    'avatar.webp',
    'image/webp',
    1000,
    repeat('a', 64),
    'clean',
    'ready',
    '20000000-0000-4000-8000-000000000001',
    statement_timestamp()
  ),
  (
    '60000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000001',
    null,
    'company_letterhead',
    'axsys-private',
    'company-a/letterhead/ready.webp',
    'letterhead.webp',
    'image/webp',
    1200,
    repeat('b', 64),
    'clean',
    'ready',
    '20000000-0000-4000-8000-000000000001',
    statement_timestamp()
  ),
  (
    '60000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000001',
    null,
    'company_signature',
    'axsys-private',
    'company-a/signature/infected.webp',
    'signature.webp',
    'image/webp',
    800,
    repeat('c', 64),
    'infected',
    'rejected',
    '20000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    null,
    'company_letterhead',
    'axsys-private',
    'company-b/letterhead/ready.webp',
    'letterhead-b.webp',
    'image/webp',
    1100,
    repeat('d', 64),
    'clean',
    'ready',
    '20000000-0000-4000-8000-000000000101',
    statement_timestamp()
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
  quota_hold_bytes
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'profile_avatar',
    '20000000-0000-4000-8000-000000000001',
    'company-a/admin-a/manual-intent/random',
    'avatar.png',
    'image/png',
    1000,
    'reserved',
    2000
  ),
  (
    '70000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000012',
    'profile_avatar',
    '20000000-0000-4000-8000-000000000012',
    'company-a/finance-a/manual-intent/random',
    'avatar.png',
    'image/png',
    1000,
    'reserved',
    2000
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000101',
    'profile_avatar',
    '20000000-0000-4000-8000-000000000101',
    'company-b/admin-b/manual-intent/random',
    'avatar.png',
    'image/png',
    1000,
    'reserved',
    2000
  );

update private.company_storage_usage usage
set reserved_bytes = case usage.company_id
  when '30000000-0000-4000-8000-000000000001'::uuid then 4000
  when '30000000-0000-4000-8000-000000000002'::uuid then 2000
  else usage.reserved_bytes
end,
updated_at = statement_timestamp()
where usage.company_id in (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002'
);

-- Catalog contract: exposed relations are RLS-forced and policies are an
-- exact SELECT-only allowlist. Audit remains stronger than a zero-row policy:
-- authenticated has no raw table grant at all.
select results_eq(
  $$select table_name::text collate "default"
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'company_bank_account_summaries',
        'company_settings_safe'
      )
    order by table_name$$,
  $$values
    ('company_bank_account_summaries'),
    ('company_settings_safe')$$,
  'safe views exist in the exposed schema'
);

select results_eq(
  $$select tablename::text collate "default",
           policyname::text collate "default",
           cmd::text collate "default",
           array_to_string(roles, ',')::text collate "default"
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'file_objects',
        'file_upload_intents',
        'company_bank_accounts',
        'company_settings',
        'company_settings_drafts',
        'provisioning_operations'
      )
    order by tablename, policyname$$,
  $$values
    ('company_bank_accounts','company_bank_accounts_tenant_select','SELECT','authenticated'),
    ('company_settings','company_settings_tenant_select','SELECT','authenticated'),
    ('company_settings_drafts','company_settings_drafts_own_select','SELECT','authenticated'),
    ('file_objects','file_objects_tenant_select','SELECT','authenticated'),
    ('file_upload_intents','upload_intents_own_select','SELECT','authenticated')$$,
  'Task 3 creates exactly five SELECT policies and leaves provisioning default-deny'
);

select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'file_objects',
        'file_upload_intents',
        'company_bank_accounts',
        'company_settings',
        'company_settings_drafts',
        'provisioning_operations'
      )
      and (
        cmd <> 'SELECT'
        or coalesce(qual, '') ~* '^\(?\s*true\s*\)?$'
        or coalesce(with_check, '') ~* '^\(?\s*true\s*\)?$'
      )$$,
  'no Task 3 policy grants DML or an unconditional predicate'
);

select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_events'$$,
  'platform and tenant audit remain without a user Data API policy'
);

select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['anon','authenticated']::name[]$$,
  'normal Storage requests receive no object policy for either Axsys bucket'
);

select results_eq(
  $$select class.relname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'file_objects',
        'file_upload_intents',
        'company_bank_accounts',
        'company_settings',
        'company_settings_drafts',
        'provisioning_operations'
      )
    order by class.relname$$,
  $$values
    ('company_bank_accounts', true, true),
    ('company_settings', true, true),
    ('company_settings_drafts', true, true),
    ('file_objects', true, true),
    ('file_upload_intents', true, true),
    ('provisioning_operations', true, true)$$,
  'every Task 2 public table remains ENABLE/FORCE RLS'
);

select results_eq(
  $$select attribute.attname::text collate "default"
    from pg_attribute attribute
    where attribute.attrelid = 'public.file_objects'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.file_objects',
        attribute.attname,
        'SELECT'
      )
    order by attribute.attname$$,
  $$values
    ('archived_at'),
    ('byte_size'),
    ('company_id'),
    ('created_at'),
    ('detected_mime'),
    ('id'),
    ('owner_user_id'),
    ('promoted_at'),
    ('purpose'),
    ('scan_status'),
    ('status')$$,
  'file object SELECT exposes metadata but never path, name or digest'
);

select results_eq(
  $$select attribute.attname::text collate "default"
    from pg_attribute attribute
    where attribute.attrelid = 'public.file_upload_intents'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.file_upload_intents',
        attribute.attname,
        'SELECT'
      )
    order by attribute.attname$$,
  $$values
    ('actor_user_id'),
    ('company_id'),
    ('created_at'),
    ('declared_mime'),
    ('declared_size'),
    ('file_object_id'),
    ('id'),
    ('purpose'),
    ('status'),
    ('target_resource_id')$$,
  'upload intent SELECT excludes path, capability deadlines, claims and errors'
);

select results_eq(
  $$select attribute.attname::text collate "default"
    from pg_attribute attribute
    where attribute.attrelid = 'public.company_bank_accounts'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.company_bank_accounts',
        attribute.attname,
        'SELECT'
      )
    order by attribute.attname$$,
  $$values
    ('account_last4'),
    ('account_type'),
    ('bank_code'),
    ('bank_name'),
    ('branch_last4'),
    ('company_id'),
    ('created_at'),
    ('holder_document_last4'),
    ('holder_name'),
    ('id'),
    ('is_default'),
    ('status'),
    ('updated_at'),
    ('version')$$,
  'bank SELECT exposes only summary columns and no encrypted envelope'
);

select results_eq(
  $$select attribute.attname::text collate "default"
    from pg_attribute attribute
    where attribute.attrelid = 'public.company_settings'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.company_settings',
        attribute.attname,
        'SELECT'
      )
    order by attribute.attname$$,
  $$values
    ('address_city'),
    ('address_complement'),
    ('address_neighborhood'),
    ('address_number'),
    ('address_postal_code'),
    ('address_state'),
    ('address_street'),
    ('company_id'),
    ('consolidated_address'),
    ('letterhead_file_id'),
    ('representative_document_last4'),
    ('representative_name'),
    ('representative_role'),
    ('signature_file_id'),
    ('tax_rate'),
    ('updated_at'),
    ('version')$$,
  'settings SELECT exposes safe fields but not representative ciphertext'
);

select is_empty(
  $$select role_name || ':' || relation_name || ':' || privilege
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'public.file_objects',
      'public.file_upload_intents',
      'public.company_bank_accounts',
      'public.company_settings',
      'public.company_settings_drafts',
      'public.provisioning_operations'
    ]) relation_name
    cross join unnest(array[
      'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(role_name, relation_name, privilege)$$,
  'application roles receive no direct DML or DDL on Task 2 tables'
);

select is_empty(
  $$select role_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    where has_table_privilege(role_name, 'public.audit_events', 'SELECT')$$,
  'audit raw SELECT remains unreachable by every application role'
);
select is_empty(
  $$select grant_item.privilege_type
    from pg_class class
    cross join lateral aclexplode(
      coalesce(class.relacl, acldefault('r', class.relowner))
    ) grant_item
    where class.oid = 'public.audit_events'::regclass
      and grant_item.grantee = 0$$,
  'PUBLIC itself has no inherited privilege on raw audit'
);

select results_eq(
  $$select class.relname::text collate "default",
           owner.rolname::text collate "default",
           ('security_invoker=true' = any(coalesce(class.reloptions, '{}'::text[])))
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_roles owner on owner.oid = class.relowner
    where namespace.nspname = 'public'
      and class.relname in (
        'company_bank_account_summaries',
        'company_settings_safe'
      )
    order by class.relname$$,
  $$values
    ('company_bank_account_summaries','postgres',true),
    ('company_settings_safe','postgres',true)$$,
  'safe views are postgres-owned security invokers'
);

select results_eq(
  $$select table_name::text collate "default",
           string_agg(column_name, ',' order by ordinal_position)::text collate "default"
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'company_bank_account_summaries',
        'company_settings_safe'
      )
    group by table_name
    order by table_name$$,
  $$values
    ('company_bank_account_summaries',
      'id,company_id,bank_code,bank_name,masked_branch,masked_account,account_type,holder_name,masked_holder_document,status,is_default,version,created_at,updated_at'),
    ('company_settings_safe',
      'company_id,representative_name,representative_role,masked_representative_document,tax_rate,address_street,address_number,address_complement,address_neighborhood,address_city,address_state,address_postal_code,consolidated_address,letterhead_file_id,signature_file_id,version,updated_at')$$,
  'safe view output columns are an exact non-secret contract'
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
        'reserve_upload_capability_core',
        'reserve_image_upload_intent',
        'activate_file_upload_authorization',
        'cancel_unissued_file_reservation',
        'list_company_user_directory',
        'guard_membership_identity',
        'protect_last_company_admin',
        'guard_company_branding_files'
      )
    order by function.proname$$,
  $$values
    ('activate_file_upload_authorization',
      'p_actor_user_id uuid, p_session_id uuid, p_intent_id uuid',
      'jsonb','postgres',true,true),
    ('cancel_unissued_file_reservation',
      'p_actor_user_id uuid, p_session_id uuid, p_intent_id uuid',
      'void','postgres',true,true),
    ('guard_company_branding_files','','trigger','postgres',true,true),
    ('guard_membership_identity','','trigger','postgres',false,true),
    ('list_company_user_directory',
      'p_actor_user_id uuid, p_session_id uuid, p_cursor uuid, p_limit integer, p_query text',
      'TABLE(user_id uuid, display_name text, email text, role text, status text, modules text[], created_at timestamp with time zone)',
      'postgres',true,true),
    ('protect_last_company_admin','','trigger','postgres',false,true),
    ('reserve_image_upload_intent',
      'p_actor_user_id uuid, p_session_id uuid, p_purpose text, p_declared_name text, p_declared_mime text, p_declared_size bigint',
      'jsonb','postgres',true,true),
    ('reserve_upload_capability_core',
      'p_company_id uuid, p_actor_user_id uuid, p_purpose file_purpose, p_target_resource_id uuid, p_declared_name text, p_declared_mime text, p_declared_size bigint',
      'jsonb','postgres',false,true)$$,
  'Task 3 routines freeze signatures, return shapes, owner, definer mode and empty search_path'
);

select results_eq(
  $$select function.oid::regprocedure::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'reserve_upload_capability_core',
        'reserve_image_upload_intent',
        'activate_file_upload_authorization',
        'cancel_unissued_file_reservation',
        'list_company_user_directory'
      )
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.oid::regprocedure::text$$,
  $$values
    ('private.activate_file_upload_authorization(uuid,uuid,uuid)'),
    ('private.cancel_unissued_file_reservation(uuid,uuid,uuid)'),
    ('private.list_company_user_directory(uuid,uuid,uuid,integer,text)'),
    ('private.reserve_image_upload_intent(uuid,uuid,text,text,text,bigint)')$$,
  'BFF can execute only the four Task 3 facades and never the quota core'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'reserve_upload_capability_core',
        'reserve_image_upload_intent',
        'activate_file_upload_authorization',
        'cancel_unissued_file_reservation',
        'list_company_user_directory',
        'guard_membership_identity',
        'protect_last_company_admin',
        'guard_company_branding_files'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'no browser, service key or PUBLIC inheritance reaches Task 3 private routines'
);
select is_empty(
  $$select function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    cross join lateral aclexplode(
      coalesce(function.proacl, acldefault('f', function.proowner))
    ) grant_item
    where namespace.nspname = 'private'
      and function.proname in (
        'reserve_upload_capability_core',
        'reserve_image_upload_intent',
        'activate_file_upload_authorization',
        'cancel_unissued_file_reservation',
        'list_company_user_directory',
        'guard_membership_identity',
        'protect_last_company_admin',
        'guard_company_branding_files'
      )
      and grant_item.grantee = 0$$,
  'PUBLIC has no direct default EXECUTE on Task 3 private routines'
);

select matches(
  pg_get_functiondef(
    'private.reserve_upload_capability_core(uuid,uuid,public.file_purpose,uuid,text,text,bigint)'::regprocedure
  ),
  '104857600',
  'quota core freezes the independent 100 MiB per-user capability cap'
);

select results_eq(
  $$select trigger.tgname::text collate "default"
    from pg_trigger trigger
    where trigger.tgrelid in (
      'public.company_memberships'::regclass,
      'public.company_settings'::regclass
    )
      and not trigger.tgisinternal
      and trigger.tgname in (
        'guard_membership_identity_before_update',
        'protect_last_company_admin',
        'guard_company_branding_files_before_write'
      )
    order by trigger.tgname$$,
  $$values
    ('guard_company_branding_files_before_write'),
    ('guard_membership_identity_before_update'),
    ('protect_last_company_admin')$$,
  'identity, last-admin and branding guards are attached exactly once'
);

-- Admin A: same-tenant safe reads work; every cross-tenant or direct-write
-- path remains empty/denied. The session id is always explicit.
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000101'
);
set local role authenticated;

select results_eq(
  $$select count(*)::bigint
    from public.company_settings
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'Admin A can read settings A'
);
select results_eq(
  $$select count(*)::bigint
    from public.company_settings
    where company_id = '30000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Admin A cannot read settings B'
);
select results_eq(
  $$select user_id
    from public.company_settings_drafts
    order by user_id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'Admin A sees only their own draft in A'
);
select results_eq(
  $$select count(*)::bigint
    from public.company_bank_accounts
    where company_id = '30000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Admin A cannot infer bank accounts B'
);
select results_eq(
  $$select id
    from public.file_objects
    order by id$$,
  $$values
    ('60000000-0000-4000-8000-000000000001'::uuid),
    ('60000000-0000-4000-8000-000000000011'::uuid)$$,
  'Admin A sees only clean ready institutional assets in A'
);
select results_eq(
  $$select id
    from public.file_upload_intents
    order by id$$,
  $$values ('70000000-0000-4000-8000-000000000001'::uuid)$$,
  'upload intents are private to their actor'
);
select results_eq(
  $$select user_id
    from public.profiles
    order by user_id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'Company Admin still cannot SELECT raw profiles belonging to colleagues'
);
select throws_ok(
  $$select representative_document_ciphertext
    from public.company_settings$$,
  '42501',
  null,
  'representative ciphertext is not exposed through column grants'
);
select throws_ok(
  $$select account_ciphertext
    from public.company_bank_accounts$$,
  '42501',
  null,
  'bank ciphertext is not exposed through column grants'
);
select throws_ok(
  $$select quarantine_object_path
    from public.file_upload_intents$$,
  '42501',
  null,
  'quarantine paths are never exposed through the user Data API'
);
select throws_ok(
  $$select count(*) from public.audit_events where scope = 'platform'$$,
  '42501',
  null,
  'platform audit is not exposed through the user Data API'
);
select throws_ok(
  format(
    'insert into public.company_settings_drafts(company_id,user_id,payload,base_version) values (%L,%L,%L,1)',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '{"addressCity":"Fortaleza"}'
  ),
  '42501',
  null,
  'Admin A cannot write a draft into company B'
);
select throws_ok(
  $$insert into public.file_upload_intents (
      company_id, actor_user_id, purpose, target_resource_id,
      quarantine_object_path, declared_name, declared_mime,
      declared_size, quota_hold_bytes
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'profile_avatar',
      '20000000-0000-4000-8000-000000000001',
      'attacker/chosen/path',
      'x.png',
      'image/png',
      1,
      2
    )$$,
  '42501',
  null,
  'even Admin A cannot insert a self intent or choose a path directly'
);
select throws_ok(
  $$insert into public.file_upload_intents (
      company_id, actor_user_id, purpose, target_resource_id,
      quarantine_object_path, declared_name, declared_mime,
      declared_size, quota_hold_bytes
    ) values (
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      'company_letterhead',
      '30000000-0000-4000-8000-000000000002',
      'attacker/cross-tenant/path',
      'x.png',
      'image/png',
      1,
      2
    )$$,
  '42501',
  null,
  'Admin A cannot forge a cross-tenant purpose, target or path'
);
select throws_ok(
  $$update public.company_settings
    set tax_rate = 99
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Admin A has no direct settings UPDATE grant'
);
select throws_ok(
  $$delete from public.company_settings_drafts
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Admin A has no direct draft DELETE grant'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      50,
      null
    )$$,
  '42501',
  null,
  'browser-authenticated Admin cannot invoke the BFF directory facade'
);

reset role;

-- Safe directory: only the BFF facade may cross the self-profile policy, and
-- it derives the company from the actor/session instead of accepting tenant
-- input. Its seven output fields are frozen by the catalog assertion above.
set local role axsys_bff;

select results_eq(
  $$select user_id, display_name, email, role, status, modules
    from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      50,
      null
    )
    order by user_id$$,
  $$values
    ('20000000-0000-4000-8000-000000000001'::uuid,
      'admin-a', 'admin-a@example.test', 'company_admin', 'active',
      array['administrative','financial']::text[]),
    ('20000000-0000-4000-8000-000000000002'::uuid,
      'admin-a2', 'admin-a2@example.test', 'company_admin', 'active',
      '{}'::text[]),
    ('20000000-0000-4000-8000-000000000011'::uuid,
      'member-a', 'member-a@example.test', 'member', 'active',
      '{}'::text[]),
    ('20000000-0000-4000-8000-000000000012'::uuid,
      'finance-a', 'finance-a@example.test', 'member', 'active',
      array['financial']::text[])$$,
  'Admin A directory contains only safe fields and users from company A'
);
select results_eq(
  $$select user_id
    from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      50,
      'finance-a'
    )$$,
  $$values ('20000000-0000-4000-8000-000000000012'::uuid)$$,
  'directory search is bounded and parameterized inside the derived tenant'
);
select results_eq(
  $$select count(*)::bigint
    from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      1,
      null
    )$$,
  array[1::bigint],
  'directory enforces the requested bounded page size'
);
select ok(
  (
    with page_one as materialized (
      select user_id
      from private.list_company_user_directory(
        '20000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000101',
        null,
        1,
        null
      )
    ),
    page_two as materialized (
      select user_id
      from private.list_company_user_directory(
        '20000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000101',
        (select user_id from page_one),
        1,
        null
      )
    )
    select (select count(*) from page_one) = 1
       and (select count(*) from page_two) = 1
       and not exists (
         select 1
         from page_one
         join page_two using (user_id)
       )
  ),
  'directory paginates from the returned user id without overlap'
);
select results_eq(
  $$select user_id
    from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000101',
      '90000000-0000-4000-8000-000000000201',
      null,
      50,
      null
    )$$,
  $$values ('20000000-0000-4000-8000-000000000101'::uuid)$$,
  'Admin B directory contains only company B'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000011',
      '90000000-0000-4000-8000-000000000111',
      null,
      50,
      null
    )$$,
  '42501',
  'company_directory_forbidden',
  'Member A cannot invoke the administrative directory'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000201',
      null,
      50,
      null
    )$$,
  '23514',
  'company_directory_session_invalid',
  'directory rejects an actor/session mismatch'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      50,
      null
    )$$,
  '22023',
  'company_directory_cursor_invalid',
  'directory rejects a cursor from company B instead of crossing tenants'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      101,
      null
    )$$,
  '22023',
  'company_directory_input_invalid',
  'directory rejects an unbounded page size'
);
select throws_ok(
  $$select * from private.list_company_user_directory(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      null,
      50,
      repeat('x', 101)
    )$$,
  '22023',
  'company_directory_input_invalid',
  'directory rejects an oversized search query'
);

reset role;

-- Upload capability RPCs. Temp storage lets the BFF role use only returned
-- opaque ids; it never SELECTs the protected tables directly.
create temporary table task3_rpc_results (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on task3_rpc_results to axsys_bff;

set local role axsys_bff;
insert into task3_rpc_results (label, payload)
values (
  'admin-a-profile',
  private.reserve_image_upload_intent(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    'profile_avatar',
    'avatar.png',
    'image/png',
    2048
  )
);
insert into task3_rpc_results (label, payload)
values (
  'admin-a-letterhead-unissued',
  private.reserve_image_upload_intent(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    'company_letterhead',
    'letterhead.jpg',
    'image/jpeg',
    3072
  )
);

select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(
      (select payload from task3_rpc_results where label = 'admin-a-profile')
    ) key$$,
  $$values (array['declaredSize','intentId','quarantinePath']::text[])$$,
  'reservation returns exactly the three public handshake fields'
);
select is(
  (select (payload ->> 'declaredSize')::integer
   from task3_rpc_results where label = 'admin-a-profile'),
  2048,
  'reservation returns the server-committed declared size'
);
select isnt(
  (select payload ->> 'quarantinePath'
   from task3_rpc_results where label = 'admin-a-profile'),
  (select payload ->> 'quarantinePath'
   from task3_rpc_results where label = 'admin-a-letterhead-unissued'),
  'each reservation receives a fresh random path'
);
select matches(
  (select payload ->> 'quarantinePath'
   from task3_rpc_results where label = 'admin-a-profile'),
  '^30000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/[0-9a-f-]{36}/[0-9a-f-]{36}$',
  'quarantine path derives company, actor, intent and random ids on the server'
);

-- Cancellation is legal only before activation/external signing. It retires a
-- never-issued reservation and releases exactly its 2x hold.
select lives_ok(
  format(
    'select private.cancel_unissued_file_reservation(%L,%L,%L)',
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    (select payload ->> 'intentId'
     from task3_rpc_results where label = 'admin-a-letterhead-unissued')
  ),
  'an unactivated reservation can be cancelled before any Storage call'
);

insert into task3_rpc_results (label, payload)
values (
  'admin-a-activation-first',
  private.activate_file_upload_authorization(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    (
      select (payload ->> 'intentId')::uuid
      from task3_rpc_results
      where label = 'admin-a-profile'
    )
  )
);
insert into task3_rpc_results (label, payload)
values (
  'admin-a-activation-replay',
  private.activate_file_upload_authorization(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    (
      select (payload ->> 'intentId')::uuid
      from task3_rpc_results
      where label = 'admin-a-profile'
    )
  )
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(
      (select payload
       from task3_rpc_results
       where label = 'admin-a-activation-first')
    ) key$$,
  $$values (array['finalizeBefore','uploadAuthorizationExpiresAt']::text[])$$,
  'activation returns exactly its two durable deadlines'
);
select is(
  (select payload from task3_rpc_results where label = 'admin-a-activation-first'),
  (select payload from task3_rpc_results where label = 'admin-a-activation-replay'),
  'activation is idempotent and returns the already committed deadlines'
);
select throws_ok(
  format(
    'select private.cancel_unissued_file_reservation(%L,%L,%L)',
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000101',
    (select payload ->> 'intentId'
     from task3_rpc_results where label = 'admin-a-profile')
  ),
  '23514',
  'upload_reservation_not_cancellable',
  'issued/deadlined capability can never use the pre-activation cancel path'
);
select throws_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000011',
      '90000000-0000-4000-8000-000000000111',
      'company_signature',
      'signature.webp',
      'image/webp',
      1024
    )$$,
  '42501',
  'image_upload_forbidden',
  'Member A cannot reserve a branding asset'
);
select lives_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000011',
      '90000000-0000-4000-8000-000000000111',
      'profile_avatar',
      'avatar.webp',
      'image/webp',
      1024
    )$$,
  'Member A can reserve only their own derived profile avatar target'
);
select throws_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000201',
      'profile_avatar',
      'avatar.webp',
      'image/webp',
      1024
    )$$,
  '23514',
  'image_upload_actor_session_invalid',
  'reservation rejects an actor/session mismatch'
);
select throws_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000101',
      'contract_attachment',
      'contract.pdf',
      'application/pdf',
      1024
    )$$,
  '22023',
  'image_upload_input_invalid',
  'image facade is frozen to the three enabled image purposes'
);

-- Finance A already has one fixture capability. Two more reach the independent
-- cap of three; the fourth is rejected under the locked quota transaction.
insert into task3_rpc_results (label, payload)
values (
  'finance-cap-2',
  private.reserve_image_upload_intent(
    '20000000-0000-4000-8000-000000000012',
    '90000000-0000-4000-8000-000000000112',
    'profile_avatar',
    'avatar-2.png',
    'image/png',
    1024
  )
);
insert into task3_rpc_results (label, payload)
values (
  'finance-cap-3',
  private.reserve_image_upload_intent(
    '20000000-0000-4000-8000-000000000012',
    '90000000-0000-4000-8000-000000000112',
    'profile_avatar',
    'avatar-3.png',
    'image/png',
    1024
  )
);
select throws_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000012',
      '90000000-0000-4000-8000-000000000112',
      'profile_avatar',
      'avatar-4.png',
      'image/png',
      1024
    )$$,
  '54000',
  'upload_capability_count_exceeded',
  'one actor cannot hold more than three unretired upload capabilities'
);

reset role;

select results_eq(
  $$select purpose::text, target_resource_id
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task3_rpc_results
      where label = 'admin-a-profile'
    )$$,
  $$values (
    'profile_avatar'::text,
    '20000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'profile reservation derives its target from the actor'
);
select results_eq(
  $$select purpose::text, target_resource_id, status::text,
           quota_hold_bytes, authorization_retired_at is not null
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task3_rpc_results
      where label = 'admin-a-letterhead-unissued'
    )$$,
  $$values ('company_letterhead'::text,
            '30000000-0000-4000-8000-000000000001'::uuid,
            'cancelled'::text, 0::bigint, true)$$,
  'pre-activation cancellation derives company target, retires and zeroes hold'
);
select results_eq(
  $$select status::text,
           upload_authorization_expires_at = authorization_issued_at + interval '2 hours',
           cleanup_not_before = upload_authorization_expires_at + interval '24 hours 15 minutes',
           quota_hold_bytes
    from public.file_upload_intents
    where id = (
      select (payload ->> 'intentId')::uuid
      from task3_rpc_results
      where label = 'admin-a-profile'
    )$$,
  $$values ('issued'::text, true, true, 4096::bigint)$$,
  'activation commits exact deadlines and preserves the 2x capability hold'
);
select is(
  (
    select reserved_bytes
    from private.company_storage_usage
    where company_id = '30000000-0000-4000-8000-000000000001'
  ),
  (
    select coalesce(sum(quota_hold_bytes), 0)::bigint
    from public.file_upload_intents
    where company_id = '30000000-0000-4000-8000-000000000001'
  ),
  'quota counter equals all surviving per-intent holds after safe cancellation'
);

-- The byte cap counts physical capability holds (2x declared bytes) and is
-- independent from the count cap. Two 25 MiB reservations reach exactly
-- 100 MiB and remain legal; one additional declared byte would add a 2-byte
-- hold and fails closed before the count limit.
select lives_ok(
  $$select private.reserve_upload_capability_core(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'generated_document',
      null,
      'boundary-one.pdf',
      'application/pdf',
      26214400
    )$$,
  'first 50 MiB physical capability hold is accepted'
);
select lives_ok(
  $$select private.reserve_upload_capability_core(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'generated_document',
      null,
      'boundary-two.pdf',
      'application/pdf',
      26214400
    )$$,
  'physical capability holds totaling exactly 100 MiB are accepted'
);
select is(
  (
    select sum(quota_hold_bytes)::bigint
    from public.file_upload_intents
    where actor_user_id = '20000000-0000-4000-8000-000000000002'
      and authorization_retired_at is null
  ),
  104857600::bigint,
  'boundary actor holds exactly 100 MiB before the rejection test'
);
select throws_ok(
  $$select private.reserve_upload_capability_core(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'generated_document',
      null,
      'boundary-plus-one.pdf',
      'application/pdf',
      1
    )$$,
  '54000',
  'upload_capability_bytes_exceeded',
  'quota core rejects a physical capability hold above 100 MiB per actor'
);

-- Exhausted company quota fails even for an otherwise valid actor below both
-- personal caps. The synthetic counter is restored immediately.
update private.company_storage_usage
set quota_bytes = 104857600,
    reserved_bytes = 104857599,
    updated_at = statement_timestamp()
where company_id = '30000000-0000-4000-8000-000000000002';
set local role axsys_bff;
select throws_ok(
  $$select private.reserve_image_upload_intent(
      '20000000-0000-4000-8000-000000000101',
      '90000000-0000-4000-8000-000000000201',
      'profile_avatar',
      'quota.png',
      'image/png',
      1
    )$$,
  '53100',
  'company_storage_quota_exceeded',
  'locked company quota rejects a reservation whose 2x hold would overflow'
);
reset role;
update private.company_storage_usage
set quota_bytes = 5368709120,
    reserved_bytes = (
      select coalesce(sum(intent.quota_hold_bytes), 0)::bigint
      from public.file_upload_intents intent
      where intent.company_id = '30000000-0000-4000-8000-000000000002'
    ),
    updated_at = statement_timestamp()
where company_id = '30000000-0000-4000-8000-000000000002';

-- Branding guard applies even to privileged future RPCs.
select throws_ok(
  $$update public.company_settings
    set letterhead_file_id = '60000000-0000-4000-8000-000000000001'
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'AXSYS_INVALID_LETTERHEAD_FILE',
  'a profile avatar cannot be attached as company letterhead'
);
select throws_ok(
  $$update public.company_settings
    set signature_file_id = '60000000-0000-4000-8000-000000000012'
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'AXSYS_INVALID_SIGNATURE_FILE',
  'infected/rejected signature metadata cannot be attached'
);
select throws_ok(
  $$update public.company_settings
    set letterhead_file_id = '60000000-0000-4000-8000-000000000002'
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'AXSYS_INVALID_LETTERHEAD_FILE',
  'branding guard rejects a clean file from company B before the FK can leak detail'
);
select lives_ok(
  $$update public.company_settings
    set letterhead_file_id = '60000000-0000-4000-8000-000000000011'
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  'clean ready company letterhead can be attached by a privileged RPC'
);

-- Revoked and must-change-password sessions retain their JWT but see zero
-- operational rows in every Task 3 relation/view.
select private.revoke_auth_sessions(
  '20000000-0000-4000-8000-000000000012',
  null
);
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000012',
  '90000000-0000-4000-8000-000000000112'
);
set local role authenticated;
select is_empty($$select company_id from public.company_settings$$,
  'revoked session reads zero settings');
select is_empty($$select company_id from public.company_settings_drafts$$,
  'revoked session reads zero drafts');
select is_empty($$select id from public.company_bank_account_summaries$$,
  'revoked session reads zero bank summaries');
select is_empty($$select id from public.file_objects$$,
  'revoked session reads zero file objects');
select is_empty($$select id from public.file_upload_intents$$,
  'revoked session reads zero upload intents');
reset role;
select test_helpers.clear_jwt();

update public.profiles
set must_change_password = true,
    temporary_password_expires_at = statement_timestamp() + interval '1 hour'
where user_id = '20000000-0000-4000-8000-000000000011';
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111'
);
set local role authenticated;
select is_empty($$select company_id from public.company_settings$$,
  'must-change session reads zero settings');
select is_empty($$select company_id from public.company_settings_drafts$$,
  'must-change session reads zero drafts');
select is_empty($$select id from public.company_bank_account_summaries$$,
  'must-change session reads zero bank summaries');
select is_empty($$select id from public.file_objects$$,
  'must-change session reads zero file objects');
select is_empty($$select id from public.file_upload_intents$$,
  'must-change session reads zero upload intents');
reset role;
select test_helpers.clear_jwt();

update public.profiles
set must_change_password = false,
    temporary_password_expires_at = null
where user_id = '20000000-0000-4000-8000-000000000011';
select test_helpers.activate_platform_users_settings_session(
  '20000000-0000-4000-8000-000000000012',
  '90000000-0000-4000-8000-000000000212',
  '81000000-0000-4000-8000-000000000212',
  clock_timestamp()
);

-- Member A can read common institutional settings/assets but cannot mutate,
-- read drafts/banks, or reserve company branding.
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111'
);
set local role authenticated;

select results_eq(
  $$select company_id
    from public.company_settings$$,
  $$values ('30000000-0000-4000-8000-000000000001'::uuid)$$,
  'Member A reads only common settings A'
);
select is_empty(
  $$select company_id from public.company_settings_drafts$$,
  'Member A cannot read any settings draft'
);
select is_empty(
  $$select id from public.company_bank_account_summaries$$,
  'Member A without financial module cannot read bank summaries'
);
select results_eq(
  $$select count(*)::bigint from public.file_objects$$,
  array[2::bigint],
  'Member A reads only ready clean institutional assets A'
);
select throws_ok(
  $$insert into public.company_settings_drafts (
      company_id, user_id, payload, base_version
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000011',
      '{}',
      1
    )$$,
  '42501',
  null,
  'Member A cannot write even their own settings draft directly'
);
select throws_ok(
  $$update public.company_settings
    set tax_rate = 1
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Member A cannot update company settings directly'
);
select throws_ok(
  $$delete from public.file_objects
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'Member A cannot delete file metadata'
);

reset role;
select test_helpers.clear_jwt();

-- Finance A receives active, masked A summaries only.
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000012',
  '90000000-0000-4000-8000-000000000212'
);
set local role authenticated;

select results_eq(
  $$select company_id, masked_branch, masked_account, masked_holder_document
    from public.company_bank_account_summaries
    order by id$$,
  $$values (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '0001'::text,
    '1234'::text,
    '••••4321'::text
  )$$,
  'Finance A reads only the active masked bank summary in A'
);
select results_eq(
  $$select id
    from public.company_bank_accounts
    order by id$$,
  $$values ('50000000-0000-4000-8000-000000000001'::uuid)$$,
  'Finance A cannot see the archived account even through safe table columns'
);
select is_empty(
  $$select id
    from public.company_bank_account_summaries
    where id = '50000000-0000-4000-8000-000000000011'$$,
  'Finance A cannot see the archived account through the summary view'
);
select results_eq(
  $$select count(*)::bigint
    from public.company_bank_accounts
    where company_id = '30000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Finance A cannot infer bank accounts B'
);
select throws_ok(
  $$select branch_ciphertext, account_ciphertext, holder_document_ciphertext
    from public.company_bank_accounts$$,
  '42501',
  null,
  'Finance A never receives encrypted bank payloads'
);
select is_empty(
  $$select company_id from public.company_settings_drafts$$,
  'Finance module does not imply access to settings drafts'
);

reset role;

select test_helpers.clear_jwt();

-- Super Admin has a separate BFF-only platform plane and no universal tenant
-- RLS policy.
select test_helpers.set_jwt(
  '10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000100'
);
set local role authenticated;

select is_empty(
  $$select company_id from public.company_settings$$,
  'Super Admin cannot read tenant settings directly'
);
select is_empty(
  $$select company_id from public.company_settings_drafts$$,
  'Super Admin cannot read tenant drafts directly'
);
select is_empty(
  $$select id from public.file_objects$$,
  'Super Admin cannot read tenant file metadata directly'
);
select is_empty(
  $$select id from public.file_upload_intents$$,
  'Super Admin cannot read tenant upload capabilities directly'
);
select is_empty(
  $$select id from public.company_bank_account_summaries$$,
  'Super Admin cannot read tenant bank summaries directly'
);

reset role;
select test_helpers.clear_jwt();

-- Anonymous access is denied at the privilege boundary, including Storage.
set local role anon;
select throws_ok(
  $$select id from public.file_objects$$,
  '42501',
  null,
  'anon cannot select file objects'
);
select throws_ok(
  $$select id from public.file_upload_intents$$,
  '42501',
  null,
  'anon cannot select upload intents'
);
select throws_ok(
  $$select id from public.company_bank_account_summaries$$,
  '42501',
  null,
  'anon cannot select bank summaries'
);
select throws_ok(
  $$select company_id from public.company_settings_safe$$,
  '42501',
  null,
  'anon cannot select safe settings'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('axsys-quarantine', 'attacker/path', '{}'::jsonb)$$,
  '42501',
  null,
  'anon cannot upload directly to quarantine'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('axsys-private', 'attacker/path', '{}'::jsonb)$$,
  '42501',
  null,
  'anon cannot upload directly to private storage'
);

reset role;

select * from finish();
rollback;
