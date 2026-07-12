begin;
\ir helpers/fixtures.inc
select no_plan();

select has_table('private'::name, 'password_recovery_grants'::name);
select has_function(
  'public'::name,
  'issue_password_recovery_grant'::name,
  array['text']
);
select has_function(
  'private'::name,
  'begin_password_recovery'::name,
  array['text','uuid']
);
select has_function(
  'private'::name,
  'complete_password_recovery'::name,
  array['uuid','uuid']
);
select has_function(
  'private'::name,
  'fail_password_recovery'::name,
  array['uuid','text','uuid']
);

select results_eq(
  $$select string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'password_recovery_grants'$$,
  $$values (
    'grant_hash,user_id,session_id,expires_at,consumed_at,created_at,updated_at'
  )$$,
  'grant privado contém somente hash, identidade Auth e timestamps'
);
select is_empty(
  $$select column_name
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'password_recovery_grants'
      and column_name ~ '(password|email|token|request|metadata|payload|body|raw)'$$,
  'grant nunca persiste senha, email, token, request ou valor bruto'
);
select results_eq(
  $$select owner.rolname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_roles owner on owner.oid = class.relowner
    where class.oid = 'private.password_recovery_grants'::regclass$$,
  $$values ('postgres', true, true)$$,
  'grant pertence a postgres e força RLS'
);
select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'private'
      and tablename = 'password_recovery_grants'$$,
  'grant privado não possui policy direta'
);
select is_empty(
  $$select role_name || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(
      role_name,
      'private.password_recovery_grants',
      privilege
    )$$,
  'nenhum papel de aplicação recebe CRUD/DDL no grant'
);
select is_empty(
  $$select role_name || ':' || attribute.attname || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_attribute attribute
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
    where attribute.attrelid = 'private.password_recovery_grants'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        role_name,
        'private.password_recovery_grants',
        attribute.attname,
        privilege
      )$$,
  'nenhum papel de aplicação recebe grant por coluna no grant privado'
);
select results_eq(
  $$select constraint_type::text collate "default", count(*)::integer
    from (
      select case constraint_row.contype
        when 'p' then 'primary'
        when 'u' then 'unique'
        when 'f' then 'foreign'
        when 'c' then 'check'
      end as constraint_type
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'private.password_recovery_grants'::regclass
    ) constraints
    group by constraint_type
    order by constraint_type$$,
  $$values
    ('check', 4),
    ('foreign', 2),
    ('primary', 1),
    ('unique', 1)$$,
  'grant congela PK/hash, sessão única, FKs e invariantes temporais'
);
select results_eq(
  $$select constraint_row.conname::text collate "default",
           exists (
             select 1
             from pg_index index_row
             where index_row.indrelid = constraint_row.conrelid
               and index_row.indisvalid
               and index_row.indisready
               and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
               and not exists (
                 select 1
                 from unnest(constraint_row.conkey) with ordinality
                   foreign_key(attnum, position)
                 left join unnest(index_row.indkey::smallint[]) with ordinality
                   index_key(attnum, position) using (position)
                 where index_key.attnum is distinct from foreign_key.attnum
               )
           ) as indexed
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'private.password_recovery_grants'::regclass
      and constraint_row.contype = 'f'
    order by constraint_row.conname$$,
  $$values
    ('password_recovery_grants_session_id_fkey', true),
    ('password_recovery_grants_user_id_fkey', true)$$,
  'cada FK do grant possui índice válido e pronto com prefixo compatível'
);
select results_eq(
  $$select type.enumlabel::text collate "default"
    from pg_type base
    join pg_namespace namespace on namespace.oid = base.typnamespace
    join pg_enum type on type.enumtypid = base.oid
    where namespace.nspname = 'private'
      and base.typname = 'auth_password_operation_kind'
    order by type.enumsortorder$$,
  $$values
    ('temporary_password_reset'),
    ('temporary_password_change'),
    ('password_recovery')$$,
  'kind da operação inclui somente reset administrativo, troca e recovery'
);
select results_eq(
  $$select bucket::text collate "default", attempt_limit,
           window_seconds, block_seconds, clear_on_success
    from private.rate_limit_policies
    where bucket in ('forgot-ip-volume','forgot-account-volume')
    order by bucket$$,
  $$values
    ('forgot-account-volume', 3, 3600, 3600, false),
    ('forgot-ip-volume', 10, 900, 3600, false)$$,
  'forgot congela limites por conta/IP com bloqueio de uma hora'
);
select results_eq(
  $$select namespace.nspname::text collate "default",
           function.proname::text collate "default",
           pg_get_function_identity_arguments(function.oid)::text collate "default",
           pg_get_function_result(function.oid)::text collate "default",
           owner.rolname::text collate "default",
           function.prosecdef,
           function.proretset,
           function.proconfig = array['search_path=""']::text[]
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_roles owner on owner.oid = function.proowner
    where (namespace.nspname, function.proname) in (
      ('public','issue_password_recovery_grant'),
      ('private','begin_password_recovery'),
      ('private','complete_password_recovery'),
      ('private','fail_password_recovery')
    )
    order by namespace.nspname desc, function.proname$$,
  $$values
    ('public','issue_password_recovery_grant','p_grant_hash text',
      'timestamp with time zone','postgres',true,false,true),
    ('private','begin_password_recovery','p_grant_hash text, p_correlation_id uuid',
      'TABLE(operation_id uuid, user_id uuid, session_id uuid)','postgres',true,true,true),
    ('private','complete_password_recovery','p_operation_id uuid, p_correlation_id uuid',
      'void','postgres',true,false,true),
    ('private','fail_password_recovery','p_operation_id uuid, p_reason_code text, p_correlation_id uuid',
      'void','postgres',true,false,true)$$,
  'boundaries recovery congelam assinatura, retorno, owner, definer e search_path'
);
select results_eq(
  $$select role_name::text collate "default",
           format(
             '%I.%I(%s)',
             namespace.nspname,
             function.proname,
             replace(oidvectortypes(function.proargtypes), ', ', ',')
           )::text collate "default"
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where ((
        namespace.nspname = 'public'
        and function.proname = 'issue_password_recovery_grant'
      ) or (
        namespace.nspname = 'private'
        and function.proname in (
          'begin_password_recovery',
          'complete_password_recovery',
          'fail_password_recovery'
        )
      ))
      and has_function_privilege(role_name, function.oid, 'EXECUTE')
    order by role_name, function.oid::regprocedure::text$$,
  $$values
    ('authenticated','public.issue_password_recovery_grant(text)'),
    ('axsys_bff','private.begin_password_recovery(text,uuid)'),
    ('axsys_bff','private.complete_password_recovery(uuid,uuid)'),
    ('axsys_bff','private.fail_password_recovery(uuid,text,uuid)')$$,
  'authenticated emite grant; somente BFF executa a saga privada'
);
select results_eq(
  $$select role_name::text collate "default",
           format(
             '%I.%I(%s)',
             namespace.nspname,
             function.proname,
             replace(oidvectortypes(function.proargtypes), ', ', ',')
           )::text collate "default"
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and not exists (
        select 1
        from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = function.oid
          and dependency.deptype = 'e'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')
    order by role_name, function.oid::regprocedure::text$$,
  $$values
    ('authenticated','public.company_commit_member_provisioning(uuid,uuid,text,text,membership_role,module_key[],uuid)'),
    ('authenticated','public.company_get_api_access_context()'),
    ('authenticated','public.company_reserve_member_provisioning(text,text,text,uuid)'),
    ('authenticated','public.company_update_membership(uuid,text,membership_role,membership_status,module_key[],text,bigint,uuid)'),
    ('authenticated','public.issue_password_recovery_grant(text)')$$,
  'superfície pública efetiva contém somente os cinco RPCs autenticados aprovados'
);
select hasnt_function(
  'private'::name,
  'begin_password_recovery'::name,
  array['text','uuid','uuid','bigint','uuid']
);

create function test_helpers.set_password_recovery_jwt(
  p_user_id uuid,
  p_session_id uuid,
  p_method text,
  p_amr_at bigint
) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'session_id', p_session_id,
      'aal', 'aal1',
      'is_anonymous', false,
      'amr', jsonb_build_array(
        jsonb_build_object('method', p_method, 'timestamp', p_amr_at)
      )
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
end;
$$;

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
grant execute on function public.issue_password_recovery_grant(text)
  to authenticated;

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000001',
  'recovery-one@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000101',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001'
);
select set_config(
  'test.recovery_amr_one',
  floor(extract(epoch from clock_timestamp()) - 1)::bigint::text,
  true
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000001',
  '61100000-0000-4000-8000-000000000001',
  'recovery',
  current_setting('test.recovery_amr_one')::bigint
);
set local role authenticated;
select lives_ok(
  $$select public.issue_password_recovery_grant(repeat('a', 64))$$,
  'recovery AMR recente emite um grant'
);
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('a', 64))$$,
  '23505', 'password_recovery_grant_already_issued',
  'mesma sessão não reemite nem o mesmo hash'
);
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('b', 64))$$,
  '23505', 'password_recovery_grant_already_issued',
  'mesma sessão não rotaciona para hash diferente'
);
reset role;
select results_eq(
  $$select user_id, session_id,
           expires_at = to_timestamp(current_setting('test.recovery_amr_one')::bigint)
             + interval '10 minutes',
           consumed_at is null,
           created_at <= updated_at
    from private.password_recovery_grants
    where grant_hash = repeat('a', 64)$$,
  $$values (
    '61000000-0000-4000-8000-000000000001'::uuid,
    '61100000-0000-4000-8000-000000000001'::uuid,
    true, true, true
  )$$,
  'deadline do banco é exatamente AMR+10m e o grant nasce não consumido'
);

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000002',
  'recovery-before@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000102',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002'
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000002',
  '61100000-0000-4000-8000-000000000002',
  'recovery',
  floor(extract(epoch from clock_timestamp()) - 590)::bigint
);
set local role authenticated;
select lives_ok(
  $$select public.issue_password_recovery_grant(repeat('c', 64))$$,
  'dez segundos antes de AMR+10m ainda é válido com margem estável'
);
reset role;

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000007',
  'recovery-context@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000107',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000007',
  '61000000-0000-4000-8000-000000000007'
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000007',
  '61100000-0000-4000-8000-000000000001',
  'recovery',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('6', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'sub e session_id incompatíveis falham sem revelar a causa'
);
reset role;

select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000007',
  '61100000-0000-4000-8000-000000000007',
  'recovery',
  floor(extract(epoch from clock_timestamp()) + 60)::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('7', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'AMR futuro falha fechado'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'is_anonymous', false,
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      ),
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      )
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('8', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'múltiplos AMRs recovery são ambíguos e falham fechado'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'is_anonymous', false,
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      ),
      jsonb_build_object('method', 'recovery', 'timestamp', 'malformed')
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('e0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'recovery duplicado malformado também torna o AMR ambíguo'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'is_anonymous', false,
    'amr', jsonb_build_array(
      jsonb_build_object('method', 'recovery', 'timestamp', 'malformed')
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('f0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'timestamp malformado no único recovery falha genérico antes de cast'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'is_anonymous', 'false',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      )
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('ab', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'is_anonymous string false é rejeitado por tipo de claim inválido'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'is_anonymous', true,
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      )
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('9', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'sessão anônima não emite grant recovery'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '61000000-0000-4000-8000-000000000007'::uuid,
    'role', 'authenticated',
    'session_id', '61100000-0000-4000-8000-000000000007'::uuid,
    'aal', 'aal1',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'recovery',
        'timestamp', floor(extract(epoch from clock_timestamp()))::bigint
      )
    )
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-4000-8000-000000000007',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('c0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'claim is_anonymous ausente falha fechado'
);
reset role;

select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000007',
  '61100000-0000-4000-8000-000000000007',
  'recovery',
  9007199254740991
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('d0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'AMR numérico extremo falha genérico antes de converter timestamp'
);
reset role;

update public.profiles
set is_active = false
where user_id = '61000000-0000-4000-8000-000000000007';
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000007',
  '61100000-0000-4000-8000-000000000007',
  'recovery',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('0', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'profile inativo falha sem revelar a causa'
);
reset role;
update public.profiles
set is_active = true
where user_id = '61000000-0000-4000-8000-000000000007';

update auth.sessions
set not_after = clock_timestamp() - interval '1 second'
where id = '61100000-0000-4000-8000-000000000007';
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000007',
  '61100000-0000-4000-8000-000000000007',
  'recovery',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('a0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'sessão Auth expirada falha sem revelar a causa'
);
reset role;

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000008',
  'recovery-deleted-session@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000108',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000008',
  '61000000-0000-4000-8000-000000000008'
);
delete from auth.sessions
where id = '61100000-0000-4000-8000-000000000008';
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000008',
  '61100000-0000-4000-8000-000000000008',
  'recovery',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('b0', 32))$$,
  '28000', 'password_recovery_context_invalid',
  'sessão Auth deletada falha sem revelar a causa'
);
reset role;

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000003',
  'recovery-at@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000103',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000003'
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000003',
  '61100000-0000-4000-8000-000000000003',
  'recovery',
  floor(extract(epoch from clock_timestamp()) - 600)::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('d', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'no instante AMR+10m o grant já é recusado'
);
reset role;

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000004',
  'recovery-after@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000104',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000004'
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000004',
  '61100000-0000-4000-8000-000000000004',
  'recovery',
  floor(extract(epoch from clock_timestamp()) - 601)::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('e', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'depois de AMR+10m o grant é recusado'
);
select throws_ok(
  $$select public.issue_password_recovery_grant('raw-token')$$,
  '22023', 'password_recovery_grant_hash_invalid',
  'hash fora do formato canônico é recusado antes de persistir'
);
reset role;

select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000004',
  '61100000-0000-4000-8000-000000000004',
  'password',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select throws_ok(
  $$select public.issue_password_recovery_grant(repeat('f', 64))$$,
  '28000', 'password_recovery_context_invalid',
  'fluxo password comum não emite grant de recovery'
);
reset role;

select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000101',
  '61000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '1 hour'
);
insert into private.auth_session_controls (
  session_id, user_id, auth_created_at, remember_me, state,
  absolute_expires_at, audit_scope, audit_company_id,
  activated_at, last_seen_at, created_at, updated_at
)
select auth_session.id, auth_session.user_id, auth_session.created_at,
       false, 'active', clock_timestamp() + interval '7 hours',
       'tenant', '61000000-0000-4000-8000-000000000010',
       clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp()
from auth.sessions auth_session
where auth_session.id = '61100000-0000-4000-8000-000000000101';

select lives_ok(
  $$select * from private.begin_password_recovery(
      repeat('a', 64),
      '61200000-0000-4000-8000-000000000001'
    )$$,
  'begin consome o grant e reserva recovery sem ator/sessão fornecidos'
);
select results_eq(
  $$select grant_row.consumed_at is not null,
           operation.kind::text collate "default",
           operation.status::text collate "default",
           operation.actor_user_id = grant_row.user_id,
           operation.target_user_id = grant_row.user_id,
           operation.expires_at = grant_row.expires_at,
           profile.must_change_password,
           profile.temporary_password_expires_at = grant_row.expires_at
    from private.password_recovery_grants grant_row
    join private.auth_password_operations operation
      on operation.target_user_id = grant_row.user_id
     and operation.correlation_id = '61200000-0000-4000-8000-000000000001'
    join public.profiles profile on profile.user_id = grant_row.user_id
    where grant_row.grant_hash = repeat('a', 64)$$,
  $$values (true, 'password_recovery', 'reserved', true, true, true, true, true)$$,
  'reserva deriva identidade/deadline do grant e fecha o profile antes do Auth'
);
select results_eq(
  $$select state::text collate "default"
    from private.auth_session_controls
    where session_id = '61100000-0000-4000-8000-000000000101'$$,
  $$values ('revoked')$$,
  'begin revoga imediatamente toda sessão operacional anterior'
);
select results_eq(
  $$select action::text collate "default", actor_user_id, resource_id,
           correlation_id
    from public.audit_events
    where correlation_id = '61200000-0000-4000-8000-000000000001'$$,
  $$values (
    'auth.password_recovery_reserved',
    '61000000-0000-4000-8000-000000000001'::uuid,
    '61000000-0000-4000-8000-000000000001'::uuid,
    '61200000-0000-4000-8000-000000000001'::uuid
  )$$,
  'reserva audita somente identidade derivada e correlation'
);
select throws_ok(
  $$select * from private.begin_password_recovery(
      repeat('a', 64),
      '61200000-0000-4000-8000-000000000002'
    )$$,
  '28000', 'password_recovery_grant_invalid',
  'grant consumido não inicia segunda operação'
);
select throws_ok(
  $$select * from private.begin_password_recovery(
      repeat('9', 64),
      '61200000-0000-4000-8000-000000000003'
    )$$,
  '28000', 'password_recovery_grant_invalid',
  'hash desconhecido e replay têm erro idêntico'
);

select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000001',
  '61100000-0000-4000-8000-000000000001',
  'recovery',
  current_setting('test.recovery_amr_one')::bigint
);
set local role authenticated;
select is(private.has_registered_app_session(), false,
  'sessão Auth de recovery nunca vira sessão operacional');
select is_empty(
  $$select user_id from public.profiles$$,
  'recovery não lê profile durante estado intermediário'
);
select is_empty(
  $$select id from public.companies$$,
  'recovery não lê tenant durante estado intermediário'
);
reset role;

select throws_ok(
  $$select private.complete_password_recovery(
      (select id from private.auth_password_operations
       where correlation_id = '61200000-0000-4000-8000-000000000001'),
      '61200000-0000-4000-8000-000000000099'
    )$$,
  '23514', 'password_recovery_operation_correlation_mismatch',
  'complete rejeita correlation forjada'
);
select lives_ok(
  $$select private.complete_password_recovery(
      (select id from private.auth_password_operations
       where correlation_id = '61200000-0000-4000-8000-000000000001'),
      '61200000-0000-4000-8000-000000000001'
    )$$,
  'complete finaliza profile/operação e revoga sessões atomicamente'
);
select results_eq(
  $$select operation.status::text collate "default",
           operation.auth_updated_at is not null,
           operation.completed_at is not null,
           profile.must_change_password,
           profile.temporary_password_expires_at is null,
           profile.password_changed_at is not null
    from private.auth_password_operations operation
    join public.profiles profile on profile.user_id = operation.target_user_id
    where operation.correlation_id = '61200000-0000-4000-8000-000000000001'$$,
  $$values ('completed', true, true, false, true, true)$$,
  'complete limpa forced-change somente após Auth e grava conclusão'
);
select results_eq(
  $$select count(*)::integer
    from public.audit_events
    where correlation_id = '61200000-0000-4000-8000-000000000001'$$,
  $$values (2)$$,
  'recovery concluído possui reserva e conclusão append-only'
);
select throws_ok(
  $$select private.complete_password_recovery(
      (select id from private.auth_password_operations
       where correlation_id = '61200000-0000-4000-8000-000000000001'),
      '61200000-0000-4000-8000-000000000001'
    )$$,
  '23514', 'password_recovery_operation_invalid',
  'complete não aceita replay'
);

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000005',
  'recovery-failure@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000105',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000005'
);
select test_helpers.set_password_recovery_jwt(
  '61000000-0000-4000-8000-000000000005',
  '61100000-0000-4000-8000-000000000005',
  'recovery',
  floor(extract(epoch from clock_timestamp()))::bigint
);
set local role authenticated;
select lives_ok(
  $$select public.issue_password_recovery_grant(repeat('1', 64))$$,
  'segundo recovery válido emite grant independente'
);
reset role;
select lives_ok(
  $$select * from private.begin_password_recovery(
      repeat('1', 64),
      '61200000-0000-4000-8000-000000000005'
    )$$,
  'segundo recovery reserva operação para testar compensação'
);
select throws_ok(
  $$select private.fail_password_recovery(
      (select id from private.auth_password_operations
       where correlation_id = '61200000-0000-4000-8000-000000000005'),
      'RAW_PROVIDER_DETAIL',
      '61200000-0000-4000-8000-000000000005'
    )$$,
  '22023', 'password_recovery_failure_reason_invalid',
  'fail aceita somente razão allowlisted'
);
select lives_ok(
  $$select private.fail_password_recovery(
      (select id from private.auth_password_operations
       where correlation_id = '61200000-0000-4000-8000-000000000005'),
      'AUTH_PROVIDER_FAILURE',
      '61200000-0000-4000-8000-000000000005'
    )$$,
  'fail terminaliza operação sem reabrir o profile'
);
select results_eq(
  $$select operation.status::text collate "default", operation.reason_code,
           operation.auth_updated_at is null,
           profile.must_change_password
    from private.auth_password_operations operation
    join public.profiles profile on profile.user_id = operation.target_user_id
    where operation.correlation_id = '61200000-0000-4000-8000-000000000005'$$,
  $$values ('failed', 'AUTH_PROVIDER_FAILURE', true, true)$$,
  'falha durável mantém RLS fechado e não registra senha'
);
select throws_ok(
  $$select * from private.begin_password_recovery(
      repeat('1', 64),
      '61200000-0000-4000-8000-000000000006'
    )$$,
  '28000', 'password_recovery_grant_invalid',
  'grant de operação falha também não é reutilizável'
);

select test_helpers.create_company_user(
  '61000000-0000-4000-8000-000000000006',
  'recovery-stale@example.test',
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000106',
  'member'
);
select test_helpers.create_auth_session(
  '61100000-0000-4000-8000-000000000006',
  '61000000-0000-4000-8000-000000000006',
  clock_timestamp() - interval '20 minutes'
);
insert into private.password_recovery_grants (
  grant_hash, user_id, session_id, expires_at,
  created_at, updated_at
) values (
  repeat('2', 64),
  '61000000-0000-4000-8000-000000000006',
  '61100000-0000-4000-8000-000000000006',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() - interval '11 minutes',
  clock_timestamp() - interval '11 minutes'
);
select throws_ok(
  $$select * from private.begin_password_recovery(
      repeat('2', 64),
      '61200000-0000-4000-8000-000000000007'
    )$$,
  '28000', 'password_recovery_grant_invalid',
  'grant expirado não altera profile nem cria operação'
);

select * from finish();
rollback;
