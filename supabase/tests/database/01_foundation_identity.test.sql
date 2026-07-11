begin;
select no_plan();

select has_type('public'::name, 'company_status'::name);
select has_type('public'::name, 'platform_role'::name);
select has_type('public'::name, 'membership_role'::name);
select has_type('public'::name, 'membership_status'::name);
select has_type('public'::name, 'module_key'::name);
select has_type('public'::name, 'theme_preference'::name);
select has_table('public'::name, 'profiles'::name);
select has_table('public'::name, 'platform_roles'::name);
select has_table('public'::name, 'companies'::name);
select has_table('public'::name, 'company_memberships'::name);
select has_table('public'::name, 'member_modules'::name);
select results_eq(
  $$select relname::text collate "default" from pg_class join pg_namespace n on n.oid = relnamespace
    where n.nspname = 'public'
      and relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and relrowsecurity
      and relforcerowsecurity
    order by relname$$,
  $$values ('companies'),('company_memberships'),('member_modules'),('platform_roles'),('profiles')$$,
  'todas as tabelas base habilitam e forçam RLS'
);
select col_is_unique(
  'public'::name,
  'company_memberships'::name,
  'user_id'::name
);
select results_eq(
  $$select type.typname::text collate "default",
           enum.enumlabel::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_enum enum on enum.enumtypid = type.oid
    where namespace.nspname = 'public'
      and type.typname in (
        'company_status','platform_role','membership_role',
        'membership_status','module_key','theme_preference'
      )
    order by type.typname, enum.enumsortorder$$,
  $$values
    ('company_status','active'),('company_status','archived'),
    ('membership_role','company_admin'),('membership_role','member'),
    ('membership_status','active'),('membership_status','suspended'),
    ('module_key','administrative'),('module_key','financial'),('module_key','certificates'),
    ('platform_role','super_admin'),
    ('theme_preference','dark'),('theme_preference','light')$$,
  'enums expõem somente os labels e a ordem contratados'
);
select results_eq(
  $$select table_name::text collate "default",
           string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('profiles','platform_roles','companies','company_memberships','member_modules')
    group by table_name
    order by table_name$$,
  $$values
    ('companies','id,legal_name,trade_name,cnpj_normalized,contact_email,contact_phone,timezone,status,archived_at,archived_by,version,created_at,updated_at'),
    ('company_memberships','id,company_id,user_id,role,status,created_by,suspended_at,suspended_by,suspension_reason,version,created_at,updated_at'),
    ('member_modules','company_id,membership_id,module,granted_by,created_at'),
    ('platform_roles','user_id,role,is_active,created_by,created_at'),
    ('profiles','user_id,email,display_name,preferred_theme,must_change_password,temporary_password_expires_at,password_changed_at,is_active,version,created_at,updated_at')$$,
  'tabelas base expõem exatamente as colunas contratadas'
);
select results_eq(
  $$select class.relname::text collate "default",
           table_constraint.conname::text collate "default"
    from pg_constraint table_constraint
    join pg_class class on class.oid = table_constraint.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
    order by class.relname, table_constraint.conname$$,
  $$values
    ('companies','companies_archive_state'),
    ('companies','companies_archived_by_fkey'),
    ('companies','companies_cnpj_format'),
    ('companies','companies_cnpj_normalized_key'),
    ('companies','companies_email_normalized'),
    ('companies','companies_legal_name_length'),
    ('companies','companies_pkey'),
    ('companies','companies_version_check'),
    ('company_memberships','company_memberships_company_id_fkey'),
    ('company_memberships','company_memberships_company_id_id_key'),
    ('company_memberships','company_memberships_company_id_user_id_key'),
    ('company_memberships','company_memberships_created_by_fkey'),
    ('company_memberships','company_memberships_pkey'),
    ('company_memberships','company_memberships_suspended_by_fkey'),
    ('company_memberships','company_memberships_user_id_fkey'),
    ('company_memberships','company_memberships_user_id_key'),
    ('company_memberships','company_memberships_version_check'),
    ('company_memberships','memberships_suspension_state'),
    ('member_modules','member_modules_company_id_membership_id_fkey'),
    ('member_modules','member_modules_granted_by_fkey'),
    ('member_modules','member_modules_pkey'),
    ('platform_roles','platform_roles_created_by_fkey'),
    ('platform_roles','platform_roles_pkey'),
    ('platform_roles','platform_roles_user_id_fkey'),
    ('profiles','profiles_display_name_length'),
    ('profiles','profiles_email_key'),
    ('profiles','profiles_email_normalized'),
    ('profiles','profiles_pkey'),
    ('profiles','profiles_temporary_password_state'),
    ('profiles','profiles_user_id_fkey'),
    ('profiles','profiles_version_check')$$,
  'constraints essenciais existem com nomes estáveis'
);
select results_eq(
  $$select indexname::text collate "default"
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and indexname in (
        'companies_archived_by_idx','companies_cnpj_normalized_key',
        'companies_pkey','companies_status_idx',
        'company_memberships_company_id_id_key','company_memberships_company_id_user_id_key',
        'company_memberships_pkey','company_memberships_user_id_key',
        'member_modules_company_membership_idx','member_modules_company_module_idx',
        'member_modules_granted_by_idx','member_modules_pkey',
        'memberships_company_status_idx','memberships_created_by_idx',
        'memberships_suspended_by_idx','memberships_user_status_idx',
        'platform_roles_created_by_idx','platform_roles_pkey',
        'profiles_email_key','profiles_pkey'
      )
    order by indexname$$,
  $$values
    ('companies_archived_by_idx'),
    ('companies_cnpj_normalized_key'),
    ('companies_pkey'),
    ('companies_status_idx'),
    ('company_memberships_company_id_id_key'),
    ('company_memberships_company_id_user_id_key'),
    ('company_memberships_pkey'),
    ('company_memberships_user_id_key'),
    ('member_modules_company_membership_idx'),
    ('member_modules_company_module_idx'),
    ('member_modules_granted_by_idx'),
    ('member_modules_pkey'),
    ('memberships_company_status_idx'),
    ('memberships_created_by_idx'),
    ('memberships_suspended_by_idx'),
    ('memberships_user_status_idx'),
    ('platform_roles_created_by_idx'),
    ('platform_roles_pkey'),
    ('profiles_email_key'),
    ('profiles_pkey')$$,
  'índices implícitos e explícitos essenciais existem'
);
select is_empty(
  $$select table_constraint.conname::text
    from pg_constraint table_constraint
    join pg_class class on class.oid = table_constraint.conrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where table_constraint.contype = 'f'
      and namespace.nspname = 'public'
      and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and not exists (
        select 1
        from pg_index candidate_index
        where candidate_index.indrelid = table_constraint.conrelid
          and candidate_index.indisvalid
          and candidate_index.indisready
          and table_constraint.conkey = (
            select array_agg(key.attnum order by key.ordinality)::smallint[]
            from unnest(candidate_index.indkey) with ordinality key(attnum, ordinality)
            where key.ordinality <= cardinality(table_constraint.conkey)
          )
      )$$,
  'todas as foreign keys possuem índice com prefixo compatível'
);
select results_eq(
  $$select class.relname::text collate "default",
           trigger.tgname::text collate "default",
           function.proname::text collate "default",
           trigger.tgenabled::text collate "default"
    from pg_trigger trigger
    join pg_class class on class.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_proc function on function.oid = trigger.tgfoid
    where namespace.nspname = 'public'
      and not trigger.tgisinternal
      and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
    order by class.relname, trigger.tgname$$,
  $$values
    ('companies','companies_touch_version','touch_version','O'),
    ('company_memberships','company_memberships_serialize_identity_invariants','serialize_identity_invariants','O'),
    ('company_memberships','membership_identity_exclusivity','enforce_identity_exclusivity','O'),
    ('company_memberships','memberships_touch_version','touch_version','O'),
    ('company_memberships','protect_last_company_admin','protect_last_company_admin','O'),
    ('platform_roles','platform_role_identity_exclusivity','enforce_identity_exclusivity','O'),
    ('platform_roles','platform_roles_serialize_identity_invariants','serialize_identity_invariants','O'),
    ('profiles','profiles_touch_version','touch_version','O')$$,
  'triggers essenciais estão habilitados e ligados à função correta'
);
select results_eq(
  $$select class.relname::text collate "default",
           trigger.tgname::text collate "default",
           trigger.tgtype::integer,
           pg_get_triggerdef(trigger.oid, false)::text collate "default"
    from pg_trigger trigger
    join pg_class class on class.oid = trigger.tgrelid
    where trigger.tgname in (
        'company_memberships_serialize_identity_invariants',
        'platform_roles_serialize_identity_invariants'
      )
      and not trigger.tgisinternal
    order by class.relname, trigger.tgname$$,
  $$values
    ('company_memberships','company_memberships_serialize_identity_invariants',30,
     'CREATE TRIGGER company_memberships_serialize_identity_invariants BEFORE INSERT OR DELETE OR UPDATE OF user_id, company_id, role, status ON public.company_memberships FOR EACH STATEMENT EXECUTE FUNCTION private.serialize_identity_invariants()'),
    ('platform_roles','platform_roles_serialize_identity_invariants',22,
     'CREATE TRIGGER platform_roles_serialize_identity_invariants BEFORE INSERT OR UPDATE OF user_id ON public.platform_roles FOR EACH STATEMENT EXECUTE FUNCTION private.serialize_identity_invariants()')$$,
  'serialização global cobre exatamente os eventos statement-level contratados'
);
select is(
  (
    select pg_get_triggerdef(trigger.oid, false)::text collate "default"
    from pg_trigger trigger
    where trigger.tgrelid = 'public.company_memberships'::regclass
      and trigger.tgname = 'protect_last_company_admin'
      and not trigger.tgisinternal
  ),
  'CREATE TRIGGER protect_last_company_admin BEFORE DELETE OR UPDATE OF company_id, role, status ON public.company_memberships FOR EACH ROW EXECUTE FUNCTION private.protect_last_company_admin()',
  'last-admin protege DELETE e UPDATE OF company_id, role, status'
);
select results_eq(
  $$select function.proname::text collate "default",
           owner.rolname::text collate "default",
           language.lanname::text collate "default",
           function.prokind::text collate "default",
           function.prosecdef
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_roles owner on owner.oid = function.proowner
    join pg_language language on language.oid = function.prolang
    where namespace.nspname = 'private'
    order by function.proname$$,
  $$values
    ('enforce_identity_exclusivity','postgres','plpgsql','f',false),
    ('protect_last_company_admin','postgres','plpgsql','f',false),
    ('serialize_identity_invariants','postgres','plpgsql','f',false),
    ('touch_version','postgres','plpgsql','f',false)$$,
  'funções privadas são functions de postgres e SECURITY INVOKER'
);
select is_empty(
  $$select function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and not ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))$$,
  'funções privadas fixam search_path vazio'
);
select results_eq(
  $$select kind, object_name, owner
    from (
      select 'table'::text as kind,
             class.relname::text collate "default" as object_name,
             role.rolname::text collate "default" as owner
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      join pg_roles role on role.oid = class.relowner
      where namespace.nspname = 'public'
        and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      union all
      select 'type', type.typname::text collate "default",
             role.rolname::text collate "default"
      from pg_type type
      join pg_namespace namespace on namespace.oid = type.typnamespace
      join pg_roles role on role.oid = type.typowner
      where namespace.nspname = 'public'
        and type.typname in ('company_status','platform_role','membership_role','membership_status','module_key','theme_preference')
    ) owned
    order by kind, object_name$$,
  $$values
    ('table','companies','postgres'),
    ('table','company_memberships','postgres'),
    ('table','member_modules','postgres'),
    ('table','platform_roles','postgres'),
    ('table','profiles','postgres'),
    ('type','company_status','postgres'),
    ('type','membership_role','postgres'),
    ('type','membership_status','postgres'),
    ('type','module_key','postgres'),
    ('type','platform_role','postgres'),
    ('type','theme_preference','postgres')$$,
  'tabelas e enums pertencem ao migration owner postgres'
);
select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','platform_roles','companies','company_memberships','member_modules')$$,
  'Task 5 mantém default-deny sem policies'
);

select is_empty(
  $$select role_name || ':' || relation_name || ':' || privilege_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) roles(role_name)
    cross join unnest(array['profiles','platform_roles','companies','company_memberships','member_modules']) relations(relation_name)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privileges(privilege_name)
    where has_table_privilege(
      role_name,
      to_regclass(format('public.%I', relation_name)),
      privilege_name
    )$$,
  'nenhum papel de API/BFF herda privilégio de tabela'
);
select is_empty(
  $$select class.relname || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':' ||
           grant_item.privilege_type
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(
      coalesce(class.relacl, acldefault('r', class.relowner))
    ) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'public'
      and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'tabelas base não possuem grants diretos para PUBLIC/API/BFF'
);
select is_empty(
  $$select class.relname || ':' || attribute.attname || ':' ||
           coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_attribute attribute
    join pg_class class on class.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(attribute.attacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'public'
      and class.relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'nenhum papel de API/BFF recebe privilégio direto de coluna'
);
select has_schema('private');
select results_eq(
  $$select owner.rolname::text collate "default"
    from pg_namespace namespace
    join pg_roles owner on owner.oid = namespace.nspowner
    where namespace.nspname = 'private'$$,
  $$values ('postgres')$$,
  'schema private pertence ao migration owner postgres'
);
select ok(
  coalesce(
    has_schema_privilege('axsys_bff', to_regnamespace('private'), 'USAGE'),
    false
  ),
  'axsys_bff recebe somente USAGE no schema privado'
);
select ok(
  not coalesce(
    has_schema_privilege('axsys_bff', to_regnamespace('private'), 'CREATE'),
    false
  ),
  'axsys_bff não recebe CREATE no schema privado'
);
select ok(
  not coalesce(
    has_schema_privilege('service_role', to_regnamespace('private'), 'USAGE'),
    false
  ),
  'service_role não recebe USAGE no schema privado'
);
select is_empty(
  $$select coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_namespace namespace
    cross join lateral aclexplode(
      coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'private'
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role')
      )
      and grant_item.privilege_type in ('USAGE', 'CREATE')$$,
  'PUBLIC e papéis de API não possuem USAGE ou CREATE no schema privado'
);
select is_empty(
  $$select proc.oid::regprocedure::text || ':' ||
           coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'private'
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'funções privadas não possuem EXECUTE inesperado'
);
select is_empty(
  $$select coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'private'
      and proc.proname = 'serialize_identity_invariants'
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'serialização global não expõe EXECUTE a PUBLIC/API/BFF'
);
select is_empty(
  $$select defaults.defaclobjtype::text || ':' ||
           coalesce(namespace.nspname, '<global>') || ':' ||
           coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_default_acl defaults
    left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and (
        defaults.defaclnamespace = 0
        or namespace.nspname in ('public', 'private')
      )
      and defaults.defaclobjtype in ('r','S','f')
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'default ACLs postgres permanecem fail-closed em global/public/private'
);
select ok(
  exists (
    select 1
    from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
  ),
  'default ACL global de functions permanece explicitamente fail-closed'
);

-- Somente o runner pgTAP recebe acesso transacional às assertions; o rollback remove estes grants.
grant usage on schema extensions to authenticated, service_role;
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
to authenticated, service_role;
set local role authenticated;
select extensions.throws_ok(
  $$select user_id from public.profiles limit 1$$,
  '42501', null, 'authenticated não lê tabela base sem grant'
);
reset role;
set local role service_role;
select extensions.throws_ok(
  $$select id from public.companies limit 1$$,
  '42501', null, 'service_role BYPASSRLS continua bloqueado sem grant'
);
reset role;

-- O include tipa helpers com os enums da fundação. Preserve o RED estrutural
-- (em vez de abortar o runner ao compilar a fixture) até a migration existir.
select (
  to_regtype('public.membership_role') is not null
  and to_regtype('public.module_key') is not null
  and to_regclass('public.profiles') is not null
  and to_regclass('public.platform_roles') is not null
  and to_regclass('public.companies') is not null
  and to_regclass('public.company_memberships') is not null
  and to_regclass('public.member_modules') is not null
)::int as foundation_identity_available \gset

\if :foundation_identity_available
\ir helpers/fixtures.inc

select test_helpers.create_auth_user('10000000-0000-4000-8000-000000000001', 'platform@example.test');
insert into public.profiles (user_id, email, display_name)
values ('10000000-0000-4000-8000-000000000001', 'platform@example.test', 'Platform Admin');
insert into public.platform_roles (user_id)
values ('10000000-0000-4000-8000-000000000001');
insert into public.companies (id, legal_name, cnpj_normalized, contact_email)
values (
  '30000000-0000-4000-8000-000000000001',
  'Empresa Válida',
  '10000000000001',
  'empresa.valida@example.test'
);

select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values ('30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'company_admin')$$,
  '23514',
  'identity_scope_conflict',
  'membership de identidade platform falha no BEFORE trigger'
);

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000002',
  'member-without-company@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '10000000-0000-4000-8000-000000000002',
  'member-without-company@example.test',
  'Member Without Company'
);
select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values ('30000000-0000-4000-8000-000000000099',
            '10000000-0000-4000-8000-000000000002', 'member')$$,
  '23503',
  null,
  'membership não-platform com empresa ausente isola o FK de company_id'
);
select throws_ok(
  $$insert into public.companies (legal_name, cnpj_normalized, contact_email)
    values ('Inválida', '123', 'invalida@example.test')$$,
  '23514',
  null,
  'CNPJ normalizado exige 14 dígitos'
);
select throws_ok(
  $$insert into public.profiles (user_id, email, display_name)
    values ('10000000-0000-4000-8000-000000000004',
            'missing-auth@example.test', 'Missing Auth User')$$,
  '23503',
  null,
  'profile normalizado sem auth.user isola o FK de user_id'
);

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000003',
  'normalized@example.test'
);
select throws_ok(
  $$insert into public.profiles (user_id, email, display_name)
    values ('10000000-0000-4000-8000-000000000003',
            'UPPER@example.test', 'Email Inválido')$$,
  '23514',
  null,
  'auth.user existente isola profiles_email_normalized'
);

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000005',
  'suspended-without-reason@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '10000000-0000-4000-8000-000000000005',
  'suspended-without-reason@example.test',
  'Suspended Without Reason'
);
select throws_ok(
  $$insert into public.company_memberships (
      company_id, user_id, role, status, suspended_at, suspension_reason
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000005',
      'member', 'suspended', clock_timestamp(), null
    )$$,
  '23514',
  null,
  'membership suspensa exige motivo não-nulo de 3 a 500 caracteres'
);
\endif

select * from finish();
rollback;
