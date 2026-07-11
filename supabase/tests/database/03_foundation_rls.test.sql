begin;
\ir helpers/fixtures.inc
select no_plan();

select has_function('private'::name, 'has_registered_app_session'::name, array[]::text[]);
select has_function('private'::name, 'has_active_app_session'::name, array[]::text[]);
select has_function('private'::name, 'has_platform_role'::name, array[]::text[]);
select has_function('private'::name, 'is_active_company_member'::name, array['uuid']);
select has_function(
  'private'::name,
  'has_company_role'::name,
  array['uuid','membership_role']
);
select has_function('private'::name, 'has_module'::name, array['uuid','module_key']);

select results_eq(
  $$select function.proname::text collate "default",
           pg_get_function_identity_arguments(function.oid)::text collate "default",
           pg_get_function_result(function.oid)::text collate "default",
           owner.rolname::text collate "default",
           function.prosecdef,
           function.provolatile::text collate "default",
           ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_roles owner on owner.oid = function.proowner
    where namespace.nspname = 'private'
      and function.proname in (
        'has_registered_app_session',
        'has_active_app_session',
        'has_platform_role',
        'is_active_company_member',
        'has_company_role',
        'has_module'
      )
    order by function.proname$$,
  $$values
    ('has_active_app_session', '', 'boolean', 'postgres', true, 's', true),
    ('has_company_role', 'p_company_id uuid, p_role membership_role',
      'boolean', 'postgres', true, 's', true),
    ('has_module', 'p_company_id uuid, p_module module_key',
      'boolean', 'postgres', true, 's', true),
    ('has_platform_role', '', 'boolean', 'postgres', true, 's', true),
    ('has_registered_app_session', '', 'boolean', 'postgres', true, 's', true),
    ('is_active_company_member', 'p_company_id uuid',
      'boolean', 'postgres', true, 's', true)$$,
  'helpers RLS congelam assinatura, retorno, owner, definer, STABLE e search_path'
);

select results_eq(
  $$select function.oid::regprocedure::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'has_registered_app_session',
        'has_active_app_session',
        'has_platform_role',
        'is_active_company_member',
        'has_company_role',
        'has_module'
      )
      and has_function_privilege('authenticated', function.oid, 'EXECUTE')
    order by function.oid::regprocedure::text$$,
  $$values
    ('private.has_active_app_session()'),
    ('private.has_company_role(uuid,membership_role)'),
    ('private.has_module(uuid,module_key)'),
    ('private.has_platform_role()'),
    ('private.has_registered_app_session()'),
    ('private.is_active_company_member(uuid)')$$,
  'authenticated recebe efetivamente exatamente os seis helpers RLS'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['anon','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'has_registered_app_session',
        'has_active_app_session',
        'has_platform_role',
        'is_active_company_member',
        'has_company_role',
        'has_module'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'PUBLIC/anon/service/BFF não alcançam helpers RLS por grants herdados'
);

select results_eq(
  $$select tablename::text collate "default",
           policyname::text collate "default",
           cmd::text collate "default",
           array_to_string(roles, ',')::text collate "default",
           permissive::text collate "default"
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','platform_roles','companies','company_memberships','member_modules'
      )
    order by tablename, policyname$$,
  $$values
    ('companies','companies_select_authorized','SELECT','authenticated','PERMISSIVE'),
    ('company_memberships','memberships_select_company_admin_or_self',
      'SELECT','authenticated','PERMISSIVE'),
    ('member_modules','member_modules_select_company_admin_or_self',
      'SELECT','authenticated','PERMISSIVE'),
    ('platform_roles','platform_roles_select_self','SELECT','authenticated','PERMISSIVE'),
    ('profiles','profiles_select_self','SELECT','authenticated','PERMISSIVE'),
    ('profiles','profiles_update_self','UPDATE','authenticated','PERMISSIVE')$$,
  'policies públicas são exatamente as seis intenções allowlisted'
);

select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'public'
      and (
        cmd = 'ALL'
        or coalesce(qual, '') ~* '^\(?\s*true\s*\)?$'
        or coalesce(with_check, '') ~* '^\(?\s*true\s*\)?$'
      )$$,
  'nenhuma policy ALL/USING true/WITH CHECK true é criada'
);

select is_empty(
  $$select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('audit_events','security_events','idempotency_keys')$$,
  'audit, security e idempotency permanecem sem policies diretas'
);

select results_eq(
  $$select table_name
    from unnest(array[
      'public.profiles',
      'public.platform_roles',
      'public.companies',
      'public.company_memberships',
      'public.member_modules',
      'public.audit_events',
      'public.security_events',
      'public.idempotency_keys'
    ]) table_name
    where has_table_privilege('authenticated', table_name, 'SELECT')
    order by table_name$$,
  $$values
    ('public.companies'),
    ('public.company_memberships'),
    ('public.member_modules'),
    ('public.platform_roles'),
    ('public.profiles')$$,
  'authenticated recebe SELECT efetivo somente nas cinco tabelas operacionais'
);

select is_empty(
  $$select role_name || ':' || table_name || ':' || privilege
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'public.profiles',
      'public.platform_roles',
      'public.companies',
      'public.company_memberships',
      'public.member_modules'
    ]) table_name
    cross join unnest(array[
      'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(role_name, table_name, privilege)$$,
  'nenhum application role recebe DML/DDL efetivo em tabela operacional'
);

select is_empty(
  $$select role_name || ':' || table_name || ':' || privilege
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'public.audit_events','public.security_events','public.idempotency_keys'
    ]) table_name
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(role_name, table_name, privilege)$$,
  'audit/security/idempotency não recebem privilégio efetivo por membership'
);

select results_eq(
  $$select attribute.attname::text collate "default"
    from pg_attribute attribute
    where attribute.attrelid = 'public.profiles'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated',
        'public.profiles',
        attribute.attname,
        'UPDATE'
      )
    order by attribute.attname$$,
  $$values ('preferred_theme')$$,
  'authenticated recebe UPDATE efetivo somente na coluna preferred_theme'
);

-- As funções pgTAP pertencem apenas ao harness no schema extensions e estes
-- grants são revertidos junto com a transação. Assim as consultas continuam
-- executando sob o papel autenticado sem ampliar a superfície de produção.
grant usage on schema extensions to authenticated;
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
      'grant execute on function %s to authenticated',
      pgtap_function.signature
    );
  end loop;
end
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
  '20000000-0000-4000-8000-000000000011',
  'member-a@example.test',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000011',
  'member',
  array['certificates']::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000002',
  'admin-b@example.test',
  '30000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002',
  'company_admin',
  array['administrative','financial','certificates']::public.module_key[]
);

do $$
declare
  fixture record;
begin
  for fixture in
    select * from (values
      ('10000000-0000-4000-8000-000000000001'::uuid,
       '90000000-0000-4000-8000-000000000100'::uuid,
       '81000000-0000-4000-8000-000000000100'::uuid),
      ('20000000-0000-4000-8000-000000000001'::uuid,
       '90000000-0000-4000-8000-000000000101'::uuid,
       '81000000-0000-4000-8000-000000000101'::uuid),
      ('20000000-0000-4000-8000-000000000011'::uuid,
       '90000000-0000-4000-8000-000000000111'::uuid,
       '81000000-0000-4000-8000-000000000111'::uuid),
      ('20000000-0000-4000-8000-000000000002'::uuid,
       '90000000-0000-4000-8000-000000000102'::uuid,
       '81000000-0000-4000-8000-000000000102'::uuid)
    ) sessions(user_id, session_id, correlation_id)
  loop
    perform test_helpers.create_auth_session(
      fixture.session_id,
      fixture.user_id,
      statement_timestamp() - interval '1 minute'
    );
    perform private.register_auth_session(
      fixture.session_id,
      fixture.user_id,
      false
    );
    perform private.write_authenticated_audit_event(
      fixture.user_id,
      fixture.session_id,
      'auth.login',
      'session',
      null,
      'success',
      null,
      fixture.correlation_id,
      null,
      null,
      '{"rememberMe":false}'::jsonb
    );
  end loop;
end
$$;

select test_helpers.create_auth_session(
  '90000000-0000-4000-8000-000000000202',
  '20000000-0000-4000-8000-000000000002',
  statement_timestamp() - interval '30 seconds'
);
select private.register_auth_session(
  '90000000-0000-4000-8000-000000000202',
  '20000000-0000-4000-8000-000000000002',
  false
);

select test_helpers.create_auth_session(
  '90000000-0000-4000-8000-000000000302',
  '20000000-0000-4000-8000-000000000002',
  statement_timestamp() - interval '2 hours'
);
insert into private.auth_session_controls (
  session_id, user_id, auth_created_at, remember_me, state,
  absolute_expires_at, audit_scope, audit_company_id,
  activated_at, last_seen_at, created_at, updated_at
) select
  auth_session.id,
  auth_session.user_id,
  auth_session.created_at,
  false,
  'active',
  statement_timestamp() - interval '1 minute',
  'tenant',
  '30000000-0000-4000-8000-000000000002',
  auth_session.created_at + interval '1 minute',
  auth_session.created_at + interval '1 minute',
  auth_session.created_at,
  statement_timestamp() - interval '1 minute'
from auth.sessions auth_session
where auth_session.id = '90000000-0000-4000-8000-000000000302';

select throws_ok(
  $$insert into public.member_modules (company_id, membership_id, module)
    values (
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001',
      'certificates'
    )$$,
  '23503',
  null,
  'FK composta bloqueia referência entre tenants'
);

select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000101'
);
set local role authenticated;

select is(private.has_registered_app_session(), true, 'admin A possui sessão ativa registrada');
select is(private.has_active_app_session(), true, 'admin A possui sessão operacional');
select is(private.has_platform_role(), false, 'admin A não é platform');
select is(
  private.is_active_company_member('30000000-0000-4000-8000-000000000001'),
  true,
  'membership A deriva do JWT e sessão ativa'
);
select is(
  private.is_active_company_member('30000000-0000-4000-8000-000000000002'),
  false,
  'company B não atravessa tenant'
);
select is(
  private.has_company_role(
    '30000000-0000-4000-8000-000000000001',
    'company_admin'
  ),
  true,
  'papel company_admin deriva do membership ativo'
);
select is(
  private.has_module('30000000-0000-4000-8000-000000000001', 'financial'),
  true,
  'módulo concedido ao próprio membership é reconhecido'
);
select is(
  private.has_module('30000000-0000-4000-8000-000000000001', 'certificates'),
  false,
  'company admin não ganha módulo de outro membro implicitamente'
);
select results_eq(
  $$select id from public.companies order by id$$,
  $$values ('30000000-0000-4000-8000-000000000001'::uuid)$$,
  'admin A vê somente empresa A'
);
select results_eq(
  $$select user_id from public.profiles order by user_id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'admin A vê somente próprio profile'
);
select results_eq(
  $$select user_id from public.company_memberships order by user_id$$,
  $$values
    ('20000000-0000-4000-8000-000000000001'::uuid),
    ('20000000-0000-4000-8000-000000000011'::uuid)$$,
  'admin A vê somente memberships da empresa A'
);
select results_eq(
  $$select module::text from public.member_modules order by module::text$$,
  $$values ('administrative'),('certificates'),('financial')$$,
  'admin A vê módulos da empresa A sem atravessar tenant'
);
select throws_ok(
  $$select * from public.audit_events$$,
  '42501',
  null,
  'admin não lê audit bruto'
);
select throws_ok(
  $$select * from public.security_events$$,
  '42501',
  null,
  'admin não lê security events'
);
select throws_ok(
  $$select * from public.idempotency_keys$$,
  '42501',
  null,
  'admin não lê idempotency keys'
);
select throws_ok(
  $$update public.companies
    set legal_name = 'Ataque'
    where id = '30000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'sem grant UPDATE não há IDOR de escrita'
);
select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values (
      '30000000-0000-4000-8000-000000000002',
      gen_random_uuid(),
      'member'
    )$$,
  '42501',
  null,
  'sem INSERT não há vínculo forjado'
);
select throws_ok(
  $$delete from public.company_memberships
    where user_id = '20000000-0000-4000-8000-000000000011'$$,
  '42501',
  null,
  'sem DELETE não há exclusão cross-tenant'
);

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111'
);
set local role authenticated;
select results_eq(
  $$select user_id from public.company_memberships order by user_id$$,
  $$values ('20000000-0000-4000-8000-000000000011'::uuid)$$,
  'membro A vê somente próprio membership'
);
select results_eq(
  $$select module::text from public.member_modules order by module::text$$,
  $$values ('certificates')$$,
  'membro A vê somente próprios módulos'
);
select results_eq(
  $$select id from public.companies order by id$$,
  $$values ('30000000-0000-4000-8000-000000000001'::uuid)$$,
  'membro A vê somente empresa A'
);

reset role;
update public.profiles
set must_change_password = true,
    temporary_password_expires_at = statement_timestamp() - interval '1 second'
where user_id = '20000000-0000-4000-8000-000000000011';
select is(
  (
    select state::text
    from private.auth_session_controls
    where session_id = '90000000-0000-4000-8000-000000000111'
  ),
  'active',
  'sessão já active atravessa o vencimento da senha provisória'
);
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111'
);
set local role authenticated;
select is(
  private.has_registered_app_session(),
  true,
  'senha provisória vencida preserva sessão registrada para roteamento'
);
select is(
  private.has_active_app_session(),
  false,
  'senha provisória vencida bloqueia sessão operacional'
);
select results_eq(
  $$select user_id from public.profiles$$,
  $$values ('20000000-0000-4000-8000-000000000011'::uuid)$$,
  'senha provisória vencida lê somente próprio profile'
);
select is_empty(
  $$select user_id from public.platform_roles$$,
  'senha provisória vencida não lê papel platform de outro usuário'
);
select is_empty(
  $$select id from public.companies$$,
  'senha provisória vencida não lê empresas'
);
select is_empty(
  $$select user_id from public.company_memberships$$,
  'senha provisória vencida não lê memberships'
);
select is_empty(
  $$select module from public.member_modules$$,
  'senha provisória vencida não lê módulos'
);
select is_empty(
  $$update public.profiles
    set preferred_theme = 'light'
    where user_id = '20000000-0000-4000-8000-000000000011'
    returning user_id$$,
  'senha provisória vencida não atualiza theme/profile'
);

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000102'
);
set local role authenticated;
select results_eq(
  $$update public.profiles
    set preferred_theme = 'light'
    where user_id = '20000000-0000-4000-8000-000000000002'
    returning preferred_theme::text$$,
  $$values ('light')$$,
  'sessão operacional atualiza somente preferred_theme próprio'
);
select is_empty(
  $$update public.profiles
    set preferred_theme = 'light'
    where user_id = '20000000-0000-4000-8000-000000000011'
    returning user_id$$,
  'policy UPDATE não permite alterar preferred_theme de outro usuário'
);

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000100'
);
set local role authenticated;
select is(private.has_platform_role(), true, 'papel platform ativo é reconhecido');
select results_eq(
  $$select id from public.companies order by id$$,
  $$values
    ('30000000-0000-4000-8000-000000000001'::uuid),
    ('30000000-0000-4000-8000-000000000002'::uuid)$$,
  'platform vê cadastro das duas empresas'
);
select results_eq(
  $$select user_id from public.platform_roles$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'platform lê somente próprio papel'
);
select is_empty(
  $$select * from public.company_memberships$$,
  'platform não recebe memberships'
);
select is_empty(
  $$select * from public.member_modules$$,
  'platform não recebe módulos empresariais'
);

reset role;
update auth.sessions
set created_at = created_at + interval '1 second'
where id = '90000000-0000-4000-8000-000000000100';
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000100'
);
set local role authenticated;
select is(
  private.has_registered_app_session(),
  false,
  'Auth created_at incoerente invalida sessão imediatamente'
);
select is_empty(
  $$select id from public.companies$$,
  'Auth incoerente fecha RLS operacional'
);

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000202'
);
set local role authenticated;
select is(private.has_registered_app_session(), false, 'sessão pending nunca autoriza helper');
select is(private.has_active_app_session(), false, 'sessão pending nunca autoriza operação');
select is_empty($$select user_id from public.profiles$$, 'sessão pending lê zero profiles');
select is_empty($$select id from public.companies$$, 'sessão pending lê zero empresas');

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000302'
);
set local role authenticated;
select is(
  private.has_registered_app_session(),
  false,
  'sessão active com absolute expiry vencido não autoriza'
);
select is_empty($$select user_id from public.profiles$$, 'sessão expirada lê zero profiles');
select is_empty($$select id from public.companies$$, 'sessão expirada lê zero empresas');

reset role;
update auth.sessions
set not_after = statement_timestamp() - interval '1 second'
where id = '90000000-0000-4000-8000-000000000102';
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000102'
);
set local role authenticated;
select is(
  private.has_registered_app_session(),
  false,
  'Auth not_after vencido invalida sessão mesmo com control futuro'
);
select is_empty($$select user_id from public.profiles$$, 'Auth expirado lê zero profiles');

reset role;
select private.revoke_auth_sessions(
  '20000000-0000-4000-8000-000000000001',
  null
);
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000101'
);
set local role authenticated;
select is(private.has_registered_app_session(), false, 'sessão revogada perde helper');
select is_empty($$select user_id from public.profiles$$, 'sessão revogada lê zero profiles');
select is_empty($$select id from public.companies$$, 'sessão revogada lê zero empresas');
select is_empty(
  $$update public.profiles
    set preferred_theme = 'light'
    where user_id = '20000000-0000-4000-8000-000000000001'
    returning user_id$$,
  'sessão revogada não atualiza profile'
);

reset role;
select test_helpers.create_auth_session(
  '90000000-0000-4000-8000-000000000401',
  '20000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '5 minutes'
);
insert into private.auth_session_controls (
  session_id, user_id, auth_created_at, remember_me, state,
  absolute_expires_at, audit_scope, audit_company_id,
  activated_at, last_seen_at, created_at, updated_at
) select
  auth_session.id,
  auth_session.user_id,
  auth_session.created_at,
  false,
  'active',
  statement_timestamp() + interval '8 hours',
  'tenant',
  '30000000-0000-4000-8000-000000000001',
  auth_session.created_at + interval '1 minute',
  auth_session.created_at + interval '1 minute',
  auth_session.created_at,
  statement_timestamp()
from auth.sessions auth_session
where auth_session.id = '90000000-0000-4000-8000-000000000401';
select is(
  (
    select state::text
    from private.auth_session_controls
    where session_id = '90000000-0000-4000-8000-000000000401'
  ),
  'active',
  'fixture pós-revogação permanece active para isolar o cutoff'
);
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000401'
);
set local role authenticated;
select is(
  private.has_registered_app_session(),
  false,
  'cutoff invalida controle active coerente criado antes de revoked_before'
);
select is_empty(
  $$select user_id from public.profiles$$,
  'controle active anterior ao cutoff lê zero profiles'
);
select is_empty(
  $$select id from public.companies$$,
  'controle active anterior ao cutoff lê zero empresas'
);

reset role;
select test_helpers.clear_jwt();
select * from finish();
rollback;
