begin;
\ir helpers/fixtures.inc

select no_plan();

select has_table('private'::name, 'download_attempts'::name);
select has_table('private'::name, 'download_execution_context'::name);

select results_eq(
  $$select table_name::text collate "default",
           column_name::text collate "default",
           data_type::text collate "default",
           is_nullable::text collate "default"
    from information_schema.columns
    where table_schema = 'private'
      and table_name in ('download_attempts', 'download_execution_context')
    order by table_name, ordinal_position$$,
  $$values
    ('download_attempts','id','uuid','NO'),
    ('download_attempts','nonce_hash','text','YES'),
    ('download_attempts','nonce_consumed_at','timestamp with time zone','YES'),
    ('download_attempts','actor_user_id','uuid','YES'),
    ('download_attempts','session_id','uuid','YES'),
    ('download_attempts','company_id','uuid','NO'),
    ('download_attempts','resource_kind','text','NO'),
    ('download_attempts','resource_id','uuid','NO'),
    ('download_attempts','correlation_id','uuid','NO'),
    ('download_attempts','started_at','timestamp with time zone','NO'),
    ('download_attempts','completed_at','timestamp with time zone','YES'),
    ('download_attempts','outcome','text','YES'),
    ('download_attempts','byte_class','text','YES'),
    ('download_execution_context','transaction_id','bigint','NO'),
    ('download_execution_context','backend_pid','integer','NO'),
    ('download_execution_context','operation_kind','text','NO'),
    ('download_execution_context','attempt_id','uuid','NO')$$,
  'download audit tables expose only the frozen private columns'
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
    where namespace.nspname = 'private'
      and class.relname in ('download_attempts','download_execution_context')
    order by class.relname$$,
  $$values
    ('private','download_attempts','postgres',true,true),
    ('private','download_execution_context','postgres',true,true)$$,
  'private download tables are postgres-owned with forced RLS'
);

select is_empty(
  $$select role_name || ':' || class.relname || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where namespace.nspname = 'private'
      and class.relname in ('download_attempts','download_execution_context')
      and has_table_privilege(role_name, class.oid, privilege)$$,
  'no application role has effective access to download audit tables'
);

select results_eq(
  $$select candidate_constraint.conname::text collate "default",
           pg_get_constraintdef(candidate_constraint.oid, true)::text collate "default"
    from pg_constraint candidate_constraint
    where candidate_constraint.conrelid in (
      'private.download_attempts'::regclass,
      'private.download_execution_context'::regclass
    )
    order by candidate_constraint.conname$$,
  $$values
    ('download_attempts_actor_session_pair',
      'CHECK ((actor_user_id IS NULL) = (session_id IS NULL))'),
    ('download_attempts_byte_class_vocabulary',
      'CHECK (byte_class IS NULL OR (byte_class = ANY (ARRAY[''empty''::text, ''under_1_mib''::text, ''under_10_mib''::text, ''at_least_10_mib''::text, ''unknown''::text])))'),
    ('download_attempts_company_id_fkey',
      'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('download_attempts_lifecycle',
      'CHECK (outcome IS NULL AND completed_at IS NULL AND nonce_consumed_at IS NULL AND nonce_hash IS NOT NULL AND byte_class IS NULL OR outcome IS NOT NULL AND completed_at IS NOT NULL AND nonce_consumed_at IS NOT NULL AND nonce_hash IS NULL AND byte_class IS NOT NULL AND completed_at >= started_at)'),
    ('download_attempts_nonce_hash_format',
      'CHECK (nonce_hash IS NULL OR nonce_hash ~ ''^[0-9a-f]{64}$''::text)'),
    ('download_attempts_outcome_vocabulary',
      'CHECK (outcome IS NULL OR (outcome = ANY (ARRAY[''completed''::text, ''aborted''::text, ''integrity_failed''::text, ''stream_failed''::text, ''abandoned''::text])))'),
    ('download_attempts_pkey','PRIMARY KEY (id)'),
    ('download_attempts_resource_kind_vocabulary',
      'CHECK (resource_kind = ANY (ARRAY[''file''::text, ''contract''::text, ''certificate''::text, ''payment''::text, ''proposal''::text, ''generated_document''::text]))'),
    ('download_execution_context_attempt_id_fkey',
      'FOREIGN KEY (attempt_id) REFERENCES private.download_attempts(id) ON DELETE CASCADE'),
    ('download_execution_context_operation_kind_vocabulary',
      'CHECK (operation_kind = ANY (ARRAY[''download_completion''::text, ''download_stale''::text]))'),
    ('download_execution_context_pkey',
      'PRIMARY KEY (transaction_id, backend_pid, operation_kind, attempt_id)')$$,
  'download attempts and execution context constraints are closed and exact'
);

select results_eq(
  $$select class.relname::text collate "default",
           pg_get_indexdef(index.indexrelid)::text collate "default"
    from pg_index index
    join pg_class class on class.oid = index.indexrelid
    where index.indrelid = 'private.download_attempts'::regclass
      and class.relname in (
        'download_attempts_nonce_hash_key',
        'download_attempts_pending_idx',
        'download_attempts_retention_idx'
      )
    order by class.relname$$,
  $$values
    ('download_attempts_nonce_hash_key',
      'CREATE UNIQUE INDEX download_attempts_nonce_hash_key ON private.download_attempts USING btree (nonce_hash) WHERE (nonce_hash IS NOT NULL)'),
    ('download_attempts_pending_idx',
      'CREATE INDEX download_attempts_pending_idx ON private.download_attempts USING btree (started_at, id) WHERE (completed_at IS NULL)'),
    ('download_attempts_retention_idx',
      'CREATE INDEX download_attempts_retention_idx ON private.download_attempts USING btree (completed_at, id) WHERE (completed_at IS NOT NULL)')$$,
  'download sweeper and retention paths have matching partial indexes'
);

select results_eq(
  $$select attribute.attnotnull,
           pg_get_constraintdef(actor_constraint.oid, true)::text collate "default"
    from pg_attribute attribute
    join pg_constraint actor_constraint
      on actor_constraint.conrelid = attribute.attrelid
     and actor_constraint.conname = 'audit_events_actor_presence'
    where attribute.attrelid = 'public.audit_events'::regclass
      and attribute.attname = 'actor_user_id'$$,
  $$values (false,
    'CHECK (actor_user_id IS NOT NULL OR action = ''file.download''::text AND (metadata ->> ''accessKind''::text) = ''public''::text)')$$,
  'audit events allow a null actor only for guarded public downloads'
);

select has_function(
  'private'::name,
  'begin_download_audit_core'::name,
  array['uuid','uuid','uuid','text','uuid','uuid']
);
select has_function(
  'private'::name,
  'authorize_image_file_download'::name,
  array['uuid','uuid','uuid','uuid']
);
select has_function(
  'private'::name,
  'complete_download_audit'::name,
  array['uuid','text','text','text']
);
select has_function('private'::name, 'finalize_stale_download_attempts'::name);
select has_function('private'::name, 'purge_expired_download_attempts'::name);
select has_function(
  'private'::name,
  'emit_download_audit_event_core'::name,
  array['uuid','text']
);
select has_function('private'::name, 'guard_download_audit_event_insert'::name);

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
        'authorize_image_file_download',
        'begin_download_audit_core',
        'complete_download_audit',
        'emit_download_audit_event_core',
        'finalize_stale_download_attempts',
        'guard_download_audit_event_insert',
        'purge_expired_download_attempts'
      )
    order by function.proname$$,
  $$values
    ('authorize_image_file_download',
      'p_actor_user_id uuid, p_session_id uuid, p_file_id uuid, p_correlation_id uuid',
      'TABLE(file_id uuid, company_id uuid, purpose text, owner_user_id uuid, bucket text, object_path text, mime_type text, byte_size bigint, sha256 text, original_name text, attempt_id uuid, completion_nonce text)',
      'postgres',true,true),
    ('begin_download_audit_core',
      'p_actor_user_id uuid, p_session_id uuid, p_company_id uuid, p_resource_kind text, p_resource_id uuid, p_correlation_id uuid',
      'TABLE(attempt_id uuid, completion_nonce text)',
      'postgres',true,true),
    ('complete_download_audit',
      'p_attempt_id uuid, p_completion_nonce text, p_outcome text, p_byte_class text',
      'void','postgres',true,true),
    ('emit_download_audit_event_core',
      'p_attempt_id uuid, p_operation_kind text',
      'void','postgres',true,true),
    ('finalize_stale_download_attempts','','integer','postgres',true,true),
    ('guard_download_audit_event_insert','','trigger','postgres',false,true),
    ('purge_expired_download_attempts','','integer','postgres',true,true)$$,
  'download routines freeze signatures, results, owners and search paths'
);

select results_eq(
  $$select function.proname::text collate "default",
           position('FOR UPDATE SKIP LOCKED' in upper(pg_get_functiondef(function.oid))) > 0
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'finalize_stale_download_attempts',
        'purge_expired_download_attempts'
      )
    order by function.proname$$,
  $$values
    ('finalize_stale_download_attempts',true),
    ('purge_expired_download_attempts',true)$$,
  'stale and retention workers use non-blocking claims'
);

select results_eq(
  $$select position(
       'extensions.gen_random_bytes(32)'
       in pg_get_functiondef(function.oid)
     ) > 0
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'begin_download_audit_core'$$,
  $$values (true)$$,
  'download capabilities are sourced from thirty-two CSPRNG bytes'
);

select results_eq(
  $$select position(
       'file_object.status = ''ready''::public.file_status'
       in pg_get_functiondef(function.oid)
     ) > 0,
     position(
       'file_object.scan_status = ''clean''::public.file_scan_status'
       in pg_get_functiondef(function.oid)
     ) > 0,
     position(
       'file_object.purpose in ('
       in pg_get_functiondef(function.oid)
     ) > 0
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'authorize_image_file_download'$$,
  $$values (true,true,true)$$,
  'image authorizer independently freezes ready, clean and purpose checks'
);

select results_eq(
  $$select function.proname::text collate "default",
           position(
             '<= PG_CATALOG.CLOCK_TIMESTAMP()'
             in upper(pg_get_functiondef(function.oid))
           ) = 0,
           position(
             '< PG_CATALOG.CLOCK_TIMESTAMP()'
             in upper(pg_get_functiondef(function.oid))
           ) > 0
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'finalize_stale_download_attempts',
        'purge_expired_download_attempts'
      )
    order by function.proname$$,
  $$values
    ('finalize_stale_download_attempts',true,true),
    ('purge_expired_download_attempts',true,true)$$,
  'stale and retention workers use strict older-than boundaries'
);

select results_eq(
  $$select trigger.tgname::text collate "default",
           trigger.tgenabled::text collate "default",
           pg_get_triggerdef(trigger.oid, false)::text collate "default"
    from pg_trigger trigger
    where trigger.tgrelid = 'public.audit_events'::regclass
      and trigger.tgname = 'audit_events_guard_download_insert'
      and not trigger.tgisinternal$$,
  $$values (
    'audit_events_guard_download_insert','O',
    'CREATE TRIGGER audit_events_guard_download_insert BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION private.guard_download_audit_event_insert()'
  )$$,
  'download audit rows are guarded by an enabled row trigger'
);

select results_eq(
  $$select bucket, attempt_limit, window_seconds, block_seconds, clear_on_success
    from private.rate_limit_policies where bucket = 'file-download-user'$$,
  $$values ('file-download-user',60,60,60,false)$$,
  'file download rate policy is fixed at sixty attempts per minute per user'
);

select results_eq(
  $$select jobname::text collate "default",
           schedule::text collate "default",
           command::text collate "default",
           database::text collate "default",
           username::text collate "default",
           active
    from cron.job
    where jobname in (
      'axsys-download-attempt-stale-finalizer',
      'axsys-download-attempt-retention'
    )
    order by jobname$$,
  $$values
    ('axsys-download-attempt-retention','17 3 * * *',
      'select private.purge_expired_download_attempts();',current_database()::text collate "default",'postgres',true),
    ('axsys-download-attempt-stale-finalizer','*/5 * * * *',
      'select private.finalize_stale_download_attempts();',current_database()::text collate "default",'postgres',true)$$,
  'pg_cron owns separate five-minute stale and daily retention jobs'
);

select ok(
  has_function_privilege(
    'axsys_bff',
    'private.authorize_image_file_download(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'axsys_bff',
    'private.complete_download_audit(uuid,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.authorize_image_file_download(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.complete_download_audit(uuid,text,text,text)',
    'EXECUTE'
  ),
  'only BFF receives the two application download boundaries'
);
select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'begin_download_audit_core',
        'emit_download_audit_event_core',
        'finalize_stale_download_attempts',
        'guard_download_audit_event_insert',
        'purge_expired_download_attempts'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'download core, emitter, guard, stale and retention remain owner-only'
);

create function test_helpers.activate_download_session(
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
  '25000000-0000-4000-8000-000000000001',
  'download-admin-a@example.test',
  '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '25000000-0000-4000-8000-000000000002',
  'download-owner-a@example.test',
  '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000002',
  'member',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '25000000-0000-4000-8000-000000000003',
  'download-member-a@example.test',
  '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000003',
  'member',
  '{}'::public.module_key[]
);
select test_helpers.create_company_user(
  '25000000-0000-4000-8000-000000000004',
  'download-member-b@example.test',
  '35000000-0000-4000-8000-000000000002',
  '45000000-0000-4000-8000-000000000004',
  'member',
  '{}'::public.module_key[]
);

select test_helpers.activate_download_session(
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001'
);
select test_helpers.activate_download_session(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000002'
);
select test_helpers.activate_download_session(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '85000000-0000-4000-8000-000000000003'
);
select test_helpers.activate_download_session(
  '25000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000004',
  '85000000-0000-4000-8000-000000000004'
);

insert into public.file_objects (
  id, company_id, owner_user_id, purpose, bucket, object_path, original_name,
  detected_mime, byte_size, sha256, scan_status, status, created_by,
  created_at, promoted_at
) values
  (
    '65000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000002',
    'profile_avatar','axsys-private',
    '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000001.webp',
    'owner-avatar.png','image/webp',700,repeat('a',64),'clean','ready',
    '25000000-0000-4000-8000-000000000002',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000002',
    '35000000-0000-4000-8000-000000000001',null,
    'company_letterhead','axsys-private',
    '35000000-0000-4000-8000-000000000001/company_letterhead/65000000-0000-4000-8000-000000000002.webp',
    'letterhead.png','image/webp',800,repeat('b',64),'clean','ready',
    '25000000-0000-4000-8000-000000000001',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000003',
    '35000000-0000-4000-8000-000000000001',null,
    'company_signature','axsys-private',
    '35000000-0000-4000-8000-000000000001/company_signature/65000000-0000-4000-8000-000000000003.webp',
    'signature.png','image/webp',900,repeat('c',64),'clean','ready',
    '25000000-0000-4000-8000-000000000001',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000004',
    'profile_avatar','axsys-private',
    '35000000-0000-4000-8000-000000000002/profile_avatar/65000000-0000-4000-8000-000000000004.webp',
    'tenant-b.png','image/webp',700,repeat('d',64),'clean','ready',
    '25000000-0000-4000-8000-000000000004',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000005',
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000002',
    'profile_avatar','axsys-private',
    '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000005.webp',
    'rejected.png','image/webp',700,repeat('e',64),'infected','rejected',
    '25000000-0000-4000-8000-000000000002',statement_timestamp(),null
  ),
  (
    '65000000-0000-4000-8000-000000000006',
    '35000000-0000-4000-8000-000000000001',null,
    'certificate','axsys-private',
    '35000000-0000-4000-8000-000000000001/certificate/65000000-0000-4000-8000-000000000006.pdf',
    'certificate.pdf','application/pdf',1000,repeat('f',64),'clean','ready',
    '25000000-0000-4000-8000-000000000001',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000007',
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000002',
    'profile_avatar','axsys-private',
    '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000007.webp',
    'status-only.png','image/webp',700,repeat('1',64),'clean','rejected',
    '25000000-0000-4000-8000-000000000002',statement_timestamp(),null
  ),
  (
    '65000000-0000-4000-8000-000000000008',
    '35000000-0000-4000-8000-000000000001',null,
    'certificate','axsys-private',
    '35000000-0000-4000-8000-000000000001/certificate/65000000-0000-4000-8000-000000000008.webp',
    'purpose-only.png','image/webp',1000,repeat('2',64),'clean','ready',
    '25000000-0000-4000-8000-000000000001',statement_timestamp(),statement_timestamp()
  ),
  (
    '65000000-0000-4000-8000-000000000009',
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000002',
    'profile_avatar','axsys-private',
    '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000009.webp',
    'mime-only.png','image/png',700,repeat('3',64),'clean','ready',
    '25000000-0000-4000-8000-000000000002',statement_timestamp(),statement_timestamp()
  );

create temporary table download_authorizations (
  label text primary key,
  file_id uuid not null,
  company_id uuid not null,
  purpose text not null,
  owner_user_id uuid,
  bucket text not null,
  object_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text not null,
  original_name text not null,
  attempt_id uuid not null,
  completion_nonce text not null
);
create temporary table public_download_tokens (
  attempt_id uuid not null,
  completion_nonce text not null
);
grant select, insert on download_authorizations, public_download_tokens to axsys_bff;
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

set local role axsys_bff;
insert into download_authorizations
select 'own-avatar', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001'
) authorized_download;
insert into download_authorizations
select 'branding', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000002',
  '86000000-0000-4000-8000-000000000002'
) authorized_download;
insert into download_authorizations
select 'admin-avatar', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000003'
) authorized_download;
insert into download_authorizations
select 'stream-failure', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000003',
  '86000000-0000-4000-8000-000000000004'
) authorized_download;
insert into download_authorizations
select 'stale', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000002',
  '86000000-0000-4000-8000-000000000005'
) authorized_download;
insert into download_authorizations
select 'fresh', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000003',
  '86000000-0000-4000-8000-000000000006'
) authorized_download;

insert into download_authorizations
select 'denied-other-avatar', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000001'
) authorized_download;
insert into download_authorizations
select 'denied-cross-tenant', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000004',
  '65000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000002'
) authorized_download;
insert into download_authorizations
select 'denied-rejected', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000005',
  '87000000-0000-4000-8000-000000000003'
) authorized_download;
insert into download_authorizations
select 'denied-purpose', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000006',
  '87000000-0000-4000-8000-000000000004'
) authorized_download;
insert into download_authorizations
select 'denied-session', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000099',
  '65000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000005'
) authorized_download;
insert into download_authorizations
select 'denied-status-only', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000007',
  '87000000-0000-4000-8000-000000000006'
) authorized_download;
insert into download_authorizations
select 'denied-purpose-only', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000008',
  '87000000-0000-4000-8000-000000000007'
) authorized_download;
insert into download_authorizations
select 'denied-mime-only', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000009',
  '87000000-0000-4000-8000-000000000008'
) authorized_download;
reset role;

update public.company_memberships
set status = 'suspended',
    suspended_at = pg_catalog.clock_timestamp(),
    suspended_by = '25000000-0000-4000-8000-000000000003',
    suspension_reason = 'Download authorization isolation test'
where id = '45000000-0000-4000-8000-000000000003';
set local role axsys_bff;
insert into download_authorizations
select 'denied-membership-inactive', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000003',
  '65000000-0000-4000-8000-000000000002',
  '87000000-0000-4000-8000-000000000009'
) authorized_download;
reset role;

update public.profiles
set is_active = false
where user_id = '25000000-0000-4000-8000-000000000002';
set local role axsys_bff;
insert into download_authorizations
select 'denied-profile-inactive', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  '65000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000010'
) authorized_download;
reset role;

update public.profiles
set must_change_password = true,
    temporary_password_expires_at = pg_catalog.clock_timestamp()
      + interval '30 minutes'
where user_id = '25000000-0000-4000-8000-000000000001';
set local role axsys_bff;
insert into download_authorizations
select 'denied-password-change', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000011'
) authorized_download;
reset role;

update public.companies
set status = 'archived',
    archived_at = pg_catalog.clock_timestamp(),
    archived_by = '25000000-0000-4000-8000-000000000004'
where id = '35000000-0000-4000-8000-000000000002';
set local role axsys_bff;
insert into download_authorizations
select 'denied-company-inactive', authorized_download.*
from private.authorize_image_file_download(
  '25000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000004',
  '65000000-0000-4000-8000-000000000004',
  '87000000-0000-4000-8000-000000000012'
) authorized_download;
reset role;

select results_eq(
  $$select label, file_id, company_id, purpose, owner_user_id, bucket,
           object_path, mime_type, byte_size, sha256, original_name,
           length(completion_nonce), completion_nonce ~ '^[A-Za-z0-9_-]{43}$',
           pg_catalog.octet_length(
             pg_catalog.decode(
               pg_catalog.translate(completion_nonce, '-_', '+/') || '=',
               'base64'
             )
           ) = 32
    from download_authorizations
    where label in ('own-avatar','branding','admin-avatar')
    order by label$$,
  $$values
    ('admin-avatar','65000000-0000-4000-8000-000000000001'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,'profile_avatar',
      '25000000-0000-4000-8000-000000000002'::uuid,'axsys-private',
      '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000001.webp',
      'image/webp',700::bigint,repeat('a',64),'owner-avatar.png',43,true,true),
    ('branding','65000000-0000-4000-8000-000000000002'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,'company_letterhead',
      null::uuid,'axsys-private',
      '35000000-0000-4000-8000-000000000001/company_letterhead/65000000-0000-4000-8000-000000000002.webp',
      'image/webp',800::bigint,repeat('b',64),'letterhead.png',43,true,true),
    ('own-avatar','65000000-0000-4000-8000-000000000001'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,'profile_avatar',
      '25000000-0000-4000-8000-000000000002'::uuid,'axsys-private',
      '35000000-0000-4000-8000-000000000001/profile_avatar/65000000-0000-4000-8000-000000000001.webp',
      'image/webp',700::bigint,repeat('a',64),'owner-avatar.png',43,true,true)$$,
  'authorizer returns the exact server-only metadata for owner, admin and branding'
);
select is(
  (select count(*) from download_authorizations),
  6::bigint,
  'all denied authorizations return zero rows and create no download capability'
);

select results_eq(
  $$select attempt.actor_user_id, attempt.session_id, attempt.company_id,
           attempt.resource_kind, attempt.resource_id, attempt.correlation_id,
           attempt.outcome, attempt.byte_class,
           attempt.nonce_hash = encode(
             extensions.digest(authz.completion_nonce, 'sha256'),
             'hex'
           ) as hash_matches,
           position(authz.completion_nonce in to_jsonb(attempt)::text) = 0
    from download_authorizations authz
    join private.download_attempts attempt on attempt.id = authz.attempt_id
    where authz.label = 'own-avatar'$$,
  $$values (
    '25000000-0000-4000-8000-000000000002'::uuid,
    '95000000-0000-4000-8000-000000000002'::uuid,
    '35000000-0000-4000-8000-000000000001'::uuid,
    'file','65000000-0000-4000-8000-000000000001'::uuid,
    '86000000-0000-4000-8000-000000000001'::uuid,
    null::text,null::text,true,true
  )$$,
  'only the SHA-256 nonce hash is persisted with derived attempt identity'
);

select results_eq(
  $$select correlation_id, event_type, user_id, email_hash, ip_hash,
           outcome::text, reason_code, metadata
    from public.security_events
    where correlation_id in (
      '87000000-0000-4000-8000-000000000001',
      '87000000-0000-4000-8000-000000000002',
      '87000000-0000-4000-8000-000000000003',
      '87000000-0000-4000-8000-000000000004',
      '87000000-0000-4000-8000-000000000005',
      '87000000-0000-4000-8000-000000000006',
      '87000000-0000-4000-8000-000000000007',
      '87000000-0000-4000-8000-000000000008',
      '87000000-0000-4000-8000-000000000009',
      '87000000-0000-4000-8000-000000000010',
      '87000000-0000-4000-8000-000000000011',
      '87000000-0000-4000-8000-000000000012'
    ) order by correlation_id$$,
  $$values
    ('87000000-0000-4000-8000-000000000001'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000002'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000003'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000004'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000005'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000006'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000007'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000008'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000009'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000010'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000011'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb),
    ('87000000-0000-4000-8000-000000000012'::uuid,'file.download.denied',
      null::uuid,null::text,null::text,'denied','FILE_NOT_FOUND','{}'::jsonb)$$,
  'denials persist only neutral correlation and allowlisted reason telemetry'
);
select is_empty(
  $$select event.id
    from public.security_events event
    cross join public.file_objects file
    where event.correlation_id in (
      '87000000-0000-4000-8000-000000000001',
      '87000000-0000-4000-8000-000000000002',
      '87000000-0000-4000-8000-000000000003',
      '87000000-0000-4000-8000-000000000004',
      '87000000-0000-4000-8000-000000000005',
      '87000000-0000-4000-8000-000000000006',
      '87000000-0000-4000-8000-000000000007',
      '87000000-0000-4000-8000-000000000008',
      '87000000-0000-4000-8000-000000000009',
      '87000000-0000-4000-8000-000000000010',
      '87000000-0000-4000-8000-000000000011',
      '87000000-0000-4000-8000-000000000012'
    )
      and event::text like '%' || file.id::text || '%'$$,
  'denied telemetry contains no file identifiers'
);

select private.revoke_auth_sessions(
  '25000000-0000-4000-8000-000000000002',
  null
);

set local role axsys_bff;
select private.complete_download_audit(
  (select attempt_id from download_authorizations where label = 'own-avatar'),
  (select completion_nonce from download_authorizations where label = 'own-avatar'),
  'completed',
  'under_1_mib'
);
select private.complete_download_audit(
  (select attempt_id from download_authorizations where label = 'branding'),
  (select completion_nonce from download_authorizations where label = 'branding'),
  'aborted',
  'under_1_mib'
);
select private.complete_download_audit(
  (select attempt_id from download_authorizations where label = 'admin-avatar'),
  (select completion_nonce from download_authorizations where label = 'admin-avatar'),
  'integrity_failed',
  'under_1_mib'
);
select private.complete_download_audit(
  (select attempt_id from download_authorizations where label = 'stream-failure'),
  (select completion_nonce from download_authorizations where label = 'stream-failure'),
  'stream_failed',
  'under_1_mib'
);
select throws_ok(
  $$select private.complete_download_audit(
      (select attempt_id from download_authorizations where label = 'own-avatar'),
      (select completion_nonce from download_authorizations where label = 'own-avatar'),
      'completed',
      'under_1_mib'
    )$$,
  '23514',
  'download_audit_completion_invalid',
  'completion nonce is single-use under replay'
);
select throws_ok(
  $$select private.complete_download_audit(
      (select attempt_id from download_authorizations where label = 'fresh'),
      repeat('x', 43),
      'completed',
      'under_1_mib'
    )$$,
  '23514',
  'download_audit_completion_invalid',
  'forged nonce cannot complete another attempt'
);
select throws_ok(
  $$select private.complete_download_audit(
      (select attempt_id from download_authorizations where label = 'fresh'),
      (select completion_nonce from download_authorizations where label = 'fresh'),
      'UNBOUNDED_OUTCOME',
      'under_1_mib'
    )$$,
  '22023',
  'download_audit_result_invalid',
  'completion outcome uses a closed vocabulary'
);
reset role;

select results_eq(
  $$select authz.label, attempt.outcome, attempt.byte_class,
           attempt.completed_at is not null,
           attempt.nonce_consumed_at is not null,
           attempt.nonce_hash
    from download_authorizations authz
    join private.download_attempts attempt on attempt.id = authz.attempt_id
    where authz.label in (
      'own-avatar','branding','admin-avatar','stream-failure'
    ) order by authz.label$$,
  $$values
    ('admin-avatar','integrity_failed','under_1_mib',true,true,null::text),
    ('branding','aborted','under_1_mib',true,true,null::text),
    ('own-avatar','completed','under_1_mib',true,true,null::text),
    ('stream-failure','stream_failed','under_1_mib',true,true,null::text)$$,
  'completion records each allowlisted terminal result and consumes its hash'
);

select results_eq(
  $$select event.correlation_id, event.actor_user_id, event.company_id,
           event.action, event.resource_type, event.resource_id,
           event.outcome::text, event.reason_code, event.metadata
    from public.audit_events event
    where event.action = 'file.download'
      and event.correlation_id in (
        '86000000-0000-4000-8000-000000000001',
        '86000000-0000-4000-8000-000000000002',
        '86000000-0000-4000-8000-000000000003',
        '86000000-0000-4000-8000-000000000004'
      ) order by event.correlation_id$$,
  $$values
    ('86000000-0000-4000-8000-000000000001'::uuid,
      '25000000-0000-4000-8000-000000000002'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,
      'file.download','file','65000000-0000-4000-8000-000000000001'::uuid,
      'success',null::text,
      '{"accessKind":"authenticated","byteClass":"under_1_mib","downloadOutcome":"completed"}'::jsonb),
    ('86000000-0000-4000-8000-000000000002'::uuid,
      '25000000-0000-4000-8000-000000000003'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,
      'file.download','file','65000000-0000-4000-8000-000000000002'::uuid,
      'failure','DOWNLOAD_ABORTED',
      '{"accessKind":"authenticated","byteClass":"under_1_mib","downloadOutcome":"aborted"}'::jsonb),
    ('86000000-0000-4000-8000-000000000003'::uuid,
      '25000000-0000-4000-8000-000000000001'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,
      'file.download','file','65000000-0000-4000-8000-000000000001'::uuid,
      'failure','DOWNLOAD_INTEGRITY_FAILED',
      '{"accessKind":"authenticated","byteClass":"under_1_mib","downloadOutcome":"integrity_failed"}'::jsonb),
    ('86000000-0000-4000-8000-000000000004'::uuid,
      '25000000-0000-4000-8000-000000000003'::uuid,
      '35000000-0000-4000-8000-000000000001'::uuid,
      'file.download','file','65000000-0000-4000-8000-000000000003'::uuid,
      'failure','DOWNLOAD_STREAM_FAILED',
      '{"accessKind":"authenticated","byteClass":"under_1_mib","downloadOutcome":"stream_failed"}'::jsonb)$$,
  'completion emits one redacted audit row even after the session was revoked'
);
select is_empty(
  $$select event.id
    from public.audit_events event
    join download_authorizations authz
      on authz.attempt_id in (
        select attempt.id from private.download_attempts attempt
        where attempt.correlation_id = event.correlation_id
      )
    where event.action = 'file.download'
      and (
        event.metadata::text like '%' || authz.object_path || '%'
        or event.metadata::text like '%' || authz.original_name || '%'
        or event.metadata::text like '%' || authz.sha256 || '%'
        or event.metadata::text like '%' || authz.completion_nonce || '%'
      )$$,
  'download audit metadata contains no path, name, checksum or nonce'
);
select is(
  (select count(*) from private.download_execution_context),
  0::bigint,
  'completion removes its execution context in the same transaction'
);

select throws_ok(
  $$insert into public.audit_events(
      scope, company_id, actor_user_id, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, metadata
    ) values (
      'tenant','35000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001','file.download','file',
      '65000000-0000-4000-8000-000000000001','success',null,
      '88000000-0000-4000-8000-000000000001',
      '{"accessKind":"authenticated","byteClass":"under_1_mib","downloadOutcome":"completed"}'
    )$$,
  '42501',
  'download_audit_context_invalid',
  'even the owner cannot forge a download audit row without execution context'
);
select throws_ok(
  $$insert into public.audit_events(
      scope, company_id, actor_user_id, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, metadata
    ) values (
      'tenant','35000000-0000-4000-8000-000000000001',null,
      'file.download','file','65000000-0000-4000-8000-000000000002',
      'success',null,'88000000-0000-4000-8000-000000000002',
      '{"accessKind":"public","byteClass":"under_1_mib","downloadOutcome":"completed"}'
    )$$,
  '42501',
  'download_audit_context_invalid',
  'public actor null cannot bypass the download execution context guard'
);
select throws_ok(
  $$select private.emit_download_audit_event_core(
      (select attempt_id from download_authorizations where label = 'fresh'),
      'download_completion'
    )$$,
  '42501',
  'download_audit_context_invalid',
  'owner-only emitter rejects a context-free attempt'
);

insert into private.download_execution_context(
  transaction_id, backend_pid, operation_kind, attempt_id
) values (
  pg_catalog.txid_current() + 1,
  pg_catalog.pg_backend_pid(),
  'download_completion',
  (select attempt_id from download_authorizations where label = 'own-avatar')
);
select throws_ok(
  $$select private.emit_download_audit_event_core(
      (select attempt_id from download_authorizations where label = 'own-avatar'),
      'download_completion'
    )$$,
  '42501','download_audit_context_invalid',
  'emitter rejects a context from another transaction'
);
delete from private.download_execution_context;

insert into private.download_execution_context(
  transaction_id, backend_pid, operation_kind, attempt_id
) values (
  pg_catalog.txid_current(),
  pg_catalog.pg_backend_pid() + 1,
  'download_completion',
  (select attempt_id from download_authorizations where label = 'own-avatar')
);
select throws_ok(
  $$select private.emit_download_audit_event_core(
      (select attempt_id from download_authorizations where label = 'own-avatar'),
      'download_completion'
    )$$,
  '42501','download_audit_context_invalid',
  'emitter rejects a context from another backend'
);
delete from private.download_execution_context;

insert into private.download_execution_context(
  transaction_id, backend_pid, operation_kind, attempt_id
) values (
  pg_catalog.txid_current(),
  pg_catalog.pg_backend_pid(),
  'download_stale',
  (select attempt_id from download_authorizations where label = 'own-avatar')
);
select throws_ok(
  $$select private.emit_download_audit_event_core(
      (select attempt_id from download_authorizations where label = 'own-avatar'),
      'download_completion'
    )$$,
  '42501','download_audit_context_invalid',
  'emitter rejects a mismatched operation kind'
);
delete from private.download_execution_context;

insert into private.download_execution_context(
  transaction_id, backend_pid, operation_kind, attempt_id
) values (
  pg_catalog.txid_current(),
  pg_catalog.pg_backend_pid(),
  'download_completion',
  (select attempt_id from download_authorizations where label = 'admin-avatar')
);
select throws_ok(
  $$select private.emit_download_audit_event_core(
      (select attempt_id from download_authorizations where label = 'own-avatar'),
      'download_completion'
    )$$,
  '42501','download_audit_context_invalid',
  'emitter rejects a context for another attempt'
);
delete from private.download_execution_context;

update private.download_attempts attempt
set started_at = statement_timestamp() - interval '16 minutes'
where attempt.id = (
  select attempt_id from download_authorizations where label = 'stale'
);
update private.download_attempts attempt
set started_at = statement_timestamp() - interval '14 minutes'
where attempt.id = (
  select attempt_id from download_authorizations where label = 'fresh'
);
select is(
  private.finalize_stale_download_attempts(),
  1,
  'stale sweeper finalizes one attempt older than fifteen minutes'
);
select is(
  private.finalize_stale_download_attempts(),
  0,
  'stale sweeper is idempotent after the claim commits'
);
select results_eq(
  $$select authz.label, attempt.outcome, attempt.byte_class,
           attempt.nonce_hash, attempt.completed_at is not null
    from download_authorizations authz
    join private.download_attempts attempt on attempt.id = authz.attempt_id
    where authz.label in ('stale','fresh') order by authz.label$$,
  $$values
    ('fresh',null::text,null::text,
      (select nonce_hash from private.download_attempts where id =
        (select attempt_id from download_authorizations where label = 'fresh')),
      false),
    ('stale','abandoned','unknown',null::text,true)$$,
  'stale sweeper abandons only expired pending attempts'
);
select results_eq(
  $$select outcome::text, reason_code, metadata
    from public.audit_events
    where action = 'file.download'
      and correlation_id = '86000000-0000-4000-8000-000000000005'$$,
  $$values ('failure','DOWNLOAD_ABANDONED',
    '{"accessKind":"authenticated","byteClass":"unknown","downloadOutcome":"abandoned"}'::jsonb)$$,
  'stale sweeper emits exactly one redacted abandoned outcome'
);

insert into public_download_tokens
select core.*
from private.begin_download_audit_core(
  null,
  null,
  '35000000-0000-4000-8000-000000000001',
  'file',
  '65000000-0000-4000-8000-000000000002',
  '86000000-0000-4000-8000-000000000007'
) core;
set local role axsys_bff;
select private.complete_download_audit(
  (select attempt_id from public_download_tokens),
  (select completion_nonce from public_download_tokens),
  'completed',
  'under_1_mib'
);
reset role;
select results_eq(
  $$select actor_user_id, outcome::text, metadata
    from public.audit_events
    where action = 'file.download'
      and correlation_id = '86000000-0000-4000-8000-000000000007'$$,
  $$values (null::uuid,'success',
    '{"accessKind":"public","byteClass":"under_1_mib","downloadOutcome":"completed"}'::jsonb)$$,
  'owner core supports a guarded public attempt without inventing an actor'
);

update private.download_attempts
set started_at = statement_timestamp() - interval '32 days',
    completed_at = statement_timestamp() - interval '31 days',
    nonce_consumed_at = statement_timestamp() - interval '31 days'
where id = (
  select attempt_id from download_authorizations where label = 'own-avatar'
);
update private.download_attempts
set started_at = statement_timestamp() - interval '30 days',
    completed_at = statement_timestamp() - interval '29 days',
    nonce_consumed_at = statement_timestamp() - interval '29 days'
where id = (
  select attempt_id from download_authorizations where label = 'branding'
);
select is(
  private.purge_expired_download_attempts(),
  1,
  'retention removes one completed attempt older than thirty days'
);
select is(
  private.purge_expired_download_attempts(),
  0,
  'retention does not remove recent completed or pending attempts'
);
select results_eq(
  $$select attempt.outcome, attempt.byte_class,
           attempt.completed_at > statement_timestamp() - interval '30 days'
    from private.download_attempts attempt
    where attempt.id = (
      select attempt_id from download_authorizations where label = 'branding'
    )$$,
  $$values ('aborted','under_1_mib',true)$$,
  'retention preserves a completed attempt on the fresh side of thirty days'
);
select is_empty(
  $$select attempt.id from private.download_attempts attempt
    where attempt.id = (
      select attempt_id from download_authorizations where label = 'own-avatar'
    )$$,
  'retention removes only private attempt state and leaves immutable audit'
);
select is(
  (select count(*) from public.audit_events
    where action = 'file.download'
      and correlation_id = '86000000-0000-4000-8000-000000000001'),
  1::bigint,
  'retention preserves the completed audit event'
);

select * from finish();
rollback;
