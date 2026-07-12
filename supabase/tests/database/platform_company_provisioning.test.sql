begin;
\ir helpers/fixtures.inc

select no_plan();

select has_table('private'::name, 'brazil_timezone_allowlist'::name);
select results_eq(
  $$select column_name::text collate "default",
           data_type::text collate "default",
           is_nullable::text collate "default"
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'brazil_timezone_allowlist'
    order by ordinal_position$$,
  $$values
    ('input_name','text','NO'),
    ('canonical_name','text','NO'),
    ('catalog_version','integer','NO'),
    ('is_alias','boolean','NO')$$,
  'timezone allowlist exposes only its versioned canonical mapping'
);
select results_eq(
  $$select owner.rolname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_roles owner on owner.oid = class.relowner
    where namespace.nspname = 'private'
      and class.relname = 'brazil_timezone_allowlist'$$,
  $$values ('postgres',true,true)$$,
  'timezone allowlist is postgres-owned with forced RLS'
);
select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'private'
      and tablename = 'brazil_timezone_allowlist'$$,
  'timezone allowlist has no application policy'
);
select is_empty(
  $$select role_name || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(
      role_name,
      'private.brazil_timezone_allowlist',
      privilege
    )$$,
  'no application role can read or mutate the timezone catalog'
);
select results_eq(
  $$select input_name, canonical_name, catalog_version, is_alias
    from private.brazil_timezone_allowlist
    order by input_name$$,
  $$values
    ('America/Araguaina','America/Araguaina',1,false),
    ('America/Bahia','America/Bahia',1,false),
    ('America/Belem','America/Belem',1,false),
    ('America/Boa_Vista','America/Boa_Vista',1,false),
    ('America/Campo_Grande','America/Campo_Grande',1,false),
    ('America/Cuiaba','America/Cuiaba',1,false),
    ('America/Fortaleza','America/Fortaleza',1,false),
    ('America/Maceio','America/Maceio',1,false),
    ('America/Manaus','America/Manaus',1,false),
    ('America/Noronha','America/Noronha',1,false),
    ('America/Porto_Velho','America/Porto_Velho',1,false),
    ('America/Recife','America/Recife',1,false),
    ('America/Rio_Branco','America/Rio_Branco',1,false),
    ('America/Santarem','America/Santarem',1,false),
    ('America/Sao_Paulo','America/Sao_Paulo',1,false),
    ('Brazil/Acre','America/Rio_Branco',1,true),
    ('Brazil/DeNoronha','America/Noronha',1,true),
    ('Brazil/East','America/Sao_Paulo',1,true),
    ('Brazil/West','America/Manaus',1,true)$$,
  'timezone catalog contains exactly fifteen canonical zones and four aliases'
);
select results_eq(
  $$select bucket, attempt_limit, window_seconds, block_seconds, clear_on_success
    from private.rate_limit_policies
    where bucket = 'platform-company-create'$$,
  $$values ('platform-company-create',10,3600,3600,false)$$,
  'company provisioning is limited to ten attempts per hour per Super Admin'
);

select has_function(
  'private'::name,
  'resolve_brazil_timezone'::name,
  array['text']
);
select has_function(
  'private'::name,
  'internal_reserve_company_provisioning'::name,
  array['uuid','uuid','text','text','text','uuid']
);
select has_function(
  'private'::name,
  'internal_mark_provisioning_auth_created'::name,
  array['uuid','uuid','uuid','uuid']
);
select has_function(
  'private'::name,
  'internal_commit_company_provisioning'::name,
  array[
    'uuid','uuid','uuid','uuid','uuid','text','text','text',
    'citext','text','text','text','citext',
    'public.module_key[]','uuid'
  ]
);
select has_function(
  'private'::name,
  'internal_commit_company_provisioning'::name,
  array[
    'uuid','uuid','uuid','uuid','uuid','text','text','text',
    'text','text','text','text','text','public.module_key[]','uuid'
  ]
);
select has_function(
  'private'::name,
  'internal_mark_provisioning_compensation'::name,
  array['uuid','uuid','uuid','public.provisioning_status','text']
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
        'internal_commit_company_provisioning',
        'internal_mark_provisioning_auth_created',
        'internal_mark_provisioning_compensation',
        'internal_reserve_company_provisioning',
        'resolve_brazil_timezone'
      )
    order by function.proname,
             pg_get_function_identity_arguments(function.oid)$$,
  $$values
    ('internal_commit_company_provisioning',
      'p_operation_id uuid, p_actor_user_id uuid, p_session_id uuid, p_auth_user_id uuid, p_company_id uuid, p_legal_name text, p_trade_name text, p_cnpj_normalized text, p_contact_email citext, p_contact_phone text, p_timezone text, p_admin_display_name text, p_admin_email citext, p_modules module_key[], p_correlation_id uuid',
      'jsonb','postgres',true,true),
    ('internal_commit_company_provisioning',
      'p_operation_id uuid, p_actor_user_id uuid, p_session_id uuid, p_auth_user_id uuid, p_company_id uuid, p_legal_name text, p_trade_name text, p_cnpj_normalized text, p_contact_email text, p_contact_phone text, p_timezone text, p_admin_display_name text, p_admin_email text, p_modules module_key[], p_correlation_id uuid',
      'jsonb','postgres',true,true),
    ('internal_mark_provisioning_auth_created',
      'p_operation_id uuid, p_actor_user_id uuid, p_session_id uuid, p_auth_user_id uuid',
      'void','postgres',true,true),
    ('internal_mark_provisioning_compensation',
      'p_operation_id uuid, p_actor_user_id uuid, p_session_id uuid, p_status provisioning_status, p_error_code text',
      'void','postgres',true,true),
    ('internal_reserve_company_provisioning',
      'p_actor_user_id uuid, p_session_id uuid, p_idempotency_key text, p_request_hash text, p_subject_email_hash text, p_correlation_id uuid',
      'provisioning_operations','postgres',true,true),
    ('resolve_brazil_timezone','p_timezone text','text','postgres',true,true)$$,
  'provisioning routines freeze signatures, owners, definer mode and search paths'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'resolve_brazil_timezone'
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'timezone resolver remains owner-only'
);
select results_eq(
  $$select function.oid::regprocedure::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'internal_commit_company_provisioning',
        'internal_mark_provisioning_auth_created',
        'internal_mark_provisioning_compensation',
        'internal_reserve_company_provisioning'
      )
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.oid::regprocedure::text$$,
  $$values
    ('private.internal_commit_company_provisioning(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,module_key[],uuid)'),
    ('private.internal_mark_provisioning_auth_created(uuid,uuid,uuid,uuid)'),
    ('private.internal_mark_provisioning_compensation(uuid,uuid,uuid,provisioning_status,text)'),
    ('private.internal_reserve_company_provisioning(uuid,uuid,text,text,text,uuid)')$$,
  'BFF receives exactly the four provisioning boundaries'
);
select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'internal_commit_company_provisioning',
        'internal_mark_provisioning_auth_created',
        'internal_mark_provisioning_compensation',
        'internal_reserve_company_provisioning'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'PUBLIC, API roles and service role cannot execute provisioning boundaries'
);
select ok(
  has_type_privilege('axsys_bff', 'public.module_key', 'USAGE')
  and has_type_privilege('axsys_bff', 'public.company_status', 'USAGE')
  and has_type_privilege('axsys_bff', 'public.provisioning_status', 'USAGE')
  and not has_type_privilege('service_role', 'public.module_key', 'USAGE')
  and not has_type_privilege('service_role', 'public.company_status', 'USAGE')
  and not has_type_privilege('service_role', 'public.provisioning_status', 'USAGE'),
  'BFF receives only the enum usage needed by typed server boundaries'
);
select ok(
  has_schema_privilege('axsys_bff', 'public', 'USAGE')
  and not has_schema_privilege('axsys_bff', 'extensions', 'USAGE')
  and not has_schema_privilege('axsys_bff', 'public', 'CREATE')
  and not has_schema_privilege('axsys_bff', 'extensions', 'CREATE'),
  'BFF resolves public types without extension or schema creation rights'
);
select is_empty(
  $$select namespace.nspname, class.relname, grant_item.privilege_type
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(
      coalesce(class.relacl, acldefault(
        case when class.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
        class.relowner
      ))
    ) grant_item
    join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname in ('public','extensions')
      and class.relkind in ('r','p','v','m','f','S')
      and grantee.rolname = 'axsys_bff'$$,
  'BFF receives no direct table, view or sequence ACL while resolving types'
);
select is_empty(
  $$select namespace.nspname, function.proname, grant_item.privilege_type
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    cross join lateral aclexplode(
      coalesce(function.proacl, acldefault('f', function.proowner))
    ) grant_item
    join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname in ('public','extensions')
      and grantee.rolname = 'axsys_bff'$$,
  'BFF receives no direct public or extension function ACL'
);
select is_empty(
  $$select column_name
    from information_schema.columns
    where (table_schema, table_name) in (
      ('public','provisioning_operations'),
      ('private','brazil_timezone_allowlist')
    )
      and column_name ~* '(password|secret|payload|email$|cnpj|document)'$$,
  'provisioning persistence contains no password, secret or raw PII column'
);

select results_eq(
  $$select input_name, private.resolve_brazil_timezone(input_name)
    from (values
      ('Brazil/Acre'),('Brazil/DeNoronha'),('Brazil/East'),('Brazil/West')
    ) aliases(input_name)
    order by input_name$$,
  $$values
    ('Brazil/Acre','America/Rio_Branco'),
    ('Brazil/DeNoronha','America/Noronha'),
    ('Brazil/East','America/Sao_Paulo'),
    ('Brazil/West','America/Manaus')$$,
  'timezone resolver maps every approved alias to its canonical name'
);
select throws_ok(
  $$select private.resolve_brazil_timezone('america/fortaleza')$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'timezone matching is case-sensitive'
);
select throws_ok(
  $$select private.resolve_brazil_timezone('BRT')$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'timezone abbreviations are rejected'
);
select throws_ok(
  $$select private.resolve_brazil_timezone('EST5EDT')$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'POSIX timezone identifiers are rejected'
);
select throws_ok(
  $$select private.resolve_brazil_timezone('America/New_York')$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'non-Brazilian timezone identifiers are rejected'
);

create function test_helpers.activate_provisioning_session(
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
    pg_catalog.statement_timestamp() - interval '1 minute'
  );
  perform private.register_auth_session(p_session_id, p_user_id, false);
  perform private.write_authenticated_audit_event(
    p_user_id,p_session_id,'auth.login','session',null,'success',null,
    p_correlation_id,null,null,'{"rememberMe":false}'::jsonb
  );
end;
$$;

select test_helpers.create_auth_user(
  '21000000-0000-4000-8000-000000000101',
  'platform-provisioner-a@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '21000000-0000-4000-8000-000000000101',
  'platform-provisioner-a@example.test',
  'Platform Provisioner A'
);
insert into public.platform_roles(user_id,role,is_active)
values ('21000000-0000-4000-8000-000000000101','super_admin',true);
select test_helpers.activate_provisioning_session(
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '81000000-0000-4000-8000-000000000101'
);

select test_helpers.create_auth_user(
  '21000000-0000-4000-8000-000000000102',
  'platform-provisioner-b@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '21000000-0000-4000-8000-000000000102',
  'platform-provisioner-b@example.test',
  'Platform Provisioner B'
);
insert into public.platform_roles(user_id,role,is_active)
values ('21000000-0000-4000-8000-000000000102','super_admin',true);
select test_helpers.activate_provisioning_session(
  '21000000-0000-4000-8000-000000000102',
  '91000000-0000-4000-8000-000000000102',
  '81000000-0000-4000-8000-000000000102'
);

select test_helpers.create_company_user(
  '21000000-0000-4000-8000-000000000103',
  'tenant-provisioner@example.test',
  '31000000-0000-4000-8000-000000000103',
  '41000000-0000-4000-8000-000000000103',
  'company_admin',
  '{}'::public.module_key[]
);
select test_helpers.activate_provisioning_session(
  '21000000-0000-4000-8000-000000000103',
  '91000000-0000-4000-8000-000000000103',
  '81000000-0000-4000-8000-000000000103'
);

select test_helpers.create_auth_user(
  '22000000-0000-4000-8000-000000000101',
  'first-admin@example.test'
);
select test_helpers.create_auth_user(
  '22000000-0000-4000-8000-000000000102',
  'compensated-admin@example.test'
);
select test_helpers.create_auth_user(
  '22000000-0000-4000-8000-000000000103',
  'pending-compensation@example.test'
);

create temporary table provisioning_operation_refs(
  label text primary key,
  operation_id uuid not null unique
);
create temporary table provisioning_commit_results(
  label text primary key,
  result jsonb not null
);
grant select, insert on provisioning_operation_refs,
  provisioning_commit_results to axsys_bff;
grant axsys_bff to postgres;
grant usage on schema extensions to axsys_bff, service_role;
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
    execute format('grant execute on function %s to axsys_bff, service_role',
      pgtap_function.signature);
  end loop;
end
$$;

set local role axsys_bff;
insert into provisioning_operation_refs(label,operation_id)
select 'primary', operation.id
from private.internal_reserve_company_provisioning(
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  repeat('a',64),repeat('b',64),repeat('c',64),
  '82000000-0000-4000-8000-000000000101'
) operation;
select results_eq(
  $$select id, status::text, auth_user_id, company_id, last_error_code
    from private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      repeat('a',64),repeat('b',64),repeat('c',64),
      '82000000-0000-4000-8000-000000000199'
    )$$,
  $$select operation_id,'reserved',null::uuid,null::uuid,null::text
    from provisioning_operation_refs where label='primary'$$,
  'same idempotency key and request hash replay the original reservation'
);
select throws_ok(
  $$select private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      repeat('a',64),repeat('d',64),repeat('c',64),
      '82000000-0000-4000-8000-000000000102'
    )$$,
  'P0001','AXSYS_IDEMPOTENCY_KEY_REUSED',
  'same idempotency key with another request hash is rejected'
);
select throws_ok(
  $$select private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      'raw-key',repeat('d',64),repeat('e',64),
      '82000000-0000-4000-8000-000000000103'
    )$$,
  '22023','AXSYS_PROVISIONING_INPUT_INVALID',
  'raw idempotency keys never enter the provisioning journal'
);
select throws_ok(
  $$select private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000199',
      repeat('d',64),repeat('e',64),repeat('f',64),
      '82000000-0000-4000-8000-000000000104'
    )$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'an unregistered session cannot reserve provisioning'
);
select throws_ok(
  $$select private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000103',
      '91000000-0000-4000-8000-000000000103',
      repeat('d',64),repeat('e',64),repeat('f',64),
      '82000000-0000-4000-8000-000000000105'
    )$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'a tenant-scoped administrator cannot invoke platform provisioning'
);
reset role;

set local role service_role;
select throws_ok(
  $$select private.internal_reserve_company_provisioning(
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      repeat('d',64),repeat('e',64),repeat('f',64),
      '82000000-0000-4000-8000-000000000106'
    )$$,
  '42501',null,
  'service role is denied before executing provisioning logic'
);
reset role;

select is(
  (select count(*) from public.provisioning_operations
    where actor_user_id='21000000-0000-4000-8000-000000000101'
      and idempotency_key=repeat('a',64)),
  1::bigint,
  'reservation replay creates exactly one journal row'
);

set local role axsys_bff;
select private.internal_mark_provisioning_auth_created(
  (select operation_id from provisioning_operation_refs where label='primary'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000101'
);
select private.internal_mark_provisioning_auth_created(
  (select operation_id from provisioning_operation_refs where label='primary'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000101'
);
select throws_ok(
  $$select private.internal_commit_company_provisioning(
      (select operation_id from provisioning_operation_refs where label='primary'),
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      '22000000-0000-4000-8000-000000000101',
      '32000000-0000-4000-8000-000000000109',
      'Empresa Provisionada Ltda.','Empresa Provisionada','11222333000181',
      'contato-provisionada@example.test',null,'America/Fortaleza',
      'Primeira Administradora','another-admin@example.test',
      array['administrative','financial']::public.module_key[],
      '82000000-0000-4000-8000-000000000101'
    )$$,
  '23514','AXSYS_PROVISIONING_AUTH_USER_INVALID',
  'commit cannot bind an Auth identity whose confirmed email differs'
);
select throws_ok(
  $$select private.internal_mark_provisioning_auth_created(
      (select operation_id from provisioning_operation_refs where label='primary'),
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      '22000000-0000-4000-8000-000000000102'
    )$$,
  '23514','AXSYS_PROVISIONING_OPERATION_INVALID',
  'auth-created replay cannot substitute another Auth user'
);
select throws_ok(
  $$select private.internal_commit_company_provisioning(
      (select operation_id from provisioning_operation_refs where label='primary'),
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      '22000000-0000-4000-8000-000000000101',
      '32000000-0000-4000-8000-000000000101',
      'Empresa Provisionada Ltda.','Empresa Provisionada','11222333000181',
      'contato-provisionada@example.test',null,'america/fortaleza',
      'Primeira Administradora','first-admin@example.test',
      array['administrative','financial']::public.module_key[],
      '82000000-0000-4000-8000-000000000101'
    )$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'invalid timezone aborts before any company row exists'
);
reset role;
select is_empty(
  $$select id from public.companies
    where id='32000000-0000-4000-8000-000000000101'$$,
  'invalid timezone leaves no partial company state'
);
select results_eq(
  $$select status::text, auth_user_id, company_id
    from public.provisioning_operations
    where id=(select operation_id from provisioning_operation_refs where label='primary')$$,
  $$values ('auth_created','22000000-0000-4000-8000-000000000101'::uuid,null::uuid)$$,
  'failed commit validation leaves the operation resumable at auth-created'
);

set local role axsys_bff;
insert into provisioning_commit_results(label,result)
select 'primary', private.internal_commit_company_provisioning(
  (select operation_id from provisioning_operation_refs where label='primary'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000101',
  '32000000-0000-4000-8000-000000000101',
  'Empresa Provisionada Ltda.','Empresa Provisionada','11222333000181',
  'contato-provisionada@example.test',null,'Brazil/East',
  'Primeira Administradora','first-admin@example.test',
  array['administrative','financial']::public.module_key[],
  '82000000-0000-4000-8000-000000000199'
);
reset role;

select results_eq(
  $$select company.id, company.status::text, company.timezone,
           company.cnpj_normalized, company.contact_email::text,
           company.contact_phone, company.version
    from public.companies company
    where company.id='32000000-0000-4000-8000-000000000101'$$,
  $$values (
    '32000000-0000-4000-8000-000000000101'::uuid,'active',
    'America/Sao_Paulo','11222333000181','contato-provisionada@example.test',
    null::text,1::bigint
  )$$,
  'commit persists an active company with canonical timezone'
);
select results_eq(
  $$select profile.preferred_theme::text, profile.must_change_password,
           profile.temporary_password_expires_at
             > pg_catalog.clock_timestamp() + interval '23 hours 59 minutes',
           profile.temporary_password_expires_at
             < pg_catalog.clock_timestamp() + interval '24 hours 1 minute',
           profile.password_changed_at, profile.is_active
    from public.profiles profile
    where profile.user_id='22000000-0000-4000-8000-000000000101'$$,
  $$values ('dark',true,true,true,null::timestamptz,true)$$,
  'first admin receives dark theme and an exact twenty-four-hour provisional state'
);
select results_eq(
  $$select membership.id, membership.role::text, membership.status::text,
           membership.created_by, array_agg(module.module::text order by module.module)
    from public.company_memberships membership
    join public.member_modules module on module.membership_id=membership.id
    where membership.company_id='32000000-0000-4000-8000-000000000101'
      and membership.user_id='22000000-0000-4000-8000-000000000101'
    group by membership.id$$,
  $$select (result->'membership'->>'id')::uuid,'company_admin','active',
           '21000000-0000-4000-8000-000000000101'::uuid,
           array['administrative','financial']::text[]
    from provisioning_commit_results where label='primary'$$,
  'commit persists the first active company admin and exact module set'
);
select results_eq(
  $$select settings.tax_rate, settings.version, settings.updated_by,
           usage.quota_bytes, usage.used_bytes, usage.reserved_bytes
    from public.company_settings settings
    join private.company_storage_usage usage
      on usage.company_id=settings.company_id
    where settings.company_id='32000000-0000-4000-8000-000000000101'$$,
  $$values (
    0::numeric,1::bigint,'21000000-0000-4000-8000-000000000101'::uuid,
    5368709120::bigint,0::bigint,0::bigint
  )$$,
  'commit creates empty company settings and initialized storage quota'
);
select results_eq(
  $$select operation.status::text, operation.company_id,
           operation.auth_user_id, operation.last_error_code,
           audit.scope::text, audit.action, audit.resource_type,
           audit.resource_id, audit.outcome::text, audit.metadata
    from public.provisioning_operations operation
    join public.audit_events audit
      on audit.correlation_id=operation.correlation_id
     and audit.action='company.created'
    where operation.id=(
      select operation_id from provisioning_operation_refs where label='primary'
    )$$,
  $$values (
    'committed','32000000-0000-4000-8000-000000000101'::uuid,
    '22000000-0000-4000-8000-000000000101'::uuid,null::text,
    'platform','company.created','company',
    '32000000-0000-4000-8000-000000000101'::uuid,'success',
    '{"firstAdminUserId":"22000000-0000-4000-8000-000000000101","moduleCount":2}'::jsonb
  )$$,
  'commit atomically closes the operation and writes the redacted platform audit'
);
select results_eq(
  $$select array(select jsonb_object_keys(result) order by 1),
           array(select jsonb_object_keys(result->'company') order by 1),
           array(select jsonb_object_keys(result->'membership') order by 1),
           result->'modules',
           result::text !~* '(password|cnpj|email|contact)'
    from provisioning_commit_results where label='primary'$$,
  $$values (
    array['company','membership','modules']::text[],
    array['id','status']::text[],
    array['id','role']::text[],
    '["administrative","financial"]'::jsonb,true
  )$$,
  'commit JSON is exact, minimal and contains no password or raw PII'
);

set local role axsys_bff;
select results_eq(
  $$select private.internal_commit_company_provisioning(
      (select operation_id from provisioning_operation_refs where label='primary'),
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      '22000000-0000-4000-8000-000000000101',
      '32000000-0000-4000-8000-000000000199',
      'Empresa Provisionada Ltda.','Empresa Provisionada','11222333000181',
      'contato-provisionada@example.test',null,'Brazil/East',
      'Primeira Administradora','first-admin@example.test',
      array['administrative','financial']::public.module_key[],
      '82000000-0000-4000-8000-000000000198'
    )$$,
  $$select result from provisioning_commit_results where label='primary'$$,
  'committed replay returns the persisted result without another write'
);
reset role;
select results_eq(
  $$select
      (select count(*) from public.companies
       where id='32000000-0000-4000-8000-000000000101'),
      (select count(*) from public.company_memberships
       where company_id='32000000-0000-4000-8000-000000000101'),
      (select count(*) from public.audit_events
       where correlation_id='82000000-0000-4000-8000-000000000101'
         and action='company.created')$$,
  $$values (1::bigint,1::bigint,1::bigint)$$,
  'commit replay creates no duplicate company, membership or audit'
);
select is_empty(
  $$select id from public.companies
    where id = '32000000-0000-4000-8000-000000000199'$$,
  'committed replay ignores a newly proposed company UUID'
);

set local role axsys_bff;
insert into provisioning_operation_refs(label,operation_id)
select 'compensated', operation.id
from private.internal_reserve_company_provisioning(
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  repeat('1',64),repeat('2',64),repeat('3',64),
  '82000000-0000-4000-8000-000000000111'
) operation;
select private.internal_mark_provisioning_auth_created(
  (select operation_id from provisioning_operation_refs where label='compensated'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000102'
);
select private.internal_mark_provisioning_compensation(
  (select operation_id from provisioning_operation_refs where label='compensated'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  'compensated'::public.provisioning_status,'DB_COMMIT_FAILED'
);
select private.internal_mark_provisioning_compensation(
  (select operation_id from provisioning_operation_refs where label='compensated'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  'compensated'::public.provisioning_status,'DB_COMMIT_FAILED'
);

insert into provisioning_operation_refs(label,operation_id)
select 'compensation-required', operation.id
from private.internal_reserve_company_provisioning(
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  repeat('4',64),repeat('5',64),repeat('6',64),
  '82000000-0000-4000-8000-000000000112'
) operation;
select private.internal_mark_provisioning_auth_created(
  (select operation_id from provisioning_operation_refs where label='compensation-required'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  '22000000-0000-4000-8000-000000000103'
);
select private.internal_mark_provisioning_compensation(
  (select operation_id from provisioning_operation_refs where label='compensation-required'),
  '21000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000101',
  'compensation_required'::public.provisioning_status,'AUTH_DELETE_FAILED'
);
select throws_ok(
  $$select private.internal_mark_provisioning_compensation(
      (select operation_id from provisioning_operation_refs where label='compensation-required'),
      '21000000-0000-4000-8000-000000000101',
      '91000000-0000-4000-8000-000000000101',
      'committed'::public.provisioning_status,'DB_COMMIT_FAILED'
    )$$,
  '22023','AXSYS_PROVISIONING_COMPENSATION_INVALID',
  'compensation boundary rejects non-compensation statuses'
);
reset role;

select results_eq(
  $$select reference.label, operation.status::text,
           operation.auth_user_id, operation.company_id,
           operation.last_error_code
    from provisioning_operation_refs reference
    join public.provisioning_operations operation
      on operation.id=reference.operation_id
    where reference.label in ('compensated','compensation-required')
    order by reference.label$$,
  $$values
    ('compensated','compensated',
      '22000000-0000-4000-8000-000000000102'::uuid,null::uuid,
      'DB_COMMIT_FAILED'),
    ('compensation-required','compensation_required',
      '22000000-0000-4000-8000-000000000103'::uuid,null::uuid,
      'AUTH_DELETE_FAILED')$$,
  'compensation transitions preserve only hashed journal data and allowlisted errors'
);

select is_empty(
  $$select operation.id
    from public.provisioning_operations operation
    where to_jsonb(operation)::text ~* '(temporary.?password|first-admin@example|Empresa Provisionada|11222333000181)'$$,
  'journal rows contain no password, email, name or CNPJ plaintext'
);
select is_empty(
  $$select audit.id
    from public.audit_events audit
    where audit.correlation_id in (
      '82000000-0000-4000-8000-000000000101',
      '82000000-0000-4000-8000-000000000111',
      '82000000-0000-4000-8000-000000000112'
    )
      and audit::text ~* '(password|first-admin@example|11222333000181)'$$,
  'provisioning audit data contains no password, email or CNPJ plaintext'
);

select * from finish();
rollback;
