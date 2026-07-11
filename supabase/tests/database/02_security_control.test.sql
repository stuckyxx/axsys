begin;
select no_plan();

select has_type('public'::name, 'audit_scope'::name);
select has_type('public'::name, 'audit_outcome'::name);
select has_type('public'::name, 'idempotency_state'::name);
select has_type('private'::name, 'auth_session_state'::name);
select results_eq(
  $$select namespace.nspname::text collate "default",
           type.typname::text collate "default",
           enum.enumlabel::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_enum enum on enum.enumtypid = type.oid
    where (namespace.nspname, type.typname) in (
      ('public', 'audit_scope'),
      ('public', 'audit_outcome'),
      ('public', 'idempotency_state'),
      ('private', 'auth_session_state')
    )
    order by namespace.nspname, type.typname, enum.enumsortorder$$,
  $$values
    ('private', 'auth_session_state', 'pending'),
    ('private', 'auth_session_state', 'active'),
    ('private', 'auth_session_state', 'revoked'),
    ('public', 'audit_outcome', 'success'),
    ('public', 'audit_outcome', 'denied'),
    ('public', 'audit_outcome', 'failure'),
    ('public', 'audit_scope', 'platform'),
    ('public', 'audit_scope', 'tenant'),
    ('public', 'idempotency_state', 'processing'),
    ('public', 'idempotency_state', 'completed'),
    ('public', 'idempotency_state', 'failed')$$,
  'enums de controle expõem somente os labels e a ordem congelados'
);

select has_table('public'::name, 'audit_events'::name);
select has_table('public'::name, 'security_events'::name);
select has_table('public'::name, 'idempotency_keys'::name);
select has_table('private'::name, 'rate_limit_policies'::name);
select has_table('private'::name, 'rate_limit_buckets'::name);
select has_table('private'::name, 'auth_user_session_cutoffs'::name);
select has_table('private'::name, 'auth_session_controls'::name);
select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname) in (
      ('public', 'audit_events'),
      ('public', 'security_events'),
      ('public', 'idempotency_keys'),
      ('private', 'rate_limit_policies'),
      ('private', 'rate_limit_buckets'),
      ('private', 'auth_user_session_cutoffs'),
      ('private', 'auth_session_controls')
    )
    order by namespace.nspname, class.relname$$,
  $$values
    ('private', 'auth_session_controls', true, true),
    ('private', 'auth_user_session_cutoffs', true, true),
    ('private', 'rate_limit_buckets', true, true),
    ('private', 'rate_limit_policies', true, true),
    ('public', 'audit_events', true, true),
    ('public', 'idempotency_keys', true, true),
    ('public', 'security_events', true, true)$$,
  'as sete tabelas de controle habilitam e forçam RLS'
);
select is_empty(
  $$select policyname
    from pg_policies
    where (schemaname, tablename) in (
      ('public', 'audit_events'),
      ('public', 'security_events'),
      ('public', 'idempotency_keys'),
      ('private', 'rate_limit_policies'),
      ('private', 'rate_limit_buckets'),
      ('private', 'auth_user_session_cutoffs'),
      ('private', 'auth_session_controls')
    )$$,
  'as sete tabelas permanecem com zero policies'
);
select results_eq(
  $$select table_schema::text collate "default",
           table_name::text collate "default",
           string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where (table_schema, table_name) in (
      ('public', 'audit_events'),
      ('public', 'security_events'),
      ('public', 'idempotency_keys'),
      ('private', 'rate_limit_policies'),
      ('private', 'rate_limit_buckets'),
      ('private', 'auth_user_session_cutoffs'),
      ('private', 'auth_session_controls')
    )
    group by table_schema, table_name
    order by table_schema, table_name$$,
  $$values
    ('private', 'auth_session_controls',
      'session_id,user_id,auth_created_at,remember_me,state,absolute_expires_at,audit_scope,audit_company_id,activated_at,revoked_at,last_seen_at,created_at,updated_at'),
    ('private', 'auth_user_session_cutoffs', 'user_id,revoked_before,updated_at'),
    ('private', 'rate_limit_buckets',
      'bucket,key_hash,attempts,window_started_at,blocked_until,updated_at'),
    ('private', 'rate_limit_policies',
      'bucket,attempt_limit,window_seconds,block_seconds,clear_on_success'),
    ('public', 'audit_events',
      'id,scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,reason_code,correlation_id,ip_hash,user_agent_hash,metadata,occurred_at'),
    ('public', 'idempotency_keys',
      'id,actor_user_id,company_id,operation,key_hash,request_hash,state,response_status,response_body,expires_at,completed_at,created_at,updated_at'),
    ('public', 'security_events',
      'id,event_type,user_id,email_hash,ip_hash,outcome,reason_code,correlation_id,metadata,occurred_at')$$,
  'sete tabelas expõem exatamente as colunas contratadas'
);
select results_eq(
  $$select bucket, attempt_limit, window_seconds, block_seconds, clear_on_success
    from private.rate_limit_policies
    order by bucket$$,
  $$values
    ('forgot-account-volume', 3, 3600, 60, false),
    ('forgot-ip-volume', 10, 900, 60, false),
    ('login-account-failure', 5, 900, 900, true),
    ('login-ip-volume', 30, 900, 1800, false),
    ('reauth-account-failure', 5, 900, 900, true),
    ('reauth-ip-volume', 20, 900, 1800, false)$$,
  'policies de rate limit contêm exatamente as seis tuplas congeladas'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           owner.rolname::text collate "default"
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_roles owner on owner.oid = class.relowner
    where class.relkind = 'r'
      and (namespace.nspname, class.relname) in (
        ('public', 'audit_events'),
        ('public', 'security_events'),
        ('public', 'idempotency_keys'),
        ('private', 'rate_limit_policies'),
        ('private', 'rate_limit_buckets'),
        ('private', 'auth_user_session_cutoffs'),
        ('private', 'auth_session_controls')
      )
    order by namespace.nspname, class.relname$$,
  $$values
    ('private', 'auth_session_controls', 'postgres'),
    ('private', 'auth_user_session_cutoffs', 'postgres'),
    ('private', 'rate_limit_buckets', 'postgres'),
    ('private', 'rate_limit_policies', 'postgres'),
    ('public', 'audit_events', 'postgres'),
    ('public', 'idempotency_keys', 'postgres'),
    ('public', 'security_events', 'postgres')$$,
  'todas as tabelas de controle pertencem a postgres'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           type.typname::text collate "default",
           owner.rolname::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_roles owner on owner.oid = type.typowner
    where (namespace.nspname, type.typname) in (
      ('public', 'audit_scope'),
      ('public', 'audit_outcome'),
      ('public', 'idempotency_state'),
      ('private', 'auth_session_state')
    )
    order by namespace.nspname, type.typname$$,
  $$values
    ('private', 'auth_session_state', 'postgres'),
    ('public', 'audit_outcome', 'postgres'),
    ('public', 'audit_scope', 'postgres'),
    ('public', 'idempotency_state', 'postgres')$$,
  'os quatro enums pertencem a postgres'
);
select is(
  has_type_privilege('postgres', 'private.auth_session_state', 'USAGE'),
  true,
  'postgres preserva USAGE efetivo no enum privado'
);
select is(
  has_type_privilege('axsys_bff', 'public.audit_outcome', 'USAGE'),
  true,
  'BFF preserva somente o USAGE necessário para chamar boundaries audit_outcome'
);
select is_empty(
  $$select role_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    where has_type_privilege(
      role_name,
      'private.auth_session_state',
      'USAGE'
    )$$,
  'PUBLIC/API/BFF não recebem USAGE efetivo no enum privado por ACL ou membership'
);
select ok(
  exists (
    select 1
    from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'T'
  ),
  'default ACL global de TYPES existe e protege futuros tipos private'
);
select is_empty(
  $$select role_name || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':'
           || grant_item.privilege_type
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'T'
      and case
        when grant_item.grantee = 0 then true
        else pg_has_role(role_name, grant_item.grantee, 'USAGE')
      end$$,
  'default ACL global de TYPES permanece fail-closed para PUBLIC/API/BFF'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           attribute.attname::text collate "default",
           format_type(attribute.atttypid, attribute.atttypmod)::text collate "default",
           attribute.attnotnull,
           coalesce(pg_get_expr(default_value.adbin, default_value.adrelid), '')::text collate "default"
    from pg_attribute attribute
    join pg_class class on class.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    left join pg_attrdef default_value
      on default_value.adrelid = attribute.attrelid
     and default_value.adnum = attribute.attnum
    where (namespace.nspname, class.relname, attribute.attname) in (
      ('public','audit_events','metadata'),
      ('public','audit_events','occurred_at'),
      ('public','idempotency_keys','actor_user_id'),
      ('public','idempotency_keys','state'),
      ('public','idempotency_keys','response_body'),
      ('public','idempotency_keys','expires_at'),
      ('private','auth_session_controls','session_id'),
      ('private','auth_session_controls','auth_created_at'),
      ('private','auth_session_controls','remember_me'),
      ('private','auth_session_controls','state'),
      ('private','auth_session_controls','absolute_expires_at'),
      ('private','auth_session_controls','audit_scope'),
      ('private','auth_session_controls','updated_at'),
      ('private','auth_user_session_cutoffs','revoked_before'),
      ('private','rate_limit_buckets','updated_at')
    )
    order by namespace.nspname, class.relname, attribute.attname$$,
  $$values
    ('private','auth_session_controls','absolute_expires_at','timestamp with time zone',true,''),
    ('private','auth_session_controls','audit_scope','audit_scope',false,''),
    ('private','auth_session_controls','auth_created_at','timestamp with time zone',true,''),
    ('private','auth_session_controls','remember_me','boolean',true,''),
    ('private','auth_session_controls','session_id','uuid',true,''),
    ('private','auth_session_controls','state','private.auth_session_state',true,
      $value$'pending'::private.auth_session_state$value$),
    ('private','auth_session_controls','updated_at','timestamp with time zone',true,'clock_timestamp()'),
    ('private','auth_user_session_cutoffs','revoked_before','timestamp with time zone',true,''),
    ('private','rate_limit_buckets','updated_at','timestamp with time zone',true,''),
    ('public','audit_events','metadata','jsonb',true,$value$'{}'::jsonb$value$),
    ('public','audit_events','occurred_at','timestamp with time zone',true,'clock_timestamp()'),
    ('public','idempotency_keys','actor_user_id','uuid',true,''),
    ('public','idempotency_keys','expires_at','timestamp with time zone',true,''),
    ('public','idempotency_keys','response_body','jsonb',false,''),
    ('public','idempotency_keys','state','idempotency_state',true,
      $value$'processing'::idempotency_state$value$)$$,
  'tipos, nullability e defaults essenciais permanecem congelados'
);
select results_eq(
  $$select class.relname::text collate "default",
           constraint_row.conname::text collate "default",
           pg_get_constraintdef(constraint_row.oid, false)::text collate "default"
    from pg_constraint constraint_row
    join pg_class class on class.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname, constraint_row.conname) in (
      ('public','audit_events','audit_events_actor_user_id_fkey'),
      ('public','audit_events','audit_events_company_id_fkey'),
      ('public','security_events','security_events_user_id_fkey'),
      ('public','idempotency_keys','idempotency_keys_actor_user_id_fkey'),
      ('public','idempotency_keys','idempotency_keys_company_id_fkey'),
      ('private','rate_limit_buckets','rate_limit_buckets_bucket_fkey'),
      ('private','auth_user_session_cutoffs','auth_user_session_cutoffs_user_id_fkey'),
      ('private','auth_session_controls','auth_session_controls_session_id_fkey'),
      ('private','auth_session_controls','auth_session_controls_user_id_fkey'),
      ('private','auth_session_controls','auth_session_controls_audit_company_id_fkey')
    )
    order by class.relname, constraint_row.conname$$,
  $$values
    ('audit_events','audit_events_actor_user_id_fkey',
      'FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT'),
    ('audit_events','audit_events_company_id_fkey',
      'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('auth_session_controls','auth_session_controls_audit_company_id_fkey',
      'FOREIGN KEY (audit_company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('auth_session_controls','auth_session_controls_session_id_fkey',
      'FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE'),
    ('auth_session_controls','auth_session_controls_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('auth_user_session_cutoffs','auth_user_session_cutoffs_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('idempotency_keys','idempotency_keys_actor_user_id_fkey',
      'FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT'),
    ('idempotency_keys','idempotency_keys_company_id_fkey',
      'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('rate_limit_buckets','rate_limit_buckets_bucket_fkey',
      'FOREIGN KEY (bucket) REFERENCES private.rate_limit_policies(bucket) ON DELETE RESTRICT'),
    ('security_events','security_events_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT')$$,
  'FKs congelam alvos e ações ON DELETE'
);
select results_eq(
  $$select class.relname::text collate "default",
           constraint_row.conname::text collate "default",
           pg_get_constraintdef(constraint_row.oid, false)::text collate "default"
    from pg_constraint constraint_row
    join pg_class class on class.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname, constraint_row.conname) in (
      ('private','rate_limit_buckets','rate_limit_buckets_block_order'),
      ('private','rate_limit_buckets','rate_limit_buckets_key_hash_format'),
      ('public','idempotency_keys','idempotency_keys_identity_unique'),
      ('public','idempotency_keys','idempotency_keys_processing_response'),
      ('public','idempotency_keys','idempotency_keys_response_size'),
      ('public','idempotency_keys','idempotency_keys_response_status_range')
    )
    order by class.relname, constraint_row.conname$$,
  $$values
    ('idempotency_keys','idempotency_keys_identity_unique',
      'UNIQUE NULLS NOT DISTINCT (actor_user_id, company_id, operation, key_hash)'),
    ('idempotency_keys','idempotency_keys_processing_response',
      'CHECK ((((state = ''processing''::idempotency_state) AND (response_status IS NULL) AND (response_body IS NULL) AND (completed_at IS NULL)) OR ((state = ANY (ARRAY[''completed''::idempotency_state, ''failed''::idempotency_state])) AND (response_status IS NOT NULL) AND (completed_at IS NOT NULL) AND (completed_at >= created_at))))'),
    ('idempotency_keys','idempotency_keys_response_size',
      'CHECK (((response_body IS NULL) OR (octet_length((response_body)::text) <= 65536)))'),
    ('idempotency_keys','idempotency_keys_response_status_range',
      'CHECK (((response_status IS NULL) OR ((response_status >= 100) AND (response_status <= 599))))'),
    ('rate_limit_buckets','rate_limit_buckets_block_order',
      'CHECK (((blocked_until IS NULL) OR (blocked_until >= window_started_at)))'),
    ('rate_limit_buckets','rate_limit_buckets_key_hash_format',
      'CHECK ((key_hash ~ ''^[0-9a-f]{64}$''::text))')$$,
  'constraints rate/idempotência preservam definições exatas'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           constraint_row.conname::text collate "default",
           constraint_row.contype::text collate "default",
           pg_get_constraintdef(constraint_row.oid, false)::text collate "default"
    from pg_constraint constraint_row
    join pg_class class on class.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname) in (
      ('public','audit_events'),
      ('public','security_events'),
      ('public','idempotency_keys'),
      ('private','rate_limit_policies'),
      ('private','rate_limit_buckets'),
      ('private','auth_user_session_cutoffs'),
      ('private','auth_session_controls')
    )
    order by namespace.nspname, class.relname, constraint_row.conname$$,
  $$select schema_name, table_name, constraint_name,
           case
             when definition like 'PRIMARY KEY%' then 'p'
             when definition like 'UNIQUE%' then 'u'
             when definition like 'FOREIGN KEY%' then 'f'
             else 'c'
           end::text,
           definition
    from (values
    ('private','auth_session_controls','auth_session_controls_audit_company_id_fkey',
      'FOREIGN KEY (audit_company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('private','auth_session_controls','auth_session_controls_expiry_order',
      'CHECK ((absolute_expires_at > auth_created_at))'),
    ('private','auth_session_controls','auth_session_controls_last_seen_order',
      'CHECK (((last_seen_at IS NULL) OR (last_seen_at >= auth_created_at)))'),
    ('private','auth_session_controls','auth_session_controls_lifecycle',
      'CHECK ((((state = ''pending''::private.auth_session_state) AND (activated_at IS NULL) AND (revoked_at IS NULL) AND (audit_scope IS NULL) AND (audit_company_id IS NULL)) OR ((state = ''active''::private.auth_session_state) AND (activated_at IS NOT NULL) AND (revoked_at IS NULL) AND (audit_scope IS NOT NULL) AND (((audit_scope = ''platform''::audit_scope) AND (audit_company_id IS NULL)) OR ((audit_scope = ''tenant''::audit_scope) AND (audit_company_id IS NOT NULL)))) OR ((state = ''revoked''::private.auth_session_state) AND (revoked_at IS NOT NULL) AND ((activated_at IS NULL) OR (activated_at <= revoked_at)) AND (((activated_at IS NULL) AND (audit_scope IS NULL) AND (audit_company_id IS NULL)) OR ((activated_at IS NOT NULL) AND (audit_scope IS NOT NULL) AND (((audit_scope = ''platform''::audit_scope) AND (audit_company_id IS NULL)) OR ((audit_scope = ''tenant''::audit_scope) AND (audit_company_id IS NOT NULL))))))))'),
    ('private','auth_session_controls','auth_session_controls_pkey',
      'PRIMARY KEY (session_id)'),
    ('private','auth_session_controls','auth_session_controls_session_id_fkey',
      'FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE'),
    ('private','auth_session_controls','auth_session_controls_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('private','auth_user_session_cutoffs','auth_user_session_cutoffs_pkey',
      'PRIMARY KEY (user_id)'),
    ('private','auth_user_session_cutoffs','auth_user_session_cutoffs_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('private','rate_limit_buckets','rate_limit_buckets_attempts_check',
      'CHECK ((attempts > 0))'),
    ('private','rate_limit_buckets','rate_limit_buckets_block_order',
      'CHECK (((blocked_until IS NULL) OR (blocked_until >= window_started_at)))'),
    ('private','rate_limit_buckets','rate_limit_buckets_bucket_fkey',
      'FOREIGN KEY (bucket) REFERENCES private.rate_limit_policies(bucket) ON DELETE RESTRICT'),
    ('private','rate_limit_buckets','rate_limit_buckets_key_hash_format',
      'CHECK ((key_hash ~ ''^[0-9a-f]{64}$''::text))'),
    ('private','rate_limit_buckets','rate_limit_buckets_pkey',
      'PRIMARY KEY (bucket, key_hash)'),
    ('private','rate_limit_policies','rate_limit_policies_attempt_limit_check',
      'CHECK ((attempt_limit > 0))'),
    ('private','rate_limit_policies','rate_limit_policies_block_seconds_check',
      'CHECK ((block_seconds > 0))'),
    ('private','rate_limit_policies','rate_limit_policies_pkey',
      'PRIMARY KEY (bucket)'),
    ('private','rate_limit_policies','rate_limit_policies_window_seconds_check',
      'CHECK ((window_seconds > 0))'),
    ('public','audit_events','audit_events_action_format',
      E'CHECK ((action ~ ''^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$''::text))'),
    ('public','audit_events','audit_events_actor_user_id_fkey',
      'FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT'),
    ('public','audit_events','audit_events_company_id_fkey',
      'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('public','audit_events','audit_events_ip_hash_format',
      'CHECK (((ip_hash IS NULL) OR (ip_hash ~ ''^[0-9a-f]{64}$''::text)))'),
    ('public','audit_events','audit_events_metadata_object',
      'CHECK (((jsonb_typeof(metadata) = ''object''::text) AND (octet_length((metadata)::text) <= 16384)))'),
    ('public','audit_events','audit_events_pkey','PRIMARY KEY (id)'),
    ('public','audit_events','audit_events_reason_code_format',
      'CHECK (((reason_code IS NULL) OR (reason_code ~ ''^[A-Z][A-Z0-9_]*$''::text)))'),
    ('public','audit_events','audit_events_resource_type_format',
      'CHECK ((resource_type ~ ''^[a-z][a-z0-9_]*$''::text))'),
    ('public','audit_events','audit_events_scope_company',
      'CHECK ((((scope = ''platform''::audit_scope) AND (company_id IS NULL)) OR ((scope = ''tenant''::audit_scope) AND (company_id IS NOT NULL))))'),
    ('public','audit_events','audit_events_user_agent_hash_format',
      'CHECK (((user_agent_hash IS NULL) OR (user_agent_hash ~ ''^[0-9a-f]{64}$''::text)))'),
    ('public','idempotency_keys','idempotency_keys_actor_user_id_fkey',
      'FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT'),
    ('public','idempotency_keys','idempotency_keys_company_id_fkey',
      'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
    ('public','idempotency_keys','idempotency_keys_expiry_order',
      'CHECK ((expires_at > created_at))'),
    ('public','idempotency_keys','idempotency_keys_identity_unique',
      'UNIQUE NULLS NOT DISTINCT (actor_user_id, company_id, operation, key_hash)'),
    ('public','idempotency_keys','idempotency_keys_key_hash_format',
      'CHECK ((key_hash ~ ''^[0-9a-f]{64}$''::text))'),
    ('public','idempotency_keys','idempotency_keys_operation_format',
      E'CHECK ((operation ~ ''^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$''::text))'),
    ('public','idempotency_keys','idempotency_keys_pkey','PRIMARY KEY (id)'),
    ('public','idempotency_keys','idempotency_keys_processing_response',
      'CHECK ((((state = ''processing''::idempotency_state) AND (response_status IS NULL) AND (response_body IS NULL) AND (completed_at IS NULL)) OR ((state = ANY (ARRAY[''completed''::idempotency_state, ''failed''::idempotency_state])) AND (response_status IS NOT NULL) AND (completed_at IS NOT NULL) AND (completed_at >= created_at))))'),
    ('public','idempotency_keys','idempotency_keys_request_hash_format',
      'CHECK ((request_hash ~ ''^[0-9a-f]{64}$''::text))'),
    ('public','idempotency_keys','idempotency_keys_response_size',
      'CHECK (((response_body IS NULL) OR (octet_length((response_body)::text) <= 65536)))'),
    ('public','idempotency_keys','idempotency_keys_response_status_range',
      'CHECK (((response_status IS NULL) OR ((response_status >= 100) AND (response_status <= 599))))'),
    ('public','security_events','security_events_email_hash_format',
      'CHECK (((email_hash IS NULL) OR (email_hash ~ ''^[0-9a-f]{64}$''::text)))'),
    ('public','security_events','security_events_event_type_format',
      E'CHECK ((event_type ~ ''^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$''::text))'),
    ('public','security_events','security_events_ip_hash_format',
      'CHECK (((ip_hash IS NULL) OR (ip_hash ~ ''^[0-9a-f]{64}$''::text)))'),
    ('public','security_events','security_events_metadata_object',
      'CHECK (((jsonb_typeof(metadata) = ''object''::text) AND (octet_length((metadata)::text) <= 16384)))'),
    ('public','security_events','security_events_pkey','PRIMARY KEY (id)'),
    ('public','security_events','security_events_reason_code_format',
      'CHECK (((reason_code IS NULL) OR (reason_code ~ ''^[A-Z][A-Z0-9_]*$''::text)))'),
    ('public','security_events','security_events_user_id_fkey',
      'FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE RESTRICT')
    ) expected(schema_name, table_name, constraint_name, definition)
    order by schema_name, table_name, constraint_name$$,
  'as sete tabelas congelam o conjunto completo e as definições exatas de constraints'
);
select is_empty(
  $$select role_name || ':' || table_name || ':' || privilege
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'public.audit_events',
      'public.security_events',
      'public.idempotency_keys',
      'private.rate_limit_policies',
      'private.rate_limit_buckets',
      'private.auth_user_session_cutoffs',
      'private.auth_session_controls'
    ]) table_name
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(role_name, table_name, privilege)$$,
  'PUBLIC/API/BFF não recebem privilégios efetivos de tabela, incluindo memberships e MAINTAIN'
);
select is_empty(
  $$select role_name || ':' || namespace.nspname || '.' || class.relname || '.'
           || attribute.attname || ':' || privilege
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
    cross join pg_attribute attribute
    join pg_class class on class.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname) in (
      ('public', 'audit_events'),
      ('public', 'security_events'),
      ('public', 'idempotency_keys'),
      ('private', 'rate_limit_policies'),
      ('private', 'rate_limit_buckets'),
      ('private', 'auth_user_session_cutoffs'),
      ('private', 'auth_session_controls')
    )
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        role_name,
        format('%I.%I', namespace.nspname, class.relname),
        attribute.attname,
        privilege
      )$$,
  'PUBLIC/API/BFF não recebem privilégios efetivos de coluna via ACL ou membership'
);
select is_empty(
  $$select role_name || ':' || defaults.defaclobjtype::text || ':' ||
           coalesce(namespace.nspname, '<global>') || ':' ||
           coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_default_acl defaults
    left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and (defaults.defaclnamespace = 0
        or namespace.nspname in ('public', 'private'))
      and defaults.defaclobjtype in ('r','S','f','T')
      and case
        when grant_item.grantee = 0 then true
        else pg_has_role(role_name, grant_item.grantee, 'USAGE')
      end$$,
  'default ACLs postgres permanecem efetivamente fail-closed via membership'
);
select ok(
  exists (
    select 1 from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
  ),
  'default ACL global de functions existe explicitamente'
);
select has_column(
  'private'::name,
  'auth_session_controls'::name,
  'audit_scope'::name,
  'controle privado preserva o escopo histórico sem expor session_id'
);
select has_column(
  'private'::name,
  'auth_session_controls'::name,
  'audit_company_id'::name,
  'controle privado preserva a empresa histórica'
);
select has_index(
  'private'::name,
  'auth_session_controls'::name,
  'auth_session_controls_audit_company_id_idx'::name,
  'FK do snapshot histórico possui índice completo'
);

select has_column(
  'private'::name,
  'auth_session_controls'::name,
  'absolute_expires_at'::name,
  'sessão expõe o vencimento absoluto contratado'
);
select has_column(
  'private'::name,
  'auth_session_controls'::name,
  'updated_at'::name,
  'sessão mantém timestamp de atualização'
);
select hasnt_column(
  'private'::name,
  'auth_session_controls'::name,
  'not_after'::name,
  'nome ambíguo anterior não permanece no catálogo'
);
select col_not_null(
  'public'::name,
  'idempotency_keys'::name,
  'actor_user_id'::name
);
select results_eq(
  $$select conname::text collate "default"
    from pg_constraint
    where conrelid in (
      'public.audit_events'::regclass,
      'public.security_events'::regclass,
      'public.idempotency_keys'::regclass
    )
      and conname in (
        'audit_events_action_format',
        'audit_events_reason_code_format',
        'audit_events_resource_type_format',
        'security_events_event_type_format',
        'security_events_reason_code_format',
        'idempotency_keys_operation_format',
        'idempotency_keys_response_status_range'
      )
    order by conname$$,
  $$values
    ('audit_events_action_format'),
    ('audit_events_reason_code_format'),
    ('audit_events_resource_type_format'),
    ('idempotency_keys_operation_format'),
    ('idempotency_keys_response_status_range'),
    ('security_events_event_type_format'),
    ('security_events_reason_code_format')$$,
  'campos de vocabulário e status possuem constraints nomeadas'
);

select has_function('private'::name, 'consume_rate_limit'::name);
select has_function('private'::name, 'clear_rate_limit'::name);
select has_function('private'::name, 'register_auth_session'::name);
select has_function('private'::name, 'assert_auth_session'::name);
select has_function('private'::name, 'write_authenticated_audit_event'::name);
select has_function('private'::name, 'write_security_event'::name);
select has_function('private'::name, 'revoke_sessions_and_write_logout'::name);
select has_function('private'::name, 'fail_closed_login_session'::name);
select has_function(
  'private'::name,
  'rotate_app_session_after_reauthentication'::name
);
select has_function('private'::name, 'revoke_auth_sessions'::name);
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
        'consume_rate_limit', 'clear_rate_limit',
        'register_auth_session', 'assert_auth_session', 'revoke_auth_sessions',
        'write_authenticated_audit_event', 'write_security_event',
        'revoke_sessions_and_write_logout', 'fail_closed_login_session',
        'rotate_app_session_after_reauthentication'
      )
    order by function.proname$$,
  $$values
    ('assert_auth_session', 'p_session_id uuid, p_user_id uuid',
      'boolean', 'postgres', true, true),
    ('clear_rate_limit', 'p_bucket text, p_key_hash text',
      'void', 'postgres', true, true),
    ('consume_rate_limit',
      'p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer, p_block_seconds integer',
      'TABLE(allowed boolean, attempts integer, retry_after_seconds integer)',
      'postgres', true, true),
    ('fail_closed_login_session',
      'p_actor_user_id uuid, p_session_id uuid, p_reason_code text, p_correlation_id uuid',
      'void', 'postgres', true, true),
    ('register_auth_session',
      'p_session_id uuid, p_user_id uuid, p_remember_me boolean',
      'timestamp with time zone', 'postgres', true, true),
    ('revoke_auth_sessions', 'p_user_id uuid, p_except_session_id uuid',
      'integer', 'postgres', true, true),
    ('revoke_sessions_and_write_logout',
      'p_actor_user_id uuid, p_session_id uuid, p_correlation_id uuid, p_ip_hash text, p_user_agent_hash text',
      'void', 'postgres', true, true),
    ('rotate_app_session_after_reauthentication',
      'p_actor_user_id uuid, p_old_session_id uuid, p_new_session_id uuid, p_correlation_id uuid',
      'void', 'postgres', true, true),
    ('write_authenticated_audit_event',
      'p_actor_user_id uuid, p_session_id uuid, p_action text, p_resource_type text, p_resource_id uuid, p_outcome audit_outcome, p_reason_code text, p_correlation_id uuid, p_ip_hash text, p_user_agent_hash text, p_metadata jsonb',
      'void', 'postgres', true, true),
    ('write_security_event',
      'p_event_type text, p_user_id uuid, p_email_hash text, p_ip_hash text, p_outcome audit_outcome, p_reason_code text, p_correlation_id uuid, p_metadata jsonb',
      'void', 'postgres', true, true)$$,
  'dez rotinas de controle congelam assinatura, retorno, owner, definer e search_path'
);
select results_eq(
  $$select function.oid::regprocedure::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.oid::regprocedure::text$$,
  $$values
    ('private.assert_auth_session(uuid,uuid)'),
    ('private.clear_rate_limit(text,text)'),
    ('private.consume_rate_limit(text,text,integer,integer,integer)'),
    ('private.fail_closed_login_session(uuid,uuid,text,uuid)'),
    ('private.register_auth_session(uuid,uuid,boolean)'),
    ('private.revoke_sessions_and_write_logout(uuid,uuid,uuid,text,text)'),
    ('private.rotate_app_session_after_reauthentication(uuid,uuid,uuid,uuid)'),
    ('private.write_authenticated_audit_event(uuid,uuid,text,text,uuid,audit_outcome,text,uuid,text,text,jsonb)'),
    ('private.write_security_event(text,uuid,text,text,audit_outcome,text,uuid,jsonb)')$$,
  'axsys_bff recebe exatamente nove EXECUTEs efetivos, incluindo memberships'
);
select results_eq(
  $$select role_name::text collate "default",
           function.oid::regprocedure::text collate "default"
    from unnest(array['anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege(role_name, function.oid, 'EXECUTE')
    order by role_name, function.oid::regprocedure::text$$,
  $$values
    ('authenticated','private.has_active_app_session()'),
    ('authenticated','private.has_company_role(uuid,membership_role)'),
    ('authenticated','private.has_module(uuid,module_key)'),
    ('authenticated','private.has_platform_role()'),
    ('authenticated','private.has_registered_app_session()'),
    ('authenticated','private.is_active_company_member(uuid)')$$,
  'authenticated executa exatamente seis helpers RLS; anon/service seguem negados'
);
select is_empty(
  $$select function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'resolve_audit_identity',
        'reject_append_only_mutation',
        'guard_idempotency_key_update',
        'guard_auth_session_control_update',
        'revoke_auth_sessions'
      )
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')$$,
  'helpers e revogação owner-only não chegam efetivamente ao BFF'
);
select results_eq(
  $$select schemaname::text collate "default",
           indexname::text collate "default",
           indexdef::text collate "default"
    from pg_indexes
    where indexname in (
      'audit_events_actor_user_id_idx',
      'audit_events_company_id_idx',
      'audit_events_correlation_id_idx',
      'audit_events_platform_keyset_idx',
      'audit_events_tenant_keyset_idx',
      'security_events_user_id_idx',
      'security_events_correlation_id_idx',
      'security_events_keyset_idx',
      'idempotency_keys_company_id_idx',
      'idempotency_keys_expires_at_idx',
      'idempotency_keys_identity_unique',
      'rate_limit_buckets_updated_at_idx',
      'auth_user_session_cutoffs_revoked_before_idx',
      'auth_session_controls_user_id_idx',
      'auth_session_controls_audit_company_id_idx',
      'auth_session_controls_active_idx',
      'auth_session_controls_pending_idx'
    )
    order by indexname$$,
  $$values
    ('public','audit_events_actor_user_id_idx',
      'CREATE INDEX audit_events_actor_user_id_idx ON public.audit_events USING btree (actor_user_id)'),
    ('public','audit_events_company_id_idx',
      'CREATE INDEX audit_events_company_id_idx ON public.audit_events USING btree (company_id)'),
    ('public','audit_events_correlation_id_idx',
      'CREATE INDEX audit_events_correlation_id_idx ON public.audit_events USING btree (correlation_id)'),
    ('public','audit_events_platform_keyset_idx',
      'CREATE INDEX audit_events_platform_keyset_idx ON public.audit_events USING btree (occurred_at DESC, id DESC) WHERE (scope = ''platform''::audit_scope)'),
    ('public','audit_events_tenant_keyset_idx',
      'CREATE INDEX audit_events_tenant_keyset_idx ON public.audit_events USING btree (company_id, occurred_at DESC, id DESC) WHERE (scope = ''tenant''::audit_scope)'),
    ('private','auth_session_controls_active_idx',
      'CREATE INDEX auth_session_controls_active_idx ON private.auth_session_controls USING btree (user_id, absolute_expires_at, session_id) WHERE (state = ''active''::private.auth_session_state)'),
    ('private','auth_session_controls_audit_company_id_idx',
      'CREATE INDEX auth_session_controls_audit_company_id_idx ON private.auth_session_controls USING btree (audit_company_id)'),
    ('private','auth_session_controls_pending_idx',
      'CREATE INDEX auth_session_controls_pending_idx ON private.auth_session_controls USING btree (user_id, auth_created_at, session_id) WHERE (state = ''pending''::private.auth_session_state)'),
    ('private','auth_session_controls_user_id_idx',
      'CREATE INDEX auth_session_controls_user_id_idx ON private.auth_session_controls USING btree (user_id)'),
    ('private','auth_user_session_cutoffs_revoked_before_idx',
      'CREATE INDEX auth_user_session_cutoffs_revoked_before_idx ON private.auth_user_session_cutoffs USING btree (revoked_before)'),
    ('public','idempotency_keys_company_id_idx',
      'CREATE INDEX idempotency_keys_company_id_idx ON public.idempotency_keys USING btree (company_id)'),
    ('public','idempotency_keys_expires_at_idx',
      'CREATE INDEX idempotency_keys_expires_at_idx ON public.idempotency_keys USING btree (expires_at)'),
    ('public','idempotency_keys_identity_unique',
      'CREATE UNIQUE INDEX idempotency_keys_identity_unique ON public.idempotency_keys USING btree (actor_user_id, company_id, operation, key_hash) NULLS NOT DISTINCT'),
    ('private','rate_limit_buckets_updated_at_idx',
      'CREATE INDEX rate_limit_buckets_updated_at_idx ON private.rate_limit_buckets USING btree (updated_at)'),
    ('public','security_events_correlation_id_idx',
      'CREATE INDEX security_events_correlation_id_idx ON public.security_events USING btree (correlation_id)'),
    ('public','security_events_keyset_idx',
      'CREATE INDEX security_events_keyset_idx ON public.security_events USING btree (event_type, occurred_at DESC, id DESC)'),
    ('public','security_events_user_id_idx',
      'CREATE INDEX security_events_user_id_idx ON public.security_events USING btree (user_id)')$$,
  'todos os 17 índices congelam schema, nome e definição PostgreSQL exata'
);
select results_eq(
  $$select indexname::text collate "default", indexdef::text collate "default"
    from pg_indexes
    where indexname in (
      'audit_events_tenant_keyset_idx',
      'audit_events_platform_keyset_idx',
      'security_events_keyset_idx',
      'idempotency_keys_identity_unique'
    )
    order by indexname$$,
  $$values
    ('audit_events_platform_keyset_idx',
      'CREATE INDEX audit_events_platform_keyset_idx ON public.audit_events USING btree (occurred_at DESC, id DESC) WHERE (scope = ''platform''::audit_scope)'),
    ('audit_events_tenant_keyset_idx',
      'CREATE INDEX audit_events_tenant_keyset_idx ON public.audit_events USING btree (company_id, occurred_at DESC, id DESC) WHERE (scope = ''tenant''::audit_scope)'),
    ('idempotency_keys_identity_unique',
      'CREATE UNIQUE INDEX idempotency_keys_identity_unique ON public.idempotency_keys USING btree (actor_user_id, company_id, operation, key_hash) NULLS NOT DISTINCT'),
    ('security_events_keyset_idx',
      'CREATE INDEX security_events_keyset_idx ON public.security_events USING btree (event_type, occurred_at DESC, id DESC)')$$,
  'índices keyset e UNIQUE NULLS NOT DISTINCT preservam definição exata'
);
select has_trigger(
  'public'::name,
  'audit_events'::name,
  'audit_events_append_only'::name
);
select has_trigger(
  'public'::name,
  'security_events'::name,
  'security_events_append_only'::name
);
select has_trigger(
  'public'::name,
  'idempotency_keys'::name,
  'idempotency_keys_guard_update'::name
);
select has_trigger(
  'private'::name,
  'auth_session_controls'::name,
  'auth_session_controls_guard_update'::name
);

insert into private.rate_limit_buckets (
  bucket, key_hash, attempts, window_started_at, blocked_until, updated_at
) values (
  'forgot-account-volume',
  repeat('a', 64),
  4,
  clock_timestamp() - interval '5 minutes',
  clock_timestamp() - interval '1 second',
  clock_timestamp() - interval '1 second'
);
select results_eq(
  $$select allowed, attempts, retry_after_seconds
    from private.consume_rate_limit(
      'forgot-account-volume', repeat('a', 64), 3, 3600, 60
    )$$,
  $$values (true, 1, 0)$$,
  'bloco expirado reinicia a janela mesmo quando a janela antiga ainda não expirou'
);

insert into private.rate_limit_buckets (
  bucket, key_hash, attempts, window_started_at, blocked_until, updated_at
) values (
  'login-account-failure', repeat('b', 64), 1,
  clock_timestamp(), null, clock_timestamp()
);
update private.rate_limit_policies
set clear_on_success = false
where bucket = 'login-account-failure';
select throws_ok(
  $$select private.clear_rate_limit('login-account-failure', repeat('b', 64))$$,
  '22023',
  'rate_limit_clear_forbidden',
  'clear consulta a policy congelada em vez de confiar apenas no nome'
);
select is(
  (select count(*)::integer
   from private.rate_limit_buckets
   where bucket = 'login-account-failure' and key_hash = repeat('b', 64)),
  1,
  'clear rejeitado não remove o bucket'
);
update private.rate_limit_policies
set clear_on_success = true
where bucket = 'login-account-failure';

select results_eq(
  $$with policies(bucket, attempt_limit, window_seconds, block_seconds, key_hash) as (
      values
        ('login-ip-volume', 30, 900, 1800, repeat('0', 64)),
        ('login-account-failure', 5, 900, 900, repeat('1', 64)),
        ('reauth-ip-volume', 20, 900, 1800, repeat('2', 64)),
        ('reauth-account-failure', 5, 900, 900, repeat('3', 64)),
        ('forgot-ip-volume', 10, 900, 60, repeat('4', 64)),
        ('forgot-account-volume', 3, 3600, 60, repeat('5', 64))
    ), decisions as materialized (
      select policy.bucket, policy.attempt_limit, policy.block_seconds,
             sequence.number, decision.allowed, decision.attempts,
             decision.retry_after_seconds
      from policies policy
      cross join lateral generate_series(1, policy.attempt_limit + 1) sequence(number)
      cross join lateral private.consume_rate_limit(
        policy.bucket,
        left(policy.key_hash, 64 + sequence.number * 0),
        policy.attempt_limit,
        policy.window_seconds, policy.block_seconds
      ) decision
      order by policy.bucket, sequence.number
    )
    select bucket,
           count(*) filter (where allowed)::integer,
           count(*) filter (where not allowed)::integer,
           max(attempts)::integer,
           max(retry_after_seconds)::integer
    from decisions
    group by bucket
    order by bucket$$,
  $$values
    ('forgot-account-volume', 3, 1, 4, 60),
    ('forgot-ip-volume', 10, 1, 11, 60),
    ('login-account-failure', 5, 1, 6, 900),
    ('login-ip-volume', 30, 1, 31, 1800),
    ('reauth-account-failure', 5, 1, 6, 900),
    ('reauth-ip-volume', 20, 1, 21, 1800)$$,
  'cada policy permite exatamente N tentativas e bloqueia N+1 pelo período fixo'
);

insert into private.rate_limit_buckets (
  bucket, key_hash, attempts, window_started_at, blocked_until, updated_at
) values (
  'login-ip-volume', repeat('6', 64), 31,
  clock_timestamp() - interval '2 hours',
  clock_timestamp() + interval '30 seconds',
  clock_timestamp()
);
select results_eq(
  $$select allowed, attempts
    from private.consume_rate_limit(
      'login-ip-volume', repeat('6', 64), 30, 900, 1800
    )$$,
  $$values (false, 31)$$,
  'bloco ativo sobrevive ao vencimento da janela de contagem'
);
select throws_ok(
  $$select * from private.consume_rate_limit(
    'unknown-bucket', repeat('7', 64), 1, 1, 1
  )$$,
  '22023', 'rate_limit_policy_unknown',
  'consume rejeita bucket desconhecido'
);
select throws_ok(
  $$select * from private.consume_rate_limit(
    'login-account-failure', upper(repeat('a', 64)), 5, 900, 900
  )$$,
  '22023', 'rate_limit_key_hash_invalid',
  'consume rejeita hash fora da gramática lowercase-hex'
);
select throws_ok(
  $$select * from private.consume_rate_limit(
    'login-account-failure', repeat('8', 64), 6, 900, 900
  )$$,
  '22023', 'rate_limit_policy_mismatch',
  'consume rejeita tupla que diverge da policy congelada'
);
select throws_ok(
  $$select * from private.consume_rate_limit(
    null, repeat('8', 64), 5, 900, 900
  )$$,
  '22023', 'rate_limit_input_invalid',
  'consume rejeita parâmetros nulos'
);
select is(
  (select count(*)::integer from private.rate_limit_buckets
   where key_hash in (repeat('7', 64), repeat('8', 64))),
  0,
  'consumos rejeitados não deixam bucket residual'
);

insert into private.rate_limit_buckets (
  bucket, key_hash, attempts, window_started_at, blocked_until, updated_at
) values
  ('login-account-failure', repeat('9', 64), 1,
    clock_timestamp(), null, clock_timestamp()),
  ('reauth-account-failure', repeat('f', 64), 1,
    clock_timestamp(), null, clock_timestamp());
select lives_ok(
  $$select private.clear_rate_limit('login-account-failure', repeat('9', 64))$$,
  'clear permite login-account-failure'
);
select lives_ok(
  $$select private.clear_rate_limit('reauth-account-failure', repeat('f', 64))$$,
  'clear permite reauth-account-failure'
);
select is(
  (select count(*)::integer from private.rate_limit_buckets
   where (bucket, key_hash) in (
     ('login-account-failure', repeat('9', 64)),
     ('reauth-account-failure', repeat('f', 64))
   )),
  0,
  'os dois clears permitidos removem seus buckets'
);
select throws_ok(
  $$select private.clear_rate_limit('login-ip-volume', repeat('b', 64))$$,
  '22023', 'rate_limit_clear_forbidden', 'clear proíbe login-ip-volume'
);
select throws_ok(
  $$select private.clear_rate_limit('reauth-ip-volume', repeat('b', 64))$$,
  '22023', 'rate_limit_clear_forbidden', 'clear proíbe reauth-ip-volume'
);
select throws_ok(
  $$select private.clear_rate_limit('forgot-ip-volume', repeat('b', 64))$$,
  '22023', 'rate_limit_clear_forbidden', 'clear proíbe forgot-ip-volume'
);
select throws_ok(
  $$select private.clear_rate_limit('forgot-account-volume', repeat('b', 64))$$,
  '22023', 'rate_limit_clear_forbidden', 'clear proíbe forgot-account-volume'
);
select throws_ok(
  $$select private.clear_rate_limit(
    'login-account-failure', upper(repeat('e', 64))
  )$$,
  '22023', 'rate_limit_key_hash_invalid',
  'clear rejeita hash fora da gramática lowercase-hex'
);
select throws_ok(
  $$select private.clear_rate_limit(null, repeat('a', 64))$$,
  '22023', 'rate_limit_input_invalid',
  'clear rejeita bucket nulo'
);
select throws_ok(
  $$select private.clear_rate_limit('login-account-failure', null)$$,
  '22023', 'rate_limit_input_invalid',
  'clear rejeita key hash nulo'
);
select is(
  (select count(*)::integer
   from private.rate_limit_buckets
   where key_hash = repeat('e', 64)),
  0,
  'clears inválidos deixam zero bucket residual'
);

select lives_ok(
  format(
    'select private.write_security_event(%L, null, %L, %L, %L::public.audit_outcome, %L, %L::uuid, %L::jsonb)',
    event_type, repeat('c', 64), repeat('d', 64), outcome, reason_code,
    correlation_id, '{}'
  ),
  'security writer aceita ' || event_type || '/' || outcome || '/'
    || coalesce(reason_code, '<null>')
)
from (values
  ('auth.login.failed', 'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000001'),
  ('auth.login.failed', 'failure', 'AUTH_PROVIDER_FAILURE',
    '64000000-0000-4000-8000-000000000002'),
  ('auth.login.rate_limited', 'denied', 'IP_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000003'),
  ('auth.login.rate_limited', 'denied', 'ACCOUNT_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000004'),
  ('auth.reauthentication.failed', 'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000005'),
  ('auth.reauthentication.failed', 'failure', 'AUTH_PROVIDER_FAILURE',
    '64000000-0000-4000-8000-000000000006'),
  ('auth.reauthentication.rate_limited', 'denied', 'IP_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000007'),
  ('auth.reauthentication.rate_limited', 'denied', 'ACCOUNT_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000008'),
  ('auth.password_recovery.requested', 'success', null,
    '64000000-0000-4000-8000-000000000009'),
  ('auth.password_recovery.failed', 'failure', 'AUTH_PROVIDER_FAILURE',
    '64000000-0000-4000-8000-000000000010'),
  ('auth.password_recovery.rate_limited', 'denied', 'IP_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000011'),
  ('auth.password_recovery.rate_limited', 'denied', 'ACCOUNT_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000012')
) vocabulary(event_type, outcome, reason_code, correlation_id);
select lives_ok(
  $$select private.write_security_event(
    'auth.login.rate_limited', null, repeat('c', 64), repeat('d', 64),
    'denied', 'IP_RATE_LIMITED',
    '64000000-0000-4000-8000-000000000013',
    '{"attempts":30,"retryAfterSeconds":1800}'::jsonb
  )$$,
  'security writer aceita e reconstrói os dois inteiros permitidos'
);
select results_eq(
  $$select count(*)::integer,
           count(*) filter (where user_id is null)::integer,
           count(*) filter (
             where metadata - 'attempts' - 'retryAfterSeconds' = '{}'::jsonb
           )::integer
    from public.security_events$$,
  $$values (13, 13, 13)$$,
  'eventos válidos preservam anonimato e somente metadata allowlisted'
);

select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', '65000000-0000-4000-8000-000000000001',
    repeat('c', 64), repeat('d', 64), 'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000020', '{}'
  )$$,
  '22023', 'security_event_invalid',
  'security writer exige p_user_id nulo'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.unknown', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000021', '{}'
  )$$,
  '22023', 'security_event_vocabulary_invalid',
  'security writer rejeita evento fora da allowlist'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'success', null, '64000000-0000-4000-8000-000000000022', '{}'
  )$$,
  '22023', 'security_event_vocabulary_invalid',
  'security writer rejeita combinação outcome/reason inválida'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', null, '64000000-0000-4000-8000-000000000030', '{}'
  )$$,
  '22023', 'security_event_vocabulary_invalid',
  'security writer trata reason NULL como combinação inválida, nunca SQL unknown'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('C', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000023', '{}'
  )$$,
  '22023', 'security_event_invalid',
  'security writer rejeita hash uppercase'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000024', '{"email":"plain@example.test"}'
  )$$,
  '22023', 'security_event_invalid',
  'security writer rejeita chave desconhecida e plaintext'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000025', '{"attempts":"1"}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer rejeita inteiro codificado como string'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000026', '{"attempts":-1}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer rejeita inteiro negativo'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000027', '{"attempts":1000001}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer aplica limite superior de attempts'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000028', '{"retryAfterSeconds":86401}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer aplica limite superior de retryAfterSeconds'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000029',
    jsonb_build_object('unknown', repeat('x', 17000))
  )$$,
  '22023', 'security_event_invalid',
  'security writer aplica o teto SQL de 16 KiB'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000031', '{"attempts":[1]}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer rejeita attempts como array'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000032', '{"attempts":{"value":1}}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer rejeita attempts como objeto aninhado'
);
select throws_ok(
  $$select private.write_security_event(
    'auth.login.failed', null, repeat('c', 64), repeat('d', 64),
    'denied', 'AUTH_INVALID_CREDENTIALS',
    '64000000-0000-4000-8000-000000000033', '{"attempts":1.5}'
  )$$,
  '22023', 'security_metadata_invalid',
  'security writer rejeita attempts fracionário'
);
select is(
  (select count(*)::integer from public.security_events),
  13,
  'security calls rejeitadas deixam zero eventos residuais'
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
        'resolve_audit_identity',
        'reject_append_only_mutation',
        'guard_idempotency_key_update',
        'guard_auth_session_control_update'
      )
    order by function.proname$$,
  $$values
    ('guard_auth_session_control_update', '', 'trigger', 'postgres', false, true),
    ('guard_idempotency_key_update', '', 'trigger', 'postgres', false, true),
    ('reject_append_only_mutation', '', 'trigger', 'postgres', false, true),
    ('resolve_audit_identity', 'p_user_id uuid',
      'TABLE(resolved_scope audit_scope, resolved_company_id uuid)',
      'postgres', false, true)$$,
  'quatro helpers congelam assinatura, retorno, owner, invoker e search_path vazio'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           class.relname::text collate "default",
           trigger.tgname::text collate "default",
           trigger.tgtype::integer,
           pg_get_triggerdef(trigger.oid, false)::text collate "default"
    from pg_trigger trigger
    join pg_class class on class.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where not trigger.tgisinternal
      and trigger.tgname in (
        'audit_events_append_only',
        'security_events_append_only',
        'idempotency_keys_guard_update',
        'auth_session_controls_guard_update',
        'platform_roles_serialize_identity_invariants',
        'profiles_serialize_auth_scope',
        'companies_serialize_auth_scope'
      )
    order by namespace.nspname, class.relname, trigger.tgname$$,
  $$values
    ('private','auth_session_controls','auth_session_controls_guard_update',19,
      'CREATE TRIGGER auth_session_controls_guard_update BEFORE UPDATE ON private.auth_session_controls FOR EACH ROW EXECUTE FUNCTION private.guard_auth_session_control_update()'),
    ('public','audit_events','audit_events_append_only',58,
      'CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION private.reject_append_only_mutation()'),
    ('public','companies','companies_serialize_auth_scope',18,
      'CREATE TRIGGER companies_serialize_auth_scope BEFORE UPDATE OF status ON public.companies FOR EACH STATEMENT EXECUTE FUNCTION private.serialize_identity_invariants()'),
    ('public','idempotency_keys','idempotency_keys_guard_update',19,
      'CREATE TRIGGER idempotency_keys_guard_update BEFORE UPDATE ON public.idempotency_keys FOR EACH ROW EXECUTE FUNCTION private.guard_idempotency_key_update()'),
    ('public','platform_roles','platform_roles_serialize_identity_invariants',30,
      'CREATE TRIGGER platform_roles_serialize_identity_invariants BEFORE INSERT OR DELETE OR UPDATE OF user_id, is_active ON public.platform_roles FOR EACH STATEMENT EXECUTE FUNCTION private.serialize_identity_invariants()'),
    ('public','profiles','profiles_serialize_auth_scope',18,
      'CREATE TRIGGER profiles_serialize_auth_scope BEFORE UPDATE OF must_change_password, temporary_password_expires_at, is_active ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION private.serialize_identity_invariants()'),
    ('public','security_events','security_events_append_only',58,
      'CREATE TRIGGER security_events_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON public.security_events FOR EACH STATEMENT EXECUTE FUNCTION private.reject_append_only_mutation()')$$,
  'triggers congelam exatamente eventos, nível e função'
);
select results_eq(
  $$select function.proname::text collate "default",
           pg_get_function_result(function.oid)::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'write_authenticated_audit_event',
        'write_security_event',
        'revoke_sessions_and_write_logout',
        'fail_closed_login_session',
        'rotate_app_session_after_reauthentication'
      )
    order by function.proname$$,
  $$values
    ('fail_closed_login_session', 'void'),
    ('revoke_sessions_and_write_logout', 'void'),
    ('rotate_app_session_after_reauthentication', 'void'),
    ('write_authenticated_audit_event', 'void'),
    ('write_security_event', 'void')$$,
  'as cinco boundaries de escrita retornam SQL void'
);
select results_eq(
  $$select function.proname::text collate "default",
           (
             strpos(pg_get_functiondef(function.oid),
               'pg_advisory_xact_lock(1672, 0)') > 0
             and strpos(pg_get_functiondef(function.oid),
               'pg_advisory_xact_lock(1672, 0)')
               < strpos(pg_get_functiondef(function.oid), 'hashtextextended')
           )
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'write_authenticated_audit_event',
        'revoke_sessions_and_write_logout',
        'rotate_app_session_after_reauthentication'
      )
    order by function.proname$$,
  $$values
    ('revoke_sessions_and_write_logout', true),
    ('rotate_app_session_after_reauthentication', true),
    ('write_authenticated_audit_event', true)$$,
  'operações de sessão adquirem sempre o lock global antes do lock por usuário'
);
select results_eq(
  $$select function.proname::text collate "default",
           regexp_count(lower(pg_get_functiondef(function.oid)), 'for share')::integer
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'register_auth_session',
        'write_authenticated_audit_event',
        'revoke_sessions_and_write_logout',
        'rotate_app_session_after_reauthentication'
      )
    order by function.proname$$,
  $$values
    ('register_auth_session', 1),
    ('revoke_sessions_and_write_logout', 1),
    ('rotate_app_session_after_reauthentication', 1),
    ('write_authenticated_audit_event', 1)$$,
  'registro e writers bloqueiam cada Auth row autoritativa com FOR SHARE'
);
select ok(
  (select lower(pg_get_functiondef(function.oid))
   from pg_proc function
   join pg_namespace namespace on namespace.oid = function.pronamespace
   where namespace.nspname = 'private'
     and function.proname = 'rotate_app_session_after_reauthentication')
  like '%where auth_session.id in (p_old_session_id, p_new_session_id)%order by auth_session.id%for share%',
  'rotação bloqueia old e new Auth rows juntas em ordem determinística'
);

\ir helpers/fixtures.inc

select test_helpers.create_auth_user(
  '61000000-0000-4000-8000-000000000001',
  'security-session@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '61000000-0000-4000-8000-000000000001',
  'security-session@example.test',
  'Security Session'
);
insert into public.platform_roles (user_id)
values ('61000000-0000-4000-8000-000000000001');

insert into public.idempotency_keys (
  id, actor_user_id, company_id, operation, key_hash, request_hash, expires_at
) values (
  '66000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  null,
  'auth.login',
  repeat('1', 64),
  repeat('2', 64),
  clock_timestamp() + interval '1 hour'
);
select throws_ok(
  $$insert into public.idempotency_keys (
      actor_user_id, company_id, operation, key_hash, request_hash, expires_at
    ) values (
      '61000000-0000-4000-8000-000000000001', null, 'auth.login',
      repeat('1', 64), repeat('3', 64), clock_timestamp() + interval '1 hour'
    )$$,
  '23505', null,
  'UNIQUE NULLS NOT DISTINCT colide company_id nulo sem sentinela UUID'
);
select throws_ok(
  $$insert into public.idempotency_keys (
      actor_user_id, operation, key_hash, request_hash, state,
      response_status, expires_at
    ) values (
      '61000000-0000-4000-8000-000000000001', 'auth.processing',
      repeat('3', 64), repeat('4', 64), 'processing', 202,
      clock_timestamp() + interval '1 hour'
    )$$,
  '23514', null,
  'linha processing exige response status/body/completed nulos'
);
select lives_ok(
  $$update public.idempotency_keys
    set state = 'completed', response_status = 200,
        response_body = '{"ok":true}', completed_at = clock_timestamp()
    where id = '66000000-0000-4000-8000-000000000001'$$,
  'processing transita uma vez para completed com resposta válida'
);
select throws_ok(
  $$update public.idempotency_keys
    set response_body = '{"ok":false}'
    where id = '66000000-0000-4000-8000-000000000001'$$,
  '55000', 'idempotency_transition_invalid',
  'resposta terminal não pode ser reescrita'
);
select throws_ok(
  $$update public.idempotency_keys
    set state = 'processing', response_status = null,
        response_body = null, completed_at = null
    where id = '66000000-0000-4000-8000-000000000001'$$,
  '55000', 'idempotency_transition_invalid',
  'estado terminal não retorna para processing'
);
insert into public.idempotency_keys (
  id, actor_user_id, operation, key_hash, request_hash, expires_at
) values (
  '66000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'auth.failure', repeat('4', 64), repeat('5', 64),
  clock_timestamp() + interval '1 hour'
);
select throws_ok(
  $$update public.idempotency_keys
    set operation = 'auth.changed', state = 'failed', response_status = 500,
        completed_at = clock_timestamp()
    where id = '66000000-0000-4000-8000-000000000002'$$,
  '55000', 'idempotency_identity_immutable',
  'identidade e request idempotentes são imutáveis'
);
select throws_ok(
  'update public.idempotency_keys set ' || assignment ||
    ', state = ''failed'', response_status = 500, response_body = ''{}''::jsonb,' ||
    ' completed_at = clock_timestamp()' ||
    ' where id = ''66000000-0000-4000-8000-000000000002''::uuid',
  '55000',
  'idempotency_identity_immutable',
  'idempotência rejeita mudança imutável de ' || field_name
)
from (values
  ('id', $assignment$id = '66000000-0000-4000-8000-000000000099'::uuid$assignment$),
  ('actor_user_id', $assignment$actor_user_id = '61000000-0000-4000-8000-000000000099'::uuid$assignment$),
  ('company_id', $assignment$company_id = '65000000-0000-4000-8000-000000000099'::uuid$assignment$),
  ('operation', $assignment$operation = 'auth.changed'$assignment$),
  ('key_hash', $assignment$key_hash = repeat('6', 64)$assignment$),
  ('request_hash', $assignment$request_hash = repeat('7', 64)$assignment$),
  ('expires_at', $assignment$expires_at = expires_at + interval '1 second'$assignment$),
  ('created_at', $assignment$created_at = created_at - interval '1 second'$assignment$)
) immutable_fields(field_name, assignment);
select throws_ok(
  $$update public.idempotency_keys
    set state = 'failed', response_status = 99,
        response_body = '{}', completed_at = clock_timestamp()
    where id = '66000000-0000-4000-8000-000000000002'$$,
  '23514', null,
  'status terminal permanece entre 100 e 599'
);
select throws_ok(
  $$update public.idempotency_keys
    set state = 'failed', response_status = 500,
        response_body = jsonb_build_object('body', repeat('x', 66000)),
        completed_at = clock_timestamp()
    where id = '66000000-0000-4000-8000-000000000002'$$,
  '23514', null,
  'response JSON terminal respeita teto de 64 KiB'
);
select results_eq(
  $$select state::text, response_status, response_body, completed_at
    from public.idempotency_keys
    where id = '66000000-0000-4000-8000-000000000002'$$,
  $$values ('processing'::text, null::integer, null::jsonb, null::timestamptz)$$,
  'transições idempotentes rejeitadas deixam zero resíduo parcial'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '1 hour'
);
update auth.sessions
set not_after = created_at + interval '2 hours'
where id = '62000000-0000-4000-8000-000000000001';
select is(
  private.register_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    false
  ),
  (select not_after from auth.sessions
   where id = '62000000-0000-4000-8000-000000000001'),
  'registro limita a expiração absoluta ao not_after autoritativo do Auth'
);
select is(
  private.register_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    false
  ),
  (select absolute_expires_at from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000001'),
  'retry pending idêntico retorna a expiração original sem extensão'
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001', true
  )$$,
  '23514', 'auth_session_replay_invalid',
  'retry não altera a política remember-me imutável'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select is(
  private.register_auth_session(
    '62000000-0000-4000-8000-000000000010',
    '61000000-0000-4000-8000-000000000001', true
  ),
  (select created_at + interval '30 days' from auth.sessions
   where id = '62000000-0000-4000-8000-000000000010'),
  'remember-me deriva exatamente 30 dias do created_at autoritativo'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000013',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select is(
  private.register_auth_session(
    '62000000-0000-4000-8000-000000000013',
    '61000000-0000-4000-8000-000000000001', false
  ),
  (select created_at + interval '8 hours' from auth.sessions
   where id = '62000000-0000-4000-8000-000000000013'),
  'sessão normal deriva exatamente 8 horas do created_at autoritativo'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000011',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000011',
    '61000000-0000-4000-8000-000000000099', false
  )$$,
  '23514', 'auth_session_mismatch',
  'registro rejeita user diferente do Auth autoritativo'
);
select is(
  (select count(*)::integer from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000011'),
  0,
  'mismatch de Auth não deixa controle residual'
);
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  false,
  'sessão pending nunca autoriza'
);
select lives_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000001',
    repeat('c', 64), repeat('d', 64),
    '{"rememberMe":false}'::jsonb
  )$$,
  'login aceita o único campo booleano rememberMe e ativa atomicamente'
);
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  true,
  'sessão ativa e autoritativa passa pelo assert'
);
update auth.sessions
set not_after = clock_timestamp() - interval '1 second'
where id = '62000000-0000-4000-8000-000000000001';
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  false,
  'assert respeita mudança posterior do not_after autoritativo do Auth'
);
update auth.sessions
set not_after = created_at + interval '2 hours'
where id = '62000000-0000-4000-8000-000000000001';
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  true,
  'assert volta a aceitar somente após Auth autoritativo válido'
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001', false
  )$$,
  '23514', 'auth_session_replay_invalid',
  'retry nunca rebaixa ou reativa uma sessão já ativa'
);
select results_eq(
  $$select audit_scope::text, audit_company_id
    from private.auth_session_controls
    where session_id = '62000000-0000-4000-8000-000000000001'$$,
  $$values ('platform'::text, null::uuid)$$,
  'ativação persiste o snapshot privado de escopo'
);
select throws_ok(
  $$update private.auth_session_controls
    set audit_scope = null
    where session_id = '62000000-0000-4000-8000-000000000001'$$,
  '55000',
  'auth_session_transition_invalid',
  'snapshot histórico é imutável depois da ativação'
);
select throws_ok(
  $$update private.auth_session_controls
    set activated_at = activated_at + interval '1 second'
    where session_id = '62000000-0000-4000-8000-000000000001'$$,
  '55000',
  'auth_session_transition_invalid',
  'activated_at é imutável depois da ativação'
);
select throws_ok(
  $$update private.auth_session_controls
    set last_seen_at = auth_created_at
    where session_id = '62000000-0000-4000-8000-000000000001'$$,
  '55000',
  'auth_session_transition_invalid',
  'last_seen_at é monotônico enquanto a sessão está ativa'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '9 hours'
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001', false
  )$$,
  '23514',
  'auth_session_expired',
  'registro rejeita a expiração absoluta já vencida'
);
select is(
  (select count(*)::integer from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000002'),
  0,
  'registro expirado não deixa controle residual'
);

update public.platform_roles
set is_active = false
where user_id = '61000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select private.revoke_sessions_and_write_logout(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000002',
    repeat('c', 64), repeat('d', 64)
  )$$,
  'logout usa o escopo histórico mesmo depois da identidade ficar inativa'
);
select results_eq(
  $$select action, scope::text, company_id
    from public.audit_events
    where actor_user_id = '61000000-0000-4000-8000-000000000001'
    order by occurred_at, id$$,
  $$values
    ('auth.login'::text, 'platform'::text, null::uuid),
    ('auth.logout'::text, 'platform'::text, null::uuid)$$,
  'logout preserva exatamente o escopo da ativação histórica'
);
select throws_ok(
  $$update public.audit_events set metadata = metadata$$,
  '55000',
  'append_only_table',
  'auditoria rejeita UPDATE com a mensagem estável'
);
select throws_ok(
  $$delete from public.audit_events$$,
  '55000', 'append_only_table',
  'auditoria rejeita DELETE com a mensagem estável'
);
select throws_ok(
  $$truncate table public.audit_events$$,
  '55000', 'append_only_table',
  'auditoria rejeita TRUNCATE com a mensagem estável'
);
select throws_ok(
  $$update public.security_events set metadata = metadata$$,
  '55000', 'append_only_table',
  'segurança rejeita UPDATE com a mensagem estável'
);
select throws_ok(
  $$delete from public.security_events$$,
  '55000', 'append_only_table',
  'segurança rejeita DELETE com a mensagem estável'
);
select throws_ok(
  $$truncate table public.security_events$$,
  '55000', 'append_only_table',
  'segurança rejeita TRUNCATE com a mensagem estável'
);
select results_eq(
  $$select
      (select count(*)::integer from public.audit_events),
      (select count(*)::integer from public.security_events)$$,
  $$values (2, 13)$$,
  'mutações append-only rejeitadas preservam todas as linhas'
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001', false
  )$$,
  '23514', 'auth_session_cutoff',
  'logout impede reativação tardia da sessão Auth anterior'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000001'),
  'revoked',
  'retry pós-logout não ressuscita controle revogado'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000012',
  '61000000-0000-4000-8000-000000000001',
  (select revoked_before from private.auth_user_session_cutoffs
   where user_id = '61000000-0000-4000-8000-000000000001')
);
select throws_ok(
  $$select private.register_auth_session(
    '62000000-0000-4000-8000-000000000012',
    '61000000-0000-4000-8000-000000000001', false
  )$$,
  '23514', 'auth_session_cutoff',
  'created_at exatamente no cutoff também é rejeitado'
);
select throws_ok(
  $$select private.revoke_auth_sessions(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001'
  )$$,
  '22023', 'auth_session_except_forbidden',
  'core owner-only rejeita todo except_session_id não-nulo'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000001',
  false
);
select throws_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000003',
    null,
    '63000000-0000-4000-8000-000000000003'
  )$$,
  '22023',
  'auth_fail_closed_input_invalid',
  'fail-closed rejeita reason_code nulo'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000003'),
  'pending',
  'fail-closed rejeitado não revoga nem deixa resíduo parcial'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000001',
  false
);
create temporary table cutoff_before_fail_closed on commit drop as
select revoked_before, updated_at
from private.auth_user_session_cutoffs
where user_id = '61000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000003',
    'UNSUPPORTED_REASON',
    '63000000-0000-4000-8000-000000000004'
  )$$,
  '22023', 'auth_fail_closed_input_invalid',
  'fail-closed rejeita reason fora da allowlist'
);
select lives_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000003',
    'AUTH_AUDIT_ACTIVATION_FAILED',
    '63000000-0000-4000-8000-000000000005'
  )$$,
  'fail-closed revoga a sessão exata com reason permitido'
);
select results_eq(
  $$select session_id, state::text
    from private.auth_session_controls
    where session_id in (
      '62000000-0000-4000-8000-000000000003',
      '62000000-0000-4000-8000-000000000004'
    )
    order by session_id$$,
  $$values
    ('62000000-0000-4000-8000-000000000003'::uuid, 'revoked'::text),
    ('62000000-0000-4000-8000-000000000004'::uuid, 'pending'::text)$$,
  'fail-closed não revoga outros dispositivos'
);
select results_eq(
  $$select cutoff.revoked_before, cutoff.updated_at
    from private.auth_user_session_cutoffs cutoff
    where cutoff.user_id = '61000000-0000-4000-8000-000000000001'$$,
  $$select revoked_before, updated_at from cutoff_before_fail_closed$$,
  'fail-closed não avança o cutoff global'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000001',
  false
);
update public.profiles
set must_change_password = true,
    temporary_password_expires_at = clock_timestamp() + interval '1 hour'
where user_id = '61000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000005',
    'TEMPORARY_PASSWORD_EXPIRED',
    '63000000-0000-4000-8000-000000000050'
  )$$,
  '23514', 'auth_temporary_password_expiry_unverified',
  'fail-closed não aceita classificar senha provisória ainda válida'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000005'),
  'pending',
  'classificação nonexpired rejeitada não altera a sessão'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000006',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000006',
  '61000000-0000-4000-8000-000000000001',
  false
);
update public.profiles
set is_active = false,
    temporary_password_expires_at = clock_timestamp() - interval '1 second'
where user_id = '61000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000006',
    'TEMPORARY_PASSWORD_EXPIRED',
    '63000000-0000-4000-8000-000000000051'
  )$$,
  '23514', 'auth_temporary_password_expiry_unverified',
  'fail-closed não classifica profile inativo como expiração válida'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000006'),
  'pending',
  'classificação de profile inativo rejeitada não altera a sessão'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000007',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000007',
  '61000000-0000-4000-8000-000000000001',
  false
);
update public.profiles
set is_active = true
where user_id = '61000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000099',
    '62000000-0000-4000-8000-000000000007',
    'TEMPORARY_PASSWORD_EXPIRED',
    '63000000-0000-4000-8000-000000000052'
  )$$,
  '23514', 'auth_temporary_password_expiry_unverified',
  'actor forjado não usa profile expirado de outro usuário'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000007'),
  'pending',
  'actor forjado não revoga a sessão legítima'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000008',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000008',
  '61000000-0000-4000-8000-000000000001',
  false
);
select lives_ok(
  $$select private.fail_closed_login_session(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000008',
    'TEMPORARY_PASSWORD_EXPIRED',
    '63000000-0000-4000-8000-000000000053'
  )$$,
  'fail-closed classifica e revoga senha provisória realmente expirada'
);
select is(
  (select state::text from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000008'),
  'revoked',
  'classificação expired revoga atomicamente a sessão exata'
);
update public.profiles
set must_change_password = false,
    temporary_password_expires_at = null
where user_id = '61000000-0000-4000-8000-000000000001';
select throws_ok(
  $$update private.auth_session_controls
    set updated_at = clock_timestamp()
    where session_id = '62000000-0000-4000-8000-000000000003'$$,
  '55000', 'auth_session_terminal',
  'estado revoked é terminal e totalmente imutável'
);

delete from auth.sessions
where id in (
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000003',
  '62000000-0000-4000-8000-000000000004',
  '62000000-0000-4000-8000-000000000005',
  '62000000-0000-4000-8000-000000000006',
  '62000000-0000-4000-8000-000000000007',
  '62000000-0000-4000-8000-000000000008',
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000011',
  '62000000-0000-4000-8000-000000000012',
  '62000000-0000-4000-8000-000000000013'
);
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  ),
  false,
  'assert nunca autoriza depois da exclusão autoritativa do Auth'
);

select test_helpers.create_auth_user(
  '61000000-0000-4000-8000-000000000002',
  'tenant-security@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '61000000-0000-4000-8000-000000000002',
  'tenant-security@example.test',
  'Tenant Security'
);
insert into public.companies (
  id, legal_name, cnpj_normalized, contact_email
) values (
  '67000000-0000-4000-8000-000000000001',
  'Tenant Security Company', '61000000000001',
  'tenant-company@example.test'
);
insert into public.company_memberships (
  id, company_id, user_id, role
) values (
  '68000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002',
  'member'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000002', false
);
select lives_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000020',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000020',
    repeat('a', 64), repeat('b', 64), '{}'
  )$$,
  'login tenant válido ativa e audita atomicamente'
);
select results_eq(
  $$select event.scope::text, event.company_id,
           control.audit_scope::text, control.audit_company_id,
           control.state::text
    from public.audit_events event
    join private.auth_session_controls control
      on control.user_id = event.actor_user_id
    where event.correlation_id = '63000000-0000-4000-8000-000000000020'$$,
  $$values (
    'tenant'::text,
    '67000000-0000-4000-8000-000000000001'::uuid,
    'tenant'::text,
    '67000000-0000-4000-8000-000000000001'::uuid,
    'active'::text
  )$$,
  'scope tenant e company são derivados e congelados exatamente'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000020',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000021', null, null, '{}'
  )$$,
  '23514', 'auth_login_session_invalid',
  'uma sessão já ativa não pode gerar segunda ativação/auditoria'
);
select throws_ok(
  $$select private.revoke_sessions_and_write_logout(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000020',
    '63000000-0000-4000-8000-000000000041', null, null
  )$$,
  '23514', 'auth_logout_session_invalid',
  'logout rejeita actor que não possui a sessão'
);
select results_eq(
  $$select state::text,
           (select count(*)::integer from public.audit_events
            where correlation_id = '63000000-0000-4000-8000-000000000041')
    from private.auth_session_controls
    where session_id = '62000000-0000-4000-8000-000000000020'$$,
  $$values ('active'::text, 0)$$,
  'logout rejeitado não revoga sessão nem grava audit residual'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000021',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000021',
  '61000000-0000-4000-8000-000000000002', true
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login.extra', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000022', null, null, '{}'
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado aceita somente action auth.login'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', gen_random_uuid(), 'success', null,
    '63000000-0000-4000-8000-000000000023', null, null, '{}'
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado exige resource_id nulo'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'failure', 'AUTH_PROVIDER_FAILURE',
    '63000000-0000-4000-8000-000000000024', null, null, '{}'
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado exige success e reason nulo'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000025', null, null,
    '{"rememberMe":false}'
  )$$,
  '23514', 'auth_login_session_invalid',
  'metadata rememberMe precisa coincidir com a policy imutável'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000026', null, null,
    '{"rememberMe":true,"unknown":1}'
  )$$,
  '22023', 'audit_event_invalid',
  'metadata autenticada rejeita chave desconhecida'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'profile', null, 'success', null,
    '63000000-0000-4000-8000-000000000036', null, null,
    '{"rememberMe":true}'
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado exige resource_type session'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000099',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000037', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_login_session_invalid',
  'writer autenticado rejeita session_id inexistente'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000038', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_login_session_invalid',
  'writer autenticado rejeita actor que não possui a sessão'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000039', repeat('A', 64), null,
    '{"rememberMe":true}'
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado rejeita hash fora da gramática'
);
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000040', null, null,
    jsonb_build_object('unknown', repeat('x', 17000))
  )$$,
  '22023', 'audit_event_invalid',
  'writer autenticado aplica teto de metadata de 16 KiB'
);
select results_eq(
  $$select state::text,
           (select count(*)::integer from public.audit_events
            where actor_user_id = '61000000-0000-4000-8000-000000000002')
    from private.auth_session_controls
    where session_id = '62000000-0000-4000-8000-000000000021'$$,
  $$values ('pending'::text, 1)$$,
  'audits rejeitados deixam sessão pending e zero eventos residuais'
);

update public.profiles
set is_active = false
where user_id = '61000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000027', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_profile_inactive',
  'profile inativo não pode ativar sessão'
);
update public.profiles
set is_active = true
where user_id = '61000000-0000-4000-8000-000000000002';
update public.company_memberships
set status = 'suspended', suspended_at = clock_timestamp(),
    suspension_reason = 'Security test suspension'
where id = '68000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000028', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_identity_invalid',
  'membership suspensa não define scope autorizador'
);
update public.company_memberships
set status = 'active', suspended_at = null,
    suspended_by = null, suspension_reason = null
where id = '68000000-0000-4000-8000-000000000001';
update public.companies
set status = 'archived', archived_at = clock_timestamp(),
    archived_by = '61000000-0000-4000-8000-000000000002'
where id = '67000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000029', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_identity_invalid',
  'empresa arquivada não define scope autorizador'
);
update public.companies
set status = 'active', archived_at = null, archived_by = null
where id = '67000000-0000-4000-8000-000000000001';
update public.profiles
set must_change_password = true,
    temporary_password_expires_at = clock_timestamp() - interval '1 second'
where user_id = '61000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000030', null, null,
    '{"rememberMe":true}'
  )$$,
  '23514', 'auth_profile_inactive',
  'senha temporária vencida não ativa sessão'
);
update public.profiles
set must_change_password = false, temporary_password_expires_at = null
where user_id = '61000000-0000-4000-8000-000000000002';
select lives_ok(
  $$select private.write_authenticated_audit_event(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    'auth.login', 'session', null, 'success', null,
    '63000000-0000-4000-8000-000000000031', null, null,
    '{"rememberMe":true}'
  )$$,
  'sessão pending ativa somente depois que todos os invariantes voltam a ser válidos'
);

select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000022',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000022',
  '61000000-0000-4000-8000-000000000002', false
);
select private.write_authenticated_audit_event(
  '61000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000022',
  'auth.login', 'session', null, 'success', null,
  '63000000-0000-4000-8000-000000000032', null, null, '{}'
);
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000021',
    '63000000-0000-4000-8000-000000000042'
  )$$,
  '22023', 'auth_reauthentication_input_invalid',
  'rotação exige session id nova e diferente'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000030',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp()
);
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000030',
    '63000000-0000-4000-8000-000000000043'
  )$$,
  '23514', 'auth_reauthentication_target_invalid',
  'rotação rejeita Auth session de outro usuário'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000031',
  '61000000-0000-4000-8000-000000000002',
  (select auth_created_at - interval '1 second'
   from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000021')
);
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000031',
    '63000000-0000-4000-8000-000000000044'
  )$$,
  '23514', 'auth_reauthentication_target_invalid',
  'rotação rejeita Auth session mais antiga'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000032',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select private.register_auth_session(
  '62000000-0000-4000-8000-000000000032',
  '61000000-0000-4000-8000-000000000002', false
);
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000032',
    '63000000-0000-4000-8000-000000000045'
  )$$,
  '23514', 'auth_reauthentication_target_invalid',
  'rotação rejeita target já registrada'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000033',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
update auth.sessions
set not_after = clock_timestamp() - interval '1 second'
where id = '62000000-0000-4000-8000-000000000033';
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000033',
    '63000000-0000-4000-8000-000000000046'
  )$$,
  '23514', 'auth_reauthentication_target_expired',
  'rotação rejeita not_after autoritativo já vencido'
);
select results_eq(
  $$select
      (select state::text from private.auth_session_controls
       where session_id = '62000000-0000-4000-8000-000000000021'),
      (select state::text from private.auth_session_controls
       where session_id = '62000000-0000-4000-8000-000000000022'),
      (select count(*)::integer from public.audit_events
       where action = 'auth.reauthenticated'),
      (select count(*)::integer from private.auth_session_controls
       where session_id in (
         '62000000-0000-4000-8000-000000000030',
         '62000000-0000-4000-8000-000000000031',
         '62000000-0000-4000-8000-000000000033'
       ))$$,
  $$values ('active'::text, 'active'::text, 0, 0)$$,
  'rotações rejeitadas preservam old/outro device e zero audit/control residual'
);
delete from auth.sessions
where id = '62000000-0000-4000-8000-000000000032';
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000023',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select lives_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000023',
    '63000000-0000-4000-8000-000000000033'
  )$$,
  'rotação usa Auth session nova, diferente, não usada e mais recente'
);
select results_eq(
  $$select session_id, state::text, remember_me,
           audit_scope::text, audit_company_id
    from private.auth_session_controls
    where session_id in (
      '62000000-0000-4000-8000-000000000020',
      '62000000-0000-4000-8000-000000000021',
      '62000000-0000-4000-8000-000000000022',
      '62000000-0000-4000-8000-000000000023'
    )
    order by session_id$$,
  $$values
    ('62000000-0000-4000-8000-000000000020'::uuid, 'active'::text, false,
      'tenant'::text, '67000000-0000-4000-8000-000000000001'::uuid),
    ('62000000-0000-4000-8000-000000000021'::uuid, 'revoked'::text, true,
      'tenant'::text, '67000000-0000-4000-8000-000000000001'::uuid),
    ('62000000-0000-4000-8000-000000000022'::uuid, 'active'::text, false,
      'tenant'::text, '67000000-0000-4000-8000-000000000001'::uuid),
    ('62000000-0000-4000-8000-000000000023'::uuid, 'active'::text, true,
      'tenant'::text, '67000000-0000-4000-8000-000000000001'::uuid)$$,
  'rotação preserva remember/scope e revoga somente a sessão substituída'
);
select results_eq(
  $$select action, scope::text, company_id, outcome::text,
           reason_code, metadata
    from public.audit_events
    where correlation_id = '63000000-0000-4000-8000-000000000033'$$,
  $$values (
    'auth.reauthenticated'::text, 'tenant'::text,
    '67000000-0000-4000-8000-000000000001'::uuid,
    'success'::text, null::text, '{}'::jsonb
  )$$,
  'rotação grava exatamente um audit auth.reauthenticated atômico'
);
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000021',
    '61000000-0000-4000-8000-000000000002'
  ),
  false,
  'assert rejeita a sessão substituída'
);
select is(
  private.assert_auth_session(
    '62000000-0000-4000-8000-000000000023',
    '61000000-0000-4000-8000-000000000002'
  ),
  true,
  'assert aceita a sessão nova ativa'
);
select test_helpers.create_auth_session(
  '62000000-0000-4000-8000-000000000024',
  '61000000-0000-4000-8000-000000000002',
  clock_timestamp()
);
select throws_ok(
  $$select private.rotate_app_session_after_reauthentication(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000021',
    '62000000-0000-4000-8000-000000000024',
    '63000000-0000-4000-8000-000000000034'
  )$$,
  '23514', 'auth_reauthentication_session_invalid',
  'segunda rotação perde para o único winner e não reutiliza old revogada'
);
select is(
  (select count(*)::integer from private.auth_session_controls
   where session_id = '62000000-0000-4000-8000-000000000024'),
  0,
  'rotação perdedora não deixa controle novo residual'
);
select lives_ok(
  $$select private.revoke_sessions_and_write_logout(
    '61000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000023',
    '63000000-0000-4000-8000-000000000035', null, null
  )$$,
  'logout da sessão rotacionada conclui com snapshot histórico'
);
select results_eq(
  $$select state::text, count(*)::integer
    from private.auth_session_controls
    where user_id = '61000000-0000-4000-8000-000000000002'
    group by state
    order by state::text$$,
  $$values ('revoked'::text, 4)$$,
  'logout revoga todas as sessões do usuário sem survivor ambíguo'
);
select results_eq(
  $$select action, scope::text, company_id, outcome::text
    from public.audit_events
    where correlation_id = '63000000-0000-4000-8000-000000000035'$$,
  $$values (
    'auth.logout'::text, 'tenant'::text,
    '67000000-0000-4000-8000-000000000001'::uuid, 'success'::text
  )$$,
  'logout pós-rotação grava audit tenant exato'
);

select * from finish();
rollback;
