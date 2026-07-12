begin;
\ir helpers/fixtures.inc

select plan(92);

select test_helpers.create_company(
  '30000000-0000-4000-8000-000000000001',
  'Empresa A',
  '12345678000190'
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000001',
  'admin-a@example.com',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'
);

select has_table('public'::name, 'file_objects'::name);
select has_table('public'::name, 'file_upload_intents'::name);
select has_table('public'::name, 'company_bank_accounts'::name);
select has_table('public'::name, 'company_settings'::name);
select has_table('public'::name, 'company_settings_drafts'::name);
select has_table('public'::name, 'provisioning_operations'::name);
select has_table('private'::name, 'company_storage_usage'::name);
select has_column(
  'public'::name,
  'profiles'::name,
  'avatar_file_id'::name,
  'profiles expose the avatar file reference'
);
select col_not_null('public'::name, 'file_objects'::name, 'company_id'::name);
select col_not_null(
  'public'::name,
  'company_bank_accounts'::name,
  'account_ciphertext'::name
);
select has_index(
  'public'::name,
  'company_bank_accounts'::name,
  'company_bank_accounts_one_active_default_idx'::name
);
select has_column(
  'public'::name,
  'file_objects'::name,
  'promoted_at'::name,
  'file objects record promotion time'
);
select has_index(
  'public'::name,
  'file_objects'::name,
  'file_objects_company_purpose_status_idx'::name
);
select col_type_is(
  'public'::name,
  'file_objects'::name,
  'scan_status'::name,
  'public'::name,
  'file_scan_status'::name
);
select results_eq(
  $$select quota_bytes
    from private.company_storage_usage
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  $$values (5368709120::bigint)$$,
  'new company receives the configured default quota'
);
select ok(
  exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  )
  and (
    select used_bytes = 0 and reserved_bytes = 0
    from private.company_storage_usage
    where company_id = '30000000-0000-4000-8000-000000000001'
  ),
  'pg_cron is installed and new quota starts without phantom bytes'
);
select throws_ok(
  $$update private.company_storage_usage
    set reserved_bytes = quota_bytes + 1
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '23514'
);
select is(
  private.format_company_address(
    'Rua A',
    '10',
    null,
    null,
    'Fortaleza',
    'CE',
    '60000000'
  ),
  'Rua A, 10 · Fortaleza/CE · CEP 60000000',
  'address omits empty separators'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id, bank_code, bank_name, branch_ciphertext, branch_iv, branch_tag,
     branch_key_version, branch_last4, account_ciphertext, account_iv, account_tag,
     account_key_version, account_last4, account_type, holder_name, status,
     is_default, created_by, updated_by)
    values ('30000000-0000-4000-8000-000000000001', '001', 'Banco', 'c2VjcmV0',
            'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 1, '0001', 'c2VjcmV0',
            'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 1, '1234',
            'checking', 'Titular', 'archived', true,
            '20000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_settings_drafts(company_id, user_id, payload, base_version)
    values ('30000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001', '[]'::jsonb, 1)$$,
  '23514'
);

select results_eq(
  $$select type.typname::text collate "default",
           enum.enumlabel::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_enum enum on enum.enumtypid = type.oid
    where namespace.nspname = 'public'
      and type.typname in (
        'file_purpose', 'file_scan_status', 'file_status', 'upload_intent_status',
        'bank_account_status', 'bank_account_type', 'provisioning_kind',
        'provisioning_status'
      )
    order by type.typname, enum.enumsortorder$$,
  $$values
    ('bank_account_status','active'),('bank_account_status','archived'),
    ('bank_account_type','checking'),('bank_account_type','savings'),
    ('bank_account_type','payment'),
    ('file_purpose','profile_avatar'),('file_purpose','company_letterhead'),
    ('file_purpose','company_signature'),('file_purpose','contract_attachment'),
    ('file_purpose','payment_invoice'),('file_purpose','certificate'),
    ('file_purpose','generated_document'),
    ('file_scan_status','pending'),('file_scan_status','clean'),
    ('file_scan_status','infected'),('file_scan_status','failed'),
    ('file_status','ready'),('file_status','rejected'),('file_status','archived'),
    ('provisioning_kind','company_first_admin'),('provisioning_kind','company_member'),
    ('provisioning_status','reserved'),('provisioning_status','auth_created'),
    ('provisioning_status','committed'),('provisioning_status','compensated'),
    ('provisioning_status','compensation_required'),('provisioning_status','failed'),
    ('upload_intent_status','reserved'),('upload_intent_status','issued'),
    ('upload_intent_status','finalizing'),('upload_intent_status','ready'),
    ('upload_intent_status','rejected'),('upload_intent_status','expired'),
    ('upload_intent_status','cancelled'),('upload_intent_status','cleanup_required')$$,
  'schema enums expose exactly the contracted labels and order'
);

select results_eq(
  $$select type.typname::text collate "default", owner.rolname::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_roles owner on owner.oid = type.typowner
    where namespace.nspname = 'public'
      and type.typname in (
        'file_purpose','file_scan_status','file_status','upload_intent_status',
        'bank_account_status','bank_account_type','provisioning_kind','provisioning_status'
      )
    order by type.typname$$,
  $$values
    ('bank_account_status','postgres'),('bank_account_type','postgres'),
    ('file_purpose','postgres'),('file_scan_status','postgres'),('file_status','postgres'),
    ('provisioning_kind','postgres'),('provisioning_status','postgres'),
    ('upload_intent_status','postgres')$$,
  'schema enums are owned exactly by postgres'
);

select results_eq(
  $$select table_schema::text collate "default",
           table_name::text collate "default",
           string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where (table_schema, table_name) in (
      ('private','company_storage_usage'),
      ('public','file_objects'),
      ('public','file_upload_intents'),
      ('public','company_bank_accounts'),
      ('public','company_settings'),
      ('public','company_settings_drafts'),
      ('public','provisioning_operations')
    )
    group by table_schema, table_name
    order by table_schema, table_name$$,
  $$values
    ('private','company_storage_usage','company_id,quota_bytes,used_bytes,reserved_bytes,version,updated_at'),
    ('public','company_bank_accounts','id,company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,account_key_version,account_last4,account_type,holder_name,holder_document_ciphertext,holder_document_iv,holder_document_tag,holder_document_key_version,holder_document_last4,status,is_default,version,created_by,updated_by,created_at,updated_at,archived_at'),
    ('public','company_settings','company_id,representative_name,representative_role,representative_document_ciphertext,representative_document_iv,representative_document_tag,representative_document_key_version,representative_document_last4,tax_rate,address_street,address_number,address_complement,address_neighborhood,address_city,address_state,address_postal_code,consolidated_address,letterhead_file_id,signature_file_id,version,updated_by,updated_at'),
    ('public','company_settings_drafts','company_id,user_id,payload,base_version,version,updated_at'),
    ('public','file_objects','id,company_id,owner_user_id,purpose,bucket,object_path,original_name,detected_mime,byte_size,sha256,scan_status,status,created_by,created_at,promoted_at,archived_at,retirement_not_before,retirement_claim_id,retirement_claimed_at,storage_deleted_at,quota_released_at'),
    ('public','file_upload_intents','id,company_id,actor_user_id,purpose,target_resource_id,quarantine_object_path,declared_name,declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at,upload_authorization_expires_at,cleanup_not_before,authorization_retired_at,authorization_cleanup_claim_id,authorization_cleanup_claimed_at,cleanup_error_code,file_object_id,version,created_at,updated_at'),
    ('public','provisioning_operations','id,idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,auth_user_id,status,last_error_code,correlation_id,created_at,updated_at')$$,
  'schema tables expose exactly the contracted columns'
);

select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           constraint_row.conname::text collate "default"
    from pg_constraint constraint_row
    join pg_class class on class.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where constraint_row.contype = 'c'
      and (namespace.nspname, class.relname) in (
        ('private','company_storage_usage'),
        ('public','file_objects'),('public','file_upload_intents'),
        ('public','company_bank_accounts'),('public','company_settings'),
        ('public','company_settings_drafts'),('public','provisioning_operations')
      )
    order by namespace.nspname, class.relname, constraint_row.conname$$,
  $$values
    ('private','company_storage_usage','company_storage_usage_capacity'),
    ('private','company_storage_usage','company_storage_usage_quota_bounds'),
    ('private','company_storage_usage','company_storage_usage_reserved_nonnegative'),
    ('private','company_storage_usage','company_storage_usage_used_nonnegative'),
    ('public','company_bank_accounts','company_bank_accounts_account_ciphertext_base64'),
    ('public','company_bank_accounts','company_bank_accounts_account_iv_length'),
    ('public','company_bank_accounts','company_bank_accounts_account_key_version_positive'),
    ('public','company_bank_accounts','company_bank_accounts_account_last4_format'),
    ('public','company_bank_accounts','company_bank_accounts_account_tag_length'),
    ('public','company_bank_accounts','company_bank_accounts_archive_state'),
    ('public','company_bank_accounts','company_bank_accounts_bank_code_format'),
    ('public','company_bank_accounts','company_bank_accounts_bank_name_length'),
    ('public','company_bank_accounts','company_bank_accounts_branch_ciphertext_base64'),
    ('public','company_bank_accounts','company_bank_accounts_branch_iv_length'),
    ('public','company_bank_accounts','company_bank_accounts_branch_key_version_positive'),
    ('public','company_bank_accounts','company_bank_accounts_branch_last4_format'),
    ('public','company_bank_accounts','company_bank_accounts_branch_tag_length'),
    ('public','company_bank_accounts','company_bank_accounts_default_active'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_ciphertext_base64'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_iv_length'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_key_version_positive'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_last4_format'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_state'),
    ('public','company_bank_accounts','company_bank_accounts_holder_document_tag_length'),
    ('public','company_bank_accounts','company_bank_accounts_holder_name_length'),
    ('public','company_settings','company_settings_address_postal_code_format'),
    ('public','company_settings','company_settings_address_state_format'),
    ('public','company_settings','company_settings_representative_document_ciphertext_base64'),
    ('public','company_settings','company_settings_representative_document_iv_length'),
    ('public','company_settings','company_settings_representative_document_key_version_positive'),
    ('public','company_settings','company_settings_representative_document_last4_format'),
    ('public','company_settings','company_settings_representative_document_state'),
    ('public','company_settings','company_settings_representative_document_tag_length'),
    ('public','company_settings','company_settings_tax_rate_bounds'),
    ('public','company_settings_drafts','company_settings_drafts_base_version_positive'),
    ('public','company_settings_drafts','company_settings_drafts_payload_object'),
    ('public','file_objects','file_objects_archive_state'),
    ('public','file_objects','file_objects_bucket_value'),
    ('public','file_objects','file_objects_byte_size_bounds'),
    ('public','file_objects','file_objects_infected_state'),
    ('public','file_objects','file_objects_object_path_safe'),
    ('public','file_objects','file_objects_original_name_length'),
    ('public','file_objects','file_objects_profile_owner'),
    ('public','file_objects','file_objects_ready_state'),
    ('public','file_objects','file_objects_retirement_claim_pair'),
    ('public','file_objects','file_objects_retirement_purpose'),
    ('public','file_objects','file_objects_sha256_format'),
    ('public','file_objects','file_objects_storage_quota_release_pair'),
    ('public','file_upload_intents','file_upload_intents_authorization_claim_pair'),
    ('public','file_upload_intents','file_upload_intents_authorization_expiry_window'),
    ('public','file_upload_intents','file_upload_intents_authorization_retirement_order'),
    ('public','file_upload_intents','file_upload_intents_authorization_state'),
    ('public','file_upload_intents','file_upload_intents_cleanup_error_code_format'),
    ('public','file_upload_intents','file_upload_intents_cleanup_window'),
    ('public','file_upload_intents','file_upload_intents_declared_name_length'),
    ('public','file_upload_intents','file_upload_intents_declared_size_bounds'),
    ('public','file_upload_intents','file_upload_intents_quarantine_object_path_safe'),
    ('public','file_upload_intents','file_upload_intents_quota_hold_values'),
    ('public','provisioning_operations','provisioning_operations_idempotency_key_hash'),
    ('public','provisioning_operations','provisioning_operations_last_error_code_allowlist'),
    ('public','provisioning_operations','provisioning_operations_request_hash_format'),
    ('public','provisioning_operations','provisioning_operations_subject_email_hash_format')$$,
  'check constraints expose exactly the named integrity contract'
);

select results_eq(
  $$select child_namespace.nspname::text collate "default",
           child.relname::text collate "default",
           constraint_row.conname::text collate "default",
           array_to_string(array(
             select child_attribute.attname
             from unnest(constraint_row.conkey) with ordinality key(attnum, ordinality)
             join pg_attribute child_attribute
               on child_attribute.attrelid = constraint_row.conrelid
              and child_attribute.attnum = key.attnum
             order by key.ordinality
           ), ',')::text collate "default",
           parent_namespace.nspname::text collate "default",
           parent.relname::text collate "default",
           array_to_string(array(
             select parent_attribute.attname
             from unnest(constraint_row.confkey) with ordinality key(attnum, ordinality)
             join pg_attribute parent_attribute
               on parent_attribute.attrelid = constraint_row.confrelid
              and parent_attribute.attnum = key.attnum
             order by key.ordinality
           ), ',')::text collate "default",
           constraint_row.confdeltype::text collate "default"
    from pg_constraint constraint_row
    join pg_class child on child.oid = constraint_row.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
    join pg_class parent on parent.oid = constraint_row.confrelid
    join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
    where constraint_row.contype = 'f'
      and (
        (child_namespace.nspname, child.relname) in (
          ('private','company_storage_usage'),
          ('public','file_objects'),('public','file_upload_intents'),
          ('public','company_bank_accounts'),('public','company_settings'),
          ('public','company_settings_drafts'),('public','provisioning_operations')
        )
        or constraint_row.conname = 'profiles_avatar_file_id_fkey'
      )
    order by child_namespace.nspname, child.relname, constraint_row.conname$$,
  $$values
    ('private','company_storage_usage','company_storage_usage_company_id_fkey','company_id','public','companies','id','r'),
    ('public','company_bank_accounts','company_bank_accounts_company_id_fkey','company_id','public','companies','id','r'),
    ('public','company_bank_accounts','company_bank_accounts_created_by_fkey','created_by','public','profiles','user_id','r'),
    ('public','company_bank_accounts','company_bank_accounts_updated_by_fkey','updated_by','public','profiles','user_id','r'),
    ('public','company_settings','company_settings_company_id_fkey','company_id','public','companies','id','r'),
    ('public','company_settings','company_settings_company_id_letterhead_file_id_fkey','company_id,letterhead_file_id','public','file_objects','company_id,id','r'),
    ('public','company_settings','company_settings_company_id_signature_file_id_fkey','company_id,signature_file_id','public','file_objects','company_id,id','r'),
    ('public','company_settings','company_settings_updated_by_fkey','updated_by','public','profiles','user_id','r'),
    ('public','company_settings_drafts','company_settings_drafts_company_id_fkey','company_id','public','companies','id','c'),
    ('public','company_settings_drafts','company_settings_drafts_user_id_fkey','user_id','public','profiles','user_id','c'),
    ('public','file_objects','file_objects_company_id_fkey','company_id','public','companies','id','r'),
    ('public','file_objects','file_objects_created_by_fkey','created_by','public','profiles','user_id','r'),
    ('public','file_objects','file_objects_owner_user_id_fkey','owner_user_id','public','profiles','user_id','r'),
    ('public','file_upload_intents','file_upload_intents_actor_user_id_fkey','actor_user_id','public','profiles','user_id','r'),
    ('public','file_upload_intents','file_upload_intents_company_id_file_object_id_fkey','company_id,file_object_id','public','file_objects','company_id,id','r'),
    ('public','file_upload_intents','file_upload_intents_company_id_fkey','company_id','public','companies','id','r'),
    ('public','profiles','profiles_avatar_file_id_fkey','avatar_file_id','public','file_objects','id','n'),
    ('public','provisioning_operations','provisioning_operations_actor_user_id_fkey','actor_user_id','public','profiles','user_id','r'),
    ('public','provisioning_operations','provisioning_operations_company_id_fkey','company_id','public','companies','id','r')$$,
  'foreign keys expose exactly the tenant-safe references and delete actions'
);

select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           owner.rolname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_roles owner on owner.oid = class.relowner
    where (namespace.nspname, class.relname) in (
      ('private','company_storage_usage'),
      ('public','file_objects'),('public','file_upload_intents'),
      ('public','company_bank_accounts'),('public','company_settings'),
      ('public','company_settings_drafts'),('public','provisioning_operations')
    )
    order by namespace.nspname, class.relname$$,
  $$values
    ('private','company_storage_usage','postgres',true,true),
    ('public','company_bank_accounts','postgres',true,true),
    ('public','company_settings','postgres',true,true),
    ('public','company_settings_drafts','postgres',true,true),
    ('public','file_objects','postgres',true,true),
    ('public','file_upload_intents','postgres',true,true),
    ('public','provisioning_operations','postgres',true,true)$$,
  'all schema tables are postgres-owned and force RLS'
);

select is_empty(
  $$select schemaname || '.' || tablename || ':' || policyname
    from pg_policies
    where (schemaname, tablename) in (
      ('private','company_storage_usage'),
      ('public','file_objects'),('public','file_upload_intents'),
      ('public','company_bank_accounts'),('public','company_settings'),
      ('public','company_settings_drafts'),('public','provisioning_operations')
    )
      and (cmd <> 'SELECT' or tablename = 'provisioning_operations')$$,
  'later read policies never weaken the schema tables with writes or journal access'
);

select is_empty(
  $$select namespace.nspname || '.' || class.relname || ':'
           || coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where (namespace.nspname, class.relname) in (
      ('private','company_storage_usage'),
      ('public','file_objects'),('public','file_upload_intents'),
      ('public','company_bank_accounts'),('public','company_settings'),
      ('public','company_settings_drafts'),('public','provisioning_operations')
    )
      and (grant_item.grantee = 0 or grantee.rolname in ('anon','authenticated','service_role','axsys_bff'))
      and grant_item.privilege_type <> 'SELECT'$$,
  'table ACL catalogs contain no direct application write grants'
);

select is_empty(
  $$select role_name || ':' || relation_name || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'private.company_storage_usage',
      'public.file_objects','public.file_upload_intents','public.company_bank_accounts',
      'public.company_settings','public.company_settings_drafts','public.provisioning_operations'
    ]) relation_name
    cross join unnest(array[
      'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(role_name, relation_name, privilege)$$,
  'role inheritance cannot recover table write privileges'
);

select is_empty(
  $$select namespace.nspname || '.' || class.relname || '.' || attribute.attname || ':'
           || coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_attribute attribute
    join pg_class class on class.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(attribute.attacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where (namespace.nspname, class.relname) in (
      ('private','company_storage_usage'),
      ('public','file_objects'),('public','file_upload_intents'),
      ('public','company_bank_accounts'),('public','company_settings'),
      ('public','company_settings_drafts'),('public','provisioning_operations')
    )
      and (grant_item.grantee = 0 or grantee.rolname in ('anon','authenticated','service_role','axsys_bff'))
      and grant_item.privilege_type <> 'SELECT'$$,
  'column ACL catalogs contain no direct application write grants'
);

select is_empty(
  $$select role_name || ':' || namespace.nspname || '.' || class.relname || '.'
           || attribute.attname || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array['INSERT','UPDATE','REFERENCES']) privilege
    cross join pg_attribute attribute
    join pg_class class on class.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where attribute.attnum > 0 and not attribute.attisdropped
      and (namespace.nspname, class.relname) in (
        ('private','company_storage_usage'),
        ('public','file_objects'),('public','file_upload_intents'),
        ('public','company_bank_accounts'),('public','company_settings'),
        ('public','company_settings_drafts'),('public','provisioning_operations')
      )
      and has_column_privilege(role_name, attribute.attrelid, attribute.attnum, privilege)$$,
  'role inheritance cannot recover column write privileges'
);

select is_empty(
  $$select type.typname || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':'
           || grant_item.privilege_type
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    cross join lateral aclexplode(coalesce(type.typacl, acldefault('T', type.typowner))) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'public'
      and type.typname in (
        'file_purpose','file_scan_status','file_status','upload_intent_status',
        'bank_account_status','bank_account_type','provisioning_kind','provisioning_status'
      )
      and (grant_item.grantee = 0 or grantee.rolname in ('anon','authenticated','service_role','axsys_bff'))$$,
  'enum ACL catalogs contain no direct application grants'
);

select is_empty(
  $$select role_name || ':' || type.typname
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname in (
        'file_purpose','file_scan_status','file_status','upload_intent_status',
        'bank_account_status','bank_account_type','provisioning_kind','provisioning_status'
      )
      and has_type_privilege(role_name, type.oid, 'USAGE')$$,
  'role inheritance cannot recover enum USAGE'
);

select results_eq(
  $$select function.proname::text collate "default",
           pg_get_function_identity_arguments(function.oid)::text collate "default",
           pg_get_function_result(function.oid)::text collate "default",
           owner.rolname::text collate "default",
           language.lanname::text collate "default",
           function.provolatile::text collate "default",
           function.prosecdef,
           function.proconfig = array['search_path=""']::text[]
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_roles owner on owner.oid = function.proowner
    join pg_language language on language.oid = function.prolang
    where namespace.nspname = 'private'
      and function.proname in (
        'format_company_address','initialize_company_storage_usage','is_canonical_base64'
      )
    order by function.proname$$,
  $$values
    ('format_company_address','p_street text, p_number text, p_complement text, p_neighborhood text, p_city text, p_state text, p_postal_code text','text','postgres','sql','i',false,true),
    ('initialize_company_storage_usage','','trigger','postgres','plpgsql','v',true,true),
    ('is_canonical_base64','p_value text, p_expected_bytes integer','boolean','postgres','plpgsql','i',false,true)$$,
  'private helpers freeze signatures, owner, volatility, definer and search_path'
);

select is_empty(
  $$select function.oid::regprocedure::text || ':' || coalesce(grantee.rolname, 'PUBLIC')
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'private'
      and function.proname in (
        'format_company_address','initialize_company_storage_usage','is_canonical_base64'
      )
      and (grant_item.grantee = 0 or grantee.rolname in ('anon','authenticated','service_role','axsys_bff'))$$,
  'private helper ACL catalogs contain no direct application grants'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'format_company_address','initialize_company_storage_usage','is_canonical_base64'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'role inheritance cannot recover private helper execution'
);

select results_eq(
  $$select trigger.tgname::text collate "default",
           trigger.tgenabled::text collate "default",
           pg_get_triggerdef(trigger.oid, false)::text collate "default"
    from pg_trigger trigger
    where trigger.tgrelid = 'public.companies'::regclass
      and trigger.tgname = 'companies_initialize_storage_usage'
      and not trigger.tgisinternal$$,
  $$values (
    'companies_initialize_storage_usage','O',
    'CREATE TRIGGER companies_initialize_storage_usage AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION private.initialize_company_storage_usage()'
  )$$,
  'quota trigger is enabled with the exact row-level insert contract'
);

select is_empty(
  $$select company.id
    from public.companies company
    left join private.company_storage_usage usage on usage.company_id = company.id
    where usage.company_id is null$$,
  'backfill and trigger leave no company without a quota row'
);

select results_eq(
  $$select extension.extname::text collate "default",
           namespace.nspname::text collate "default",
           owner.rolname::text collate "default"
    from pg_extension extension
    join pg_namespace namespace on namespace.oid = extension.extnamespace
    join pg_roles owner on owner.oid = extension.extowner
    where extension.extname = 'pg_cron'$$,
  $$values ('pg_cron','pg_catalog','supabase_admin')$$,
  'pg_cron is installed in pg_catalog with its managed owner'
);

select results_eq(
  $$select namespace.nspname::text collate "default", owner.rolname::text collate "default"
    from pg_namespace namespace
    join pg_roles owner on owner.oid = namespace.nspowner
    where namespace.nspname = 'cron'$$,
  $$values ('cron','supabase_admin')$$,
  'cron schema retains its managed owner'
);

select is_empty(
  $$select object_kind || ':' || object_name || ':' || owner_name
    from (
      select 'relation'::text as object_kind, class.relname::text as object_name,
             owner.rolname::text as owner_name
      from pg_class class
      join pg_roles owner on owner.oid = class.relowner
      where class.relnamespace = 'cron'::regnamespace
      union all
      select 'function', function.oid::regprocedure::text, owner.rolname::text
      from pg_proc function
      join pg_roles owner on owner.oid = function.proowner
      where function.pronamespace = 'cron'::regnamespace
    ) cron_objects
    where owner_name <> 'supabase_admin'$$,
  'cron relations and functions retain the managed owner'
);

select results_eq(
  $$select object_kind::text collate "default",
           object_name::text collate "default",
           grantee_name::text collate "default",
           privilege_type::text collate "default",
           grantor_name::text collate "default",
           is_grantable
    from (
      select case when class.relkind = 'S' then 'sequence' else 'relation' end as object_kind,
             class.oid::regclass::text as object_name,
             case when grant_item.grantee = 0 then 'public' else grantee.rolname end as grantee_name,
             grant_item.privilege_type,
             grantor.rolname as grantor_name,
             grant_item.is_grantable
      from pg_class class
      cross join lateral aclexplode(coalesce(
        class.relacl,
        acldefault(case when class.relkind = 'S' then 'S'::"char" else 'r'::"char" end, class.relowner)
      )) grant_item
      left join pg_roles grantee on grantee.oid = grant_item.grantee
      join pg_roles grantor on grantor.oid = grant_item.grantor
      where class.relnamespace = 'cron'::regnamespace
        and class.relkind in ('r','p','v','m','f','S')
      union all
      select 'function', function.oid::regprocedure::text,
             case when grant_item.grantee = 0 then 'public' else grantee.rolname end,
             grant_item.privilege_type,
             grantor.rolname,
             grant_item.is_grantable
      from pg_proc function
      cross join lateral aclexplode(coalesce(
        function.proacl,
        acldefault('f'::"char", function.proowner)
      )) grant_item
      left join pg_roles grantee on grantee.oid = grant_item.grantee
      join pg_roles grantor on grantor.oid = grant_item.grantor
      where function.pronamespace = 'cron'::regnamespace
    ) cron_acl
    where grantee_name in ('public','anon','authenticated','service_role','axsys_bff')
    order by object_kind, object_name, grantee_name, privilege_type$$,
  $$values
    ('function','cron.job_cache_invalidate()','public','EXECUTE','supabase_admin',false),
    ('function','cron.schedule(text,text,text)','public','EXECUTE','supabase_admin',false),
    ('function','cron.schedule(text,text)','public','EXECUTE','supabase_admin',false),
    ('function','cron.unschedule(bigint)','public','EXECUTE','supabase_admin',false),
    ('function','cron.unschedule(text)','public','EXECUTE','supabase_admin',false),
    ('relation','cron.job','public','SELECT','supabase_admin',false),
    ('relation','cron.job_run_details','public','DELETE','supabase_admin',false),
    ('relation','cron.job_run_details','public','SELECT','supabase_admin',false)$$,
  'managed pg_cron direct ACL is frozen while schema USAGE remains denied'
);

select is_empty(
  $$select role_name || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array['USAGE','CREATE']) privilege
    where has_schema_privilege(role_name, 'cron', privilege)$$,
  'application roles have no effective cron schema access'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    where function.pronamespace = 'cron'::regnamespace
      and has_schema_privilege(role_name, 'cron', 'USAGE')
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'application roles cannot effectively reach cron functions'
);

select is_empty(
  $$select role_name || ':' || class.relname || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_class class
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where class.relnamespace = 'cron'::regnamespace
      and class.relkind in ('r','p','v','m','f')
      and has_schema_privilege(role_name, 'cron', 'USAGE')
      and has_table_privilege(role_name, class.oid, privilege)$$,
  'application roles cannot effectively reach cron relations'
);

select is_empty(
  $$select role_name || ':' || class.relname || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_class class
    cross join unnest(array['USAGE','SELECT','UPDATE']) privilege
    where class.relnamespace = 'cron'::regnamespace
      and class.relkind = 'S'
      and has_sequence_privilege(role_name, class.oid, privilege)$$,
  'application roles have no direct or inherited cron sequence privileges'
);

-- PUBLIC is a pseudo-role and cannot be selected with SET ROLE. A role with no
-- memberships is the behavioral probe for grants inherited only from PUBLIC.
create role axsys_public_cron_probe nologin;
grant axsys_public_cron_probe to postgres;
grant axsys_bff to postgres;

-- These grants exist only inside this rolled-back pgTAP transaction and let the
-- five low-privilege probes call throws_ok without widening application access.
grant usage on schema extensions to public;
grant execute on function
  extensions.throws_ok(text, character, text, text),
  extensions._query(text),
  extensions.ok(boolean, text),
  extensions.diag(text),
  extensions._todo(),
  extensions._get(text),
  extensions._get_latest(text),
  extensions._get_note(integer),
  extensions._set(text, integer, text),
  extensions._set(text, integer),
  extensions._set(integer, integer),
  extensions._add(text, integer, text),
  extensions.add_result(boolean, boolean, text, text, text)
to public;

set local role axsys_public_cron_probe;
select extensions.throws_ok(
  $$select count(*) from cron.job$$,
  '42501', null, 'PUBLIC-only probe cannot read cron tables'
);
select extensions.throws_ok(
  $$select cron.unschedule((-9223372036854775807)::bigint)$$,
  '42501', null, 'PUBLIC-only probe cannot execute cron functions'
);
reset role;

set local role anon;
select extensions.throws_ok(
  $$select count(*) from cron.job$$,
  '42501', null, 'anon cannot read cron tables'
);
select extensions.throws_ok(
  $$select cron.unschedule((-9223372036854775807)::bigint)$$,
  '42501', null, 'anon cannot execute cron functions'
);
reset role;

set local role authenticated;
select extensions.throws_ok(
  $$select count(*) from cron.job$$,
  '42501', null, 'authenticated cannot read cron tables'
);
select extensions.throws_ok(
  $$select cron.unschedule((-9223372036854775807)::bigint)$$,
  '42501', null, 'authenticated cannot execute cron functions'
);
reset role;

set local role service_role;
select extensions.throws_ok(
  $$select count(*) from cron.job$$,
  '42501', null, 'service_role cannot read cron tables'
);
select extensions.throws_ok(
  $$select cron.unschedule((-9223372036854775807)::bigint)$$,
  '42501', null, 'service_role cannot execute cron functions'
);
reset role;

set local role axsys_bff;
select extensions.throws_ok(
  $$select count(*) from cron.job$$,
  '42501', null, 'axsys_bff cannot read cron tables'
);
select extensions.throws_ok(
  $$select cron.unschedule((-9223372036854775807)::bigint)$$,
  '42501', null, 'axsys_bff cannot execute cron functions'
);
reset role;

select results_eq(
  $$select id::text collate "default", name::text collate "default", public,
           file_size_limit,
           array_to_string(allowed_mime_types, ',')::text collate "default"
    from storage.buckets
    where id in ('axsys-quarantine','axsys-private')
    order by id$$,
  $$values
    ('axsys-private','axsys-private',false,26214400::bigint,'image/png,image/jpeg,image/webp,application/pdf,application/xml,text/xml,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ('axsys-quarantine','axsys-quarantine',false,26214400::bigint,'image/png,image/jpeg,image/webp,application/pdf,application/xml,text/xml,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document')$$,
  'storage buckets are private with exact size and MIME allowlists'
);

select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'$$,
  'storage.objects remains without broad SQL policies'
);

select results_eq(
  $$select class.relname::text collate "default",
           index.indisunique,
           coalesce(pg_get_expr(index.indpred, index.indrelid), '')::text collate "default",
           array_to_string(array(
             select attribute.attname
             from unnest(index.indkey) with ordinality key(attnum, ordinality)
             join pg_attribute attribute
               on attribute.attrelid = index.indrelid and attribute.attnum = key.attnum
             order by key.ordinality
           ), ',')::text collate "default"
    from pg_index index
    join pg_class class on class.oid = index.indexrelid
    where class.relname in (
      'company_bank_accounts_one_active_default_idx',
      'file_objects_company_purpose_status_idx',
      'file_upload_intents_expiry_idx',
      'provisioning_operations_reconcile_idx'
    )
    order by class.relname$$,
  $$values
    ('company_bank_accounts_one_active_default_idx',true,'((status = ''active''::bank_account_status) AND is_default)','company_id'),
    ('file_objects_company_purpose_status_idx',false,'','company_id,purpose,status'),
    ('file_upload_intents_expiry_idx',false,'(authorization_retired_at IS NULL)','cleanup_not_before'),
    ('provisioning_operations_reconcile_idx',false,'(status = ANY (ARRAY[''reserved''::provisioning_status, ''auth_created''::provisioning_status, ''compensation_required''::provisioning_status]))','status,updated_at')$$,
  'critical indexes freeze uniqueness, predicates and key order'
);

select is_empty(
  $$select namespace.nspname || '.' || class.relname || ':' || constraint_row.conname
    from pg_constraint constraint_row
    join pg_class class on class.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where constraint_row.contype = 'f'
      and (namespace.nspname, class.relname) in (
        ('private','company_storage_usage'),
        ('public','profiles'),('public','file_objects'),('public','file_upload_intents'),
        ('public','company_bank_accounts'),('public','company_settings'),
        ('public','company_settings_drafts'),('public','provisioning_operations')
      )
      and not exists (
        select 1 from pg_index candidate_index
        where candidate_index.indrelid = constraint_row.conrelid
          and candidate_index.indisvalid and candidate_index.indisready
          and constraint_row.conkey = (
            select array_agg(key.attnum order by key.ordinality)::smallint[]
            from unnest(candidate_index.indkey) with ordinality key(attnum, ordinality)
            where key.ordinality <= cardinality(constraint_row.conkey)
          )
      )$$,
  'every schema foreign key has a compatible prefix index'
);

select results_eq(
  $$select string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where table_schema = 'public' and table_name = 'provisioning_operations'$$,
  $$values ('id,idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,auth_user_id,status,last_error_code,correlation_id,created_at,updated_at')$$,
  'provisioning journal stores only identifiers, hashes, state and timestamps'
);

select is_empty(
  $$select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'provisioning_operations'
      and column_name <> 'subject_email_hash'
      and column_name ~ '(password|payload|body|cnpj|cpf|document|account|branch|full_name|email)'$$,
  'provisioning journal has no raw PII or payload columns'
);

select results_eq(
  $$select private.is_canonical_base64('c2VjcmV0', null),
           private.is_canonical_base64('AAAAAAAAAAAAAAAA', 12),
           private.is_canonical_base64('AAAAAAAAAAAAAAAAAAAAAA==', 16),
           private.is_canonical_base64('', null),
           private.is_canonical_base64('plain', null),
           private.is_canonical_base64('YQ', null),
           private.is_canonical_base64('YQ==', null),
           private.is_canonical_base64(repeat('YWFh', 20), 60),
           private.is_canonical_base64(repeat('YWFh', 19) || E'\n' || 'YWFh', 60)$$,
  $$values (true,true,true,false,false,false,true,true,false)$$,
  'base64 validator accepts canonical long values but rejects whitespace in input'
);

select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,correlation_id)
    values ('admin-a@example.com',repeat('a',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('b',64),'91000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,correlation_id)
    values (repeat('A',64),repeat('a',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('b',64),'91000000-0000-4000-8000-000000000006')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,correlation_id)
    values ('12345678000190',repeat('a',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('b',64),'91000000-0000-4000-8000-000000000002')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
     last_error_code,correlation_id)
    values (repeat('a',64),repeat('b',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('c',64),repeat('A',65),
      '91000000-0000-4000-8000-000000000007')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
     last_error_code,correlation_id)
    values (repeat('a',64),repeat('b',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('c',64),'Auth failed: admin-a@example.com',
      '91000000-0000-4000-8000-000000000003')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
     last_error_code,correlation_id)
    values (repeat('a',64),repeat('b',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('c',64),'lowercase_error',
      '91000000-0000-4000-8000-000000000004')$$,
  '23514'
);
select throws_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
     last_error_code,correlation_id)
    values (repeat('6',64),repeat('b',64),'company_member',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      repeat('c',64),'GABRIEL_MACHADO_CPF_12345678901',
      '91000000-0000-4000-8000-000000000009')$$,
  '23514', null,
  'regex-shaped PII is rejected because journal error codes use a closed allowlist'
);
select lives_ok(
  $$insert into public.provisioning_operations
    (idempotency_key,request_hash,kind,actor_user_id,company_id,subject_email_hash,
     last_error_code,correlation_id)
    values
      (repeat('0',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'AUTH_CREATE_FAILED','91000000-0000-4000-8000-000000000005'),
      (repeat('1',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'DB_COMMIT_FAILED','91000000-0000-4000-8000-000000000010'),
      (repeat('2',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'AUTH_DELETE_FAILED','91000000-0000-4000-8000-000000000011'),
      (repeat('3',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'AUTH_BAN_FAILED','91000000-0000-4000-8000-000000000012'),
      (repeat('4',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'AUTH_LOOKUP_FAILED','91000000-0000-4000-8000-000000000013'),
      (repeat('5',64),repeat('a',64),'company_member',
       '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
       repeat('f',64),'RECONCILIATION_FAILED','91000000-0000-4000-8000-000000000014')$$,
  'all six allowlisted saga error codes are accepted with hashed identifiers'
);

select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','plain',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,
     holder_document_ciphertext,holder_document_iv,holder_document_tag,
     holder_document_key_version,holder_document_last4,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      'c2VjcmV0','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'ABCD',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'aXY=','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','dGFn',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',0,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'AB','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'12345','checking','Titular',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,
     holder_document_ciphertext,holder_document_iv,holder_document_tag,
     holder_document_key_version,holder_document_last4,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      'c2VjcmV0','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'12345678901',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,
     holder_document_ciphertext,holder_document_iv,holder_document_tag,
     holder_document_key_version,holder_document_last4,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'0001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      'c2VjcmV0','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',0,'1234',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_settings
    (company_id,representative_document_ciphertext,representative_document_iv,
     representative_document_tag,representative_document_key_version,
     representative_document_last4,updated_by)
    values ('30000000-0000-4000-8000-000000000001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'12345678901',
      '20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_settings
    (company_id,representative_document_ciphertext,representative_document_iv,
     representative_document_tag,representative_document_key_version,
     representative_document_last4,updated_by)
    values ('30000000-0000-4000-8000-000000000001','c2VjcmV0','aXY=',
      'AAAAAAAAAAAAAAAAAAAAAA==',1,'1234',
      '20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_settings
    (company_id,representative_document_ciphertext,representative_document_iv,
     representative_document_tag,representative_document_key_version,
     representative_document_last4,updated_by)
    values ('30000000-0000-4000-8000-000000000001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',0,'1234',
      '20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select lives_ok(
  $$insert into public.company_bank_accounts
    (company_id,bank_code,bank_name,branch_ciphertext,branch_iv,branch_tag,
     branch_key_version,branch_last4,account_ciphertext,account_iv,account_tag,
     account_key_version,account_last4,account_type,holder_name,
     holder_document_ciphertext,holder_document_iv,holder_document_tag,
     holder_document_key_version,holder_document_last4,created_by,updated_by)
    values ('30000000-0000-4000-8000-000000000001','001','Banco','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234','checking','Titular',
      'c2VjcmV0','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'5678',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
  'canonical encrypted bank envelopes are accepted'
);
select lives_ok(
  $$insert into public.company_settings
    (company_id,representative_document_ciphertext,representative_document_iv,
     representative_document_tag,representative_document_key_version,
     representative_document_last4,updated_by)
    values ('30000000-0000-4000-8000-000000000001','c2VjcmV0',
      'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'1234',
      '20000000-0000-4000-8000-000000000001')$$,
  'canonical encrypted representative envelope is accepted'
);

select throws_ok(
  $$insert into public.file_objects
    (company_id,purpose,bucket,object_path,original_name,detected_mime,byte_size,
     sha256,scan_status,status,created_by,retirement_claim_id)
    values ('30000000-0000-4000-8000-000000000001','company_letterhead','axsys-private',
      'company-a/claim-id-only','letterhead.webp','image/webp',1,repeat('a',64),
      'failed','rejected','20000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.file_objects
    (company_id,purpose,bucket,object_path,original_name,detected_mime,byte_size,
     sha256,scan_status,status,created_by,retirement_claimed_at)
    values ('30000000-0000-4000-8000-000000000001','company_letterhead','axsys-private',
      'company-a/claim-time-only','letterhead.webp','image/webp',1,repeat('b',64),
      'failed','rejected','20000000-0000-4000-8000-000000000001',clock_timestamp())$$,
  '23514'
);
select throws_ok(
  $$insert into public.file_upload_intents
    (company_id,actor_user_id,purpose,quarantine_object_path,declared_name,
     declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at,
     upload_authorization_expires_at,cleanup_not_before,authorization_cleanup_claim_id)
    values ('30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','profile_avatar',
      'company-a/user-a/intent-claim-id','avatar.webp','image/webp',100,'issued',200,
      clock_timestamp(),clock_timestamp()+interval '2 hours',
      clock_timestamp()+interval '26 hours 15 minutes',
      '92000000-0000-4000-8000-000000000002')$$,
  '23514'
);
select throws_ok(
  $$insert into public.file_upload_intents
    (company_id,actor_user_id,purpose,quarantine_object_path,declared_name,
     declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at,
     upload_authorization_expires_at,cleanup_not_before)
    values ('30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','profile_avatar',
      'company-a/user-a/intent-expiry-short','avatar.webp','image/webp',100,'issued',200,
      clock_timestamp(),clock_timestamp()+interval '1 hour',
      clock_timestamp()+interval '25 hours 15 minutes')$$,
  '23514'
);
select throws_ok(
  $$insert into public.file_upload_intents
    (company_id,actor_user_id,purpose,quarantine_object_path,declared_name,
     declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at,
     upload_authorization_expires_at,cleanup_not_before)
    values ('30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','profile_avatar',
      'company-a/user-a/intent-cleanup-early','avatar.webp','image/webp',100,'issued',200,
      clock_timestamp(),clock_timestamp()+interval '2 hours',
      clock_timestamp()+interval '26 hours')$$,
  '23514'
);
select throws_ok(
  $$insert into public.file_upload_intents
    (company_id,actor_user_id,purpose,quarantine_object_path,declared_name,
     declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at)
    values ('30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','profile_avatar',
      'company-a/user-a/intent-reserved-issued','avatar.webp','image/webp',100,'reserved',200,
      clock_timestamp())$$,
  '23514'
);
select lives_ok(
  $$insert into public.file_upload_intents
    (company_id,actor_user_id,purpose,quarantine_object_path,declared_name,
     declared_mime,declared_size,status,quota_hold_bytes,authorization_issued_at,
     upload_authorization_expires_at,cleanup_not_before)
    values ('30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','profile_avatar',
      'company-a/user-a/intent-valid','avatar.webp','image/webp',100,'issued',200,
      statement_timestamp(),statement_timestamp()+interval '2 hours',
      statement_timestamp()+interval '26 hours 15 minutes')$$,
  'valid issued capability deadlines are accepted'
);

select * from finish();
rollback;
