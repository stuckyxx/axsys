begin;
\ir helpers/fixtures.inc
select no_plan();

select has_type('private'::name, 'auth_password_operation_kind'::name);
select has_type('private'::name, 'auth_password_operation_status'::name);
select results_eq(
  $$select type.typname::text collate "default",
           enum.enumlabel::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    join pg_enum enum on enum.enumtypid = type.oid
    where namespace.nspname = 'private'
      and type.typname in (
        'auth_password_operation_kind',
        'auth_password_operation_status'
      )
    order by type.typname, enum.enumsortorder$$,
  $$values
    ('auth_password_operation_kind', 'temporary_password_reset'),
    ('auth_password_operation_kind', 'temporary_password_change'),
    ('auth_password_operation_kind', 'password_recovery'),
    ('auth_password_operation_status', 'reserved'),
    ('auth_password_operation_status', 'auth_updated'),
    ('auth_password_operation_status', 'completed'),
    ('auth_password_operation_status', 'failed')$$,
  'tipos da saga expõem somente kind/status allowlisted'
);

select has_table('private'::name, 'auth_password_operations'::name);
select results_eq(
  $$select string_agg(column_name::text collate "default", ',' order by ordinal_position)::text
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'auth_password_operations'$$,
  $$values (
    'id,actor_user_id,target_user_id,scope,company_id,kind,status,correlation_id,reason_code,expires_at,reserved_at,auth_updated_at,completed_at,failed_at,created_at,updated_at'
  )$$,
  'operação durável contém somente identidade, escopo, estado e timestamps seguros'
);
select is_empty(
  $$select column_name
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'auth_password_operations'
      and column_name ~ '(password|email|token|request|metadata|payload|body)'$$,
  'operação nunca persiste senha, email, token, request ou metadata arbitrária'
);
select results_eq(
  $$select owner.rolname::text collate "default",
           class.relrowsecurity,
           class.relforcerowsecurity
    from pg_class class
    join pg_roles owner on owner.oid = class.relowner
    where class.oid = 'private.auth_password_operations'::regclass$$,
  $$values ('postgres', true, true)$$,
  'tabela privada pertence a postgres e força RLS'
);
select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'private'
      and tablename = 'auth_password_operations'$$,
  'operação privada não possui policy direta'
);
select is_empty(
  $$select role_name || ':' || privilege
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]) privilege
    where has_table_privilege(
      role_name,
      'private.auth_password_operations',
      privilege
    )$$,
  'nenhum papel de aplicação recebe CRUD/DDL na operação privada'
);
select results_eq(
  $$select count(*)::integer
    from pg_index index
    join pg_class class on class.oid = index.indexrelid
    where index.indrelid = 'private.auth_password_operations'::regclass
      and class.relname = 'auth_password_operations_target_nonterminal_key'
      and index.indisunique
      and index.indpred is not null
      and pg_get_expr(index.indpred, index.indrelid) like '%reserved%'
      and pg_get_expr(index.indpred, index.indrelid) like '%auth_updated%'$$,
  $$values (1)$$,
  'índice parcial único impede duas operações nonterminal para o mesmo alvo'
);

select has_function(
  'private'::name,
  'begin_temporary_password_reset'::name,
  array['uuid','uuid','uuid','uuid']
);
select has_function(
  'private'::name,
  'complete_temporary_password_reset'::name,
  array['uuid','uuid','uuid','uuid']
);
select has_function(
  'private'::name,
  'fail_temporary_password_reset'::name,
  array['uuid','uuid','uuid','text','uuid']
);
select has_function(
  'private'::name,
  'complete_temporary_password_change'::name,
  array['uuid','uuid','uuid']
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
        'begin_temporary_password_reset',
        'complete_temporary_password_reset',
        'fail_temporary_password_reset',
        'complete_temporary_password_change'
      )
    order by function.proname$$,
  $$values
    ('begin_temporary_password_reset',
      'p_actor_user_id uuid, p_session_id uuid, p_target_user_id uuid, p_correlation_id uuid',
      'TABLE(operation_id uuid, expires_at timestamp with time zone)',
      'postgres', true, true),
    ('complete_temporary_password_change',
      'p_actor_user_id uuid, p_session_id uuid, p_correlation_id uuid',
      'void', 'postgres', true, true),
    ('complete_temporary_password_reset',
      'p_actor_user_id uuid, p_session_id uuid, p_operation_id uuid, p_correlation_id uuid',
      'void', 'postgres', true, true),
    ('fail_temporary_password_reset',
      'p_actor_user_id uuid, p_session_id uuid, p_operation_id uuid, p_reason_code text, p_correlation_id uuid',
      'void', 'postgres', true, true)$$,
  'quatro boundaries têm assinatura, owner, definer e search_path congelados'
);
select results_eq(
  $$select function.proname::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.proname$$,
  $$values
    ('activate_file_upload_authorization'),
    ('assert_auth_session'),
    ('authorize_image_file_download'),
    ('begin_password_recovery'),
    ('begin_temporary_password_reset'),
    ('cancel_stale_reserved_upload_intents'),
    ('cancel_unissued_file_reservation'),
    ('claim_upload_authorizations_for_retirement'),
    ('clear_rate_limit'),
    ('complete_download_audit'),
    ('complete_password_recovery'),
    ('complete_temporary_password_change'),
    ('complete_temporary_password_reset'),
    ('complete_upload_authorization_retirement'),
    ('consume_rate_limit'),
    ('fail_closed_login_session'),
    ('fail_password_recovery'),
    ('fail_temporary_password_reset'),
    ('internal_begin_file_finalization'),
    ('internal_finalize_file_upload'),
    ('internal_mark_file_cleanup_required'),
    ('internal_reject_file_upload'),
    ('internal_release_file_finalization_for_retry'),
    ('list_company_user_directory'),
    ('register_auth_session'),
    ('release_upload_authorization_retirement_claim'),
    ('reserve_image_upload_intent'),
    ('revoke_sessions_and_write_logout'),
    ('rotate_app_session_after_reauthentication'),
    ('write_authenticated_audit_event'),
    ('write_security_event')$$,
  'BFF preserva as boundaries anteriores e recebe somente as fachadas Task 4'
);
select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'begin_temporary_password_reset',
        'complete_temporary_password_reset',
        'fail_temporary_password_reset',
        'complete_temporary_password_change'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'PUBLIC/API/service role não executam boundaries de senha'
);

grant usage on schema extensions to authenticated, service_role;
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
      'grant execute on function %s to authenticated, service_role',
      pgtap_function.signature
    );
  end loop;
end
$$;
set local role service_role;
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      null::uuid, null::uuid, null::uuid, null::uuid
    )$$,
  '42501', 'permission denied for schema private',
  'service_role é realmente recusada antes de executar a boundary'
);
reset role;
set local role authenticated;
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      null::uuid, null::uuid, null::uuid, null::uuid
    )$$,
  '42501', 'permission denied for function begin_temporary_password_reset',
  'authenticated é realmente recusado ao executar a boundary'
);
reset role;

create function test_helpers.activate_password_test_session(
  p_session_id uuid,
  p_user_id uuid,
  p_scope public.audit_scope,
  p_company_id uuid default null,
  p_created_at timestamptz default clock_timestamp()
) returns void
language plpgsql
as $$
begin
  perform test_helpers.create_auth_session(p_session_id, p_user_id, p_created_at);
  insert into private.auth_session_controls (
    session_id, user_id, auth_created_at, remember_me, state,
    absolute_expires_at, audit_scope, audit_company_id,
    activated_at, last_seen_at, created_at, updated_at
  ) values (
    p_session_id, p_user_id, p_created_at, false, 'active',
    p_created_at + interval '8 hours', p_scope, p_company_id,
    p_created_at, p_created_at, p_created_at, p_created_at
  );
end;
$$;

-- Plataforma, empresa A e empresa B.
select test_helpers.create_auth_user(
  '41000000-0000-4000-8000-000000000001', 'task12-platform@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '41000000-0000-4000-8000-000000000001',
  'task12-platform@example.test', 'Task 12 Plataforma'
);
insert into public.platform_roles (user_id)
values ('41000000-0000-4000-8000-000000000001');
select test_helpers.activate_password_test_session(
  '41100000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001', 'platform'
);

select test_helpers.create_company_user(
  '42000000-0000-4000-8000-000000000001',
  'task12-admin-a@example.test',
  '42000000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000011',
  'company_admin', array['administrative']::public.module_key[]
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', 'tenant',
  '42000000-0000-4000-8000-000000000010'
);
select test_helpers.create_company_user(
  '42000000-0000-4000-8000-000000000002',
  'task12-member-a@example.test',
  '42000000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000012',
  'member', array['administrative']::public.module_key[]
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000002', 'tenant',
  '42000000-0000-4000-8000-000000000010'
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000004',
  '42000000-0000-4000-8000-000000000002', 'tenant',
  '42000000-0000-4000-8000-000000000010'
);
select test_helpers.create_company_user(
  '42000000-0000-4000-8000-000000000003',
  'task12-member-ordinary@example.test',
  '42000000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000013',
  'member', '{}'::public.module_key[]
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000001', 'tenant',
  '42000000-0000-4000-8000-000000000010',
  clock_timestamp() - interval '9 hours'
);
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000010',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000020'
    )$$,
  '23514', 'auth_password_actor_session_invalid',
  'sessão administrativa expirada não reserva operação'
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000011',
  '42000000-0000-4000-8000-000000000001', 'tenant',
  '42000000-0000-4000-8000-000000000010'
);
update private.auth_session_controls
set state = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
where session_id = '42100000-0000-4000-8000-000000000011';
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000011',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000021'
    )$$,
  '23514', 'auth_password_actor_session_invalid',
  'sessão administrativa revogada não reserva operação'
);
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000003',
  '42000000-0000-4000-8000-000000000003', 'tenant',
  '42000000-0000-4000-8000-000000000010'
);
select test_helpers.create_company_user(
  '43000000-0000-4000-8000-000000000002',
  'task12-member-b@example.test',
  '43000000-0000-4000-8000-000000000019',
  '43000000-0000-4000-8000-000000000012',
  'member', '{}'::public.module_key[]
);
select test_helpers.activate_password_test_session(
  '43100000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000002', 'tenant',
  '43000000-0000-4000-8000-000000000019'
);
select test_helpers.activate_password_test_session(
  '43100000-0000-4000-8000-000000000002',
  '43000000-0000-4000-8000-000000000002', 'tenant',
  '43000000-0000-4000-8000-000000000019'
);

select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000001'
    )$$,
  'P0002', 'auth_password_target_not_found',
  'admin A recebe not-found neutro ao mirar tenant B'
);
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000099',
      '44000000-0000-4000-8000-000000000002'
    )$$,
  'P0002', 'auth_password_target_not_found',
  'UUID aleatório recebe o mesmo not-found'
);
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000003',
      '42100000-0000-4000-8000-000000000003',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000003'
    )$$,
  '42501', 'auth_password_reset_forbidden',
  'membro comum não redefine senha'
);
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000004'
    )$$,
  '42501', 'auth_password_reset_forbidden',
  'reset administrativo de si próprio é recusado'
);

select lives_ok(
  $$select * from private.begin_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000010'
    )$$,
  'super admin reserva reset de identidade empresarial'
);
select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000011'
    )$$,
  '23505', 'auth_password_operation_in_progress',
  'replay/concurrency serializada não cria segunda operação nonterminal'
);
select throws_ok(
  $$select private.complete_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000010'),
      '44000000-0000-4000-8000-000000000011'
    )$$,
  '23514', 'auth_password_operation_correlation_mismatch',
  'conclusão não aceita correlation divergente da reserva'
);
select lives_ok(
  $$select private.complete_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000010'),
      '44000000-0000-4000-8000-000000000010'
    )$$,
  'super admin conclui com a correlação original'
);
select results_eq(
  $$select operation.scope::text collate "default", operation.company_id,
           operation.status::text collate "default",
           count(audit.id)::integer,
           bool_and(audit.correlation_id = operation.correlation_id)
    from private.auth_password_operations operation
    join public.audit_events audit
      on audit.correlation_id = operation.correlation_id
    where operation.correlation_id = '44000000-0000-4000-8000-000000000010'
    group by operation.id$$,
  $$values ('platform', null::uuid, 'completed', 2, true)$$,
  'reserva e conclusão platform usam exatamente a correlação durável'
);
select results_eq(
  $$select count(*)::integer
    from private.auth_session_controls
    where user_id = '43000000-0000-4000-8000-000000000002'
      and state = 'revoked'$$,
  $$values (2)$$,
  'reset platform revoga todas as sessões do alvo'
);

select lives_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000005'
    )$$,
  'admin A reserva reset do membro A'
);
select results_eq(
  $$select must_change_password,
           temporary_password_expires_at > clock_timestamp() + interval '23 hours 59 minutes',
           temporary_password_expires_at <= clock_timestamp() + interval '24 hours'
    from public.profiles
    where user_id = '42000000-0000-4000-8000-000000000002'$$,
  $$values (true, true, true)$$,
  'flag é fechada e expira em no máximo 24 horas antes do Auth'
);
select results_eq(
  $$select count(*)::integer
    from private.auth_session_controls
    where user_id = '42000000-0000-4000-8000-000000000002'
      and state = 'revoked'$$,
  $$values (2)$$,
  'todas as sessões antigas do alvo são revogadas na reserva'
);
select results_eq(
  $$select kind::text collate "default", status::text collate "default",
           scope::text collate "default", company_id,
           reason_code is null
    from private.auth_password_operations
    where correlation_id = '44000000-0000-4000-8000-000000000005'$$,
  $$values (
    'temporary_password_reset', 'reserved', 'tenant',
    '42000000-0000-4000-8000-000000000010'::uuid, true
  )$$,
  'reserva persiste somente estado e escopo autoritativos'
);
select results_eq(
  $$select action::text collate "default", resource_id, metadata
    from public.audit_events
    where correlation_id = '44000000-0000-4000-8000-000000000005'$$,
  $$values (
    'auth.temporary_password_reset_reserved',
    '42000000-0000-4000-8000-000000000002'::uuid,
    '{}'::jsonb
  )$$,
  'reserva audita sem senha ou metadata livre'
);

-- O JWT antigo continua criptograficamente representável, mas a RLS o fecha.
select test_helpers.set_jwt(
  '42000000-0000-4000-8000-000000000002',
  '42100000-0000-4000-8000-000000000002'
);
select is(private.has_active_app_session(), false,
  'helper RLS recusa imediatamente o JWT da sessão revogada');
select test_helpers.clear_jwt();

select throws_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000012'
    )$$,
  '23505', 'auth_password_operation_in_progress',
  'alvo tenant também admite somente uma reserva nonterminal'
);
select throws_ok(
  $$select private.fail_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000005'),
      'AUTH_PROVIDER_FAILURE',
      '44000000-0000-4000-8000-000000000006'
    )$$,
  '23514', 'auth_password_operation_correlation_mismatch',
  'falha não aceita correlation divergente da reserva'
);
update public.profiles
set must_change_password = true,
    temporary_password_expires_at = clock_timestamp() + interval '1 hour'
where user_id = '42000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.fail_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000005'),
      'AUTH_PROVIDER_FAILURE',
      '44000000-0000-4000-8000-000000000005'
    )$$,
  '42501', 'auth_password_reset_forbidden',
  'ator em forced-change não conclui nem marca falha tenant'
);
update public.profiles
set must_change_password = false,
    temporary_password_expires_at = null
where user_id = '42000000-0000-4000-8000-000000000001';
update public.companies
set status = 'archived', archived_at = clock_timestamp(),
    archived_by = '41000000-0000-4000-8000-000000000001'
where id = '42000000-0000-4000-8000-000000000010';
select throws_ok(
  $$select private.fail_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000005'),
      'AUTH_PROVIDER_FAILURE',
      '44000000-0000-4000-8000-000000000005'
    )$$,
  '23514', 'auth_identity_invalid',
  'fail revalida scope/company ativo do ator tenant'
);
update public.companies
set status = 'active', archived_at = null, archived_by = null
where id = '42000000-0000-4000-8000-000000000010';

select throws_ok(
  $$select private.fail_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000005'),
      'RAW_PROVIDER_MESSAGE',
      '44000000-0000-4000-8000-000000000005'
    )$$,
  '22023', 'auth_password_failure_reason_invalid',
  'falha rejeita razão não allowlisted'
);
select lives_ok(
  $$select private.fail_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000005'),
      'AUTH_PROVIDER_FAILURE',
      '44000000-0000-4000-8000-000000000005'
    )$$,
  'falha segura marca a reserva sem reabrir o alvo'
);
select results_eq(
  $$select operation.status::text collate "default", operation.reason_code,
           profile.must_change_password
    from private.auth_password_operations operation
    join public.profiles profile on profile.user_id = operation.target_user_id
    where operation.correlation_id = '44000000-0000-4000-8000-000000000005'$$,
  $$values ('failed', 'AUTH_PROVIDER_FAILURE', true)$$,
  'falha durável mantém forced-change fechado'
);

select lives_ok(
  $$select * from private.begin_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000007'
    )$$,
  'retry seguro cria uma nova reserva'
);
select throws_ok(
  $$select private.complete_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000007'),
      '44000000-0000-4000-8000-000000000008'
    )$$,
  '23514', 'auth_password_operation_correlation_mismatch',
  'complete tenant rejeita correlation divergente'
);
update public.profiles
set temporary_password_expires_at = clock_timestamp() - interval '1 second'
where user_id = '42000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select private.complete_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000007'),
      '44000000-0000-4000-8000-000000000007'
    )$$,
  '23514', 'auth_password_operation_invalid',
  'complete rejeita senha provisória já expirada'
);
update public.profiles profile
set temporary_password_expires_at = operation.expires_at
from private.auth_password_operations operation
where profile.user_id = operation.target_user_id
  and operation.correlation_id = '44000000-0000-4000-8000-000000000007';
select lives_ok(
  $$select private.complete_temporary_password_reset(
      '42000000-0000-4000-8000-000000000001',
      '42100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000007'),
      '44000000-0000-4000-8000-000000000007'
    )$$,
  'conclusão administrativa marca Auth atualizado'
);
select results_eq(
  $$select operation.status::text collate "default",
           operation.auth_updated_at is not null,
           operation.completed_at is not null,
           profile.must_change_password
    from private.auth_password_operations operation
    join public.profiles profile on profile.user_id = operation.target_user_id
    where operation.correlation_id = '44000000-0000-4000-8000-000000000007'$$,
  $$values ('completed', true, true, true)$$,
  'reset completo ainda exige troca pelo usuário'
);
select results_eq(
  $$select count(*)::integer,
           bool_and(audit.correlation_id = operation.correlation_id)
    from private.auth_password_operations operation
    join public.audit_events audit
      on audit.correlation_id = operation.correlation_id
    where operation.correlation_id = '44000000-0000-4000-8000-000000000007'$$,
  $$values (2, true)$$,
  'audit tenant deriva a mesma correlation da operação'
);

-- Uma reserva órfã nunca bloqueia o alvo para sempre: somente após o prazo
-- uma autoridade atual pode reconciliar e criar a próxima reserva.
update public.profiles
set temporary_password_expires_at = clock_timestamp() - interval '1 hour'
where user_id = '42000000-0000-4000-8000-000000000002';
with captured as (select clock_timestamp() as captured_at)
insert into private.auth_password_operations (
  actor_user_id, target_user_id, scope, company_id, kind, status,
  correlation_id, expires_at, reserved_at, created_at, updated_at
)
select
  '42000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000002',
  'tenant', '42000000-0000-4000-8000-000000000010',
  'temporary_password_reset', 'reserved',
  '44000000-0000-4000-8000-000000000030',
  captured.captured_at - interval '1 hour',
  captured.captured_at - interval '25 hours',
  captured.captured_at - interval '25 hours',
  captured.captured_at - interval '25 hours'
from captured;
update public.profiles
set is_active = false
where user_id = '42000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select * from private.begin_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000031'
    )$$,
  'super admin atual reconcilia reserva expirada de ator perdido'
);
select results_eq(
  $$select status::text collate "default", reason_code
    from private.auth_password_operations
    where correlation_id = '44000000-0000-4000-8000-000000000030'$$,
  $$values ('failed', 'OPERATION_EXPIRED')$$,
  'reserva órfã expirada é terminalizada com razão segura'
);
select results_eq(
  $$select actor_user_id, action::text collate "default", reason_code,
           correlation_id
    from public.audit_events
    where correlation_id = '44000000-0000-4000-8000-000000000030'$$,
  $$values (
    '41000000-0000-4000-8000-000000000001'::uuid,
    'auth.temporary_password_reset_reconciled',
    'OPERATION_EXPIRED',
    '44000000-0000-4000-8000-000000000030'::uuid
  )$$,
  'reconciliação audita autoridade atual e correlation da operação expirada'
);
select results_eq(
  $$select scope::text collate "default", status::text collate "default"
    from private.auth_password_operations
    where correlation_id = '44000000-0000-4000-8000-000000000031'$$,
  $$values ('platform', 'reserved')$$,
  'nova reserva nasce somente após a anterior ficar terminal'
);
select lives_ok(
  $$select private.fail_temporary_password_reset(
      '41000000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      (select id from private.auth_password_operations
       where correlation_id = '44000000-0000-4000-8000-000000000031'),
      'AUTH_CALL_NOT_ATTEMPTED',
      '44000000-0000-4000-8000-000000000031'
    )$$,
  'nova reserva platform pode ser terminalizada normalmente'
);

-- Nova sessão Auth criada depois do cutoff representa o login com senha provisória.
select test_helpers.activate_password_test_session(
  '42100000-0000-4000-8000-000000000020',
  '42000000-0000-4000-8000-000000000002', 'tenant',
  '42000000-0000-4000-8000-000000000010',
  clock_timestamp()
);
select lives_ok(
  $$select private.complete_temporary_password_change(
      '42000000-0000-4000-8000-000000000002',
      '42100000-0000-4000-8000-000000000020',
      '44000000-0000-4000-8000-000000000009'
    )$$,
  'usuário conclui troca obrigatória atomicamente'
);
select results_eq(
  $$select must_change_password, temporary_password_expires_at is null,
           password_changed_at is not null
    from public.profiles
    where user_id = '42000000-0000-4000-8000-000000000002'$$,
  $$values (false, true, true)$$,
  'troca limpa flag/expiração e grava timestamp'
);
select results_eq(
  $$select state::text collate "default"
    from private.auth_session_controls
    where session_id = '42100000-0000-4000-8000-000000000020'$$,
  $$values ('revoked')$$,
  'troca obrigatória revoga globalmente a própria sessão'
);
select results_eq(
  $$select kind::text collate "default", status::text collate "default",
           actor_user_id = target_user_id, reason_code is null
    from private.auth_password_operations
    where correlation_id = '44000000-0000-4000-8000-000000000009'$$,
  $$values ('temporary_password_change', 'completed', true, true)$$,
  'troca cria operação terminal segura do próprio usuário'
);

select throws_ok(
  $$update private.auth_password_operations
    set reason_code = 'AUTH_PROVIDER_FAILURE'
    where correlation_id = '44000000-0000-4000-8000-000000000009'$$,
  '55000', 'auth_password_operation_terminal',
  'operação terminal não pode ser reescrita'
);

select * from finish();
rollback;
