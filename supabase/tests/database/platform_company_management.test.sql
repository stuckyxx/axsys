begin;
\ir helpers/fixtures.inc

select no_plan();

select has_function(
  'private'::name,
  'internal_update_company'::name,
  array[
    'uuid','uuid','uuid','text','text','text','text','text','bigint','uuid'
  ]
);
select has_function(
  'private'::name,
  'internal_set_company_status'::name,
  array['uuid','uuid','uuid','public.company_status','bigint','text','uuid']
);
select has_function(
  'private'::name,
  'internal_list_companies'::name,
  array[
    'uuid','uuid','text','public.company_status','timestamp with time zone',
    'uuid','integer'
  ]
);
select has_function(
  'private'::name,
  'internal_get_company_detail'::name,
  array['uuid','uuid','uuid']
);
select has_function(
  'private'::name,
  'internal_complete_company_access_reconciliation'::name,
  array['uuid','uuid','uuid','uuid[]','uuid']
);
select has_function(
  'private'::name,
  'internal_commit_company_provisioning'::name,
  array[
    'uuid','uuid','uuid','uuid','uuid','text','text','text','text','text',
    'text','text','text','public.module_key[]','uuid'
  ]
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
        'internal_complete_company_access_reconciliation',
        'internal_get_company_detail',
        'internal_list_companies',
        'internal_set_company_status',
        'internal_update_company'
      )
    order by function.proname$$,
  $$values
    ('internal_complete_company_access_reconciliation',
      'p_actor_user_id uuid, p_session_id uuid, p_reconciliation_id uuid, p_failed_user_ids uuid[], p_correlation_id uuid',
      'jsonb','postgres',true,true),
    ('internal_get_company_detail',
      'p_actor_user_id uuid, p_session_id uuid, p_company_id uuid',
      'jsonb','postgres',true,true),
    ('internal_list_companies',
      'p_actor_user_id uuid, p_session_id uuid, p_search text, p_status company_status, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_limit integer',
      'jsonb','postgres',true,true),
    ('internal_set_company_status',
      'p_actor_user_id uuid, p_session_id uuid, p_company_id uuid, p_target_status company_status, p_expected_version bigint, p_reason text, p_correlation_id uuid',
      'jsonb','postgres',true,true),
    ('internal_update_company',
      'p_actor_user_id uuid, p_session_id uuid, p_company_id uuid, p_legal_name text, p_trade_name text, p_contact_email text, p_contact_phone text, p_timezone text, p_expected_version bigint, p_correlation_id uuid',
      'jsonb','postgres',true,true)$$,
  'company management boundaries freeze signatures, owner and definer hardening'
);

select results_eq(
  $$select function.oid::regprocedure::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'internal_commit_company_provisioning',
        'internal_complete_company_access_reconciliation',
        'internal_get_company_detail',
        'internal_list_companies',
        'internal_set_company_status',
        'internal_update_company'
      )
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.oid::regprocedure::text$$,
  $$values
    ('private.internal_commit_company_provisioning(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,module_key[],uuid)'),
    ('private.internal_complete_company_access_reconciliation(uuid,uuid,uuid,uuid[],uuid)'),
    ('private.internal_get_company_detail(uuid,uuid,uuid)'),
    ('private.internal_list_companies(uuid,uuid,text,company_status,timestamp with time zone,uuid,integer)'),
    ('private.internal_set_company_status(uuid,uuid,uuid,company_status,bigint,text,uuid)'),
    ('private.internal_update_company(uuid,uuid,uuid,text,text,text,text,text,bigint,uuid)')$$,
  'BFF receives the text provisioning facade and exactly five management boundaries'
);
select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname in (
        'internal_complete_company_access_reconciliation',
        'internal_get_company_detail',
        'internal_list_companies',
        'internal_set_company_status',
        'internal_update_company'
      )
      and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'PUBLIC, API roles and service role cannot execute company management'
);
select is_empty(
  $$select function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'internal_commit_company_provisioning'
      and pg_get_function_identity_arguments(function.oid) like '%citext%'
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')$$,
  'the citext provisioning core remains owner-only'
);
select ok(
  has_schema_privilege('axsys_bff', 'public', 'USAGE')
  and not has_schema_privilege('axsys_bff', 'public', 'CREATE')
  and not has_schema_privilege('axsys_bff', 'extensions', 'USAGE')
  and not has_schema_privilege('axsys_bff', 'extensions', 'CREATE'),
  'BFF resolves public enums but cannot resolve extension functions or types'
);
select results_eq(
  $$select type.typname::text collate "default"
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname in (
        'company_status','module_key','provisioning_status'
      )
      and has_type_privilege('axsys_bff', type.oid, 'USAGE')
    order by type.typname$$,
  $$values ('company_status'),('module_key'),('provisioning_status')$$,
  'BFF receives only the three public enum grants required by typed boundaries'
);
select is_empty(
  $$select namespace.nspname || ':' || function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public','extensions')
      and has_schema_privilege('axsys_bff', namespace.oid, 'USAGE')
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')$$,
  'BFF has zero effectively executable functions outside private'
);

select has_table(
  'private'::name,
  'company_access_reconciliations'::name
);
select results_eq(
  $$select owner.rolname::text collate "default",
           class.relrowsecurity, class.relforcerowsecurity
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    join pg_roles owner on owner.oid = class.relowner
    where namespace.nspname = 'private'
      and class.relname = 'company_access_reconciliations'$$,
  $$values ('postgres'::text collate "default",true,true)$$,
  'Auth reconciliation state is owner-only and FORCE RLS'
);
select is_empty(
  $$select policy.policyname
    from pg_policies policy
    where policy.schemaname = 'private'
      and policy.tablename = 'company_access_reconciliations'$$,
  'Auth reconciliation state has zero bypass policies'
);
select is_empty(
  $$select role_name || ':' || privilege_type
    from unnest(array[
      'public','anon','authenticated','service_role','axsys_bff'
    ]) role_name
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege_type
    where has_table_privilege(
      role_name,
      'private.company_access_reconciliations',
      privilege_type
    )$$,
  'no runtime role can directly read or mutate reconciliation state'
);
select results_eq(
  $$select string_agg(column_name,',' order by ordinal_position)::text
             collate "default"
    from information_schema.columns
    where table_schema='private'
      and table_name='company_access_reconciliations'$$,
  $$values (
    'id,company_id,company_version,target_status,affected_user_ids,failed_user_ids,status,attempt_count,actor_user_id,correlation_id,last_completion_correlation_id,created_at,updated_at,completed_at'::text collate "default"
  )$$,
  'reconciliation persistence freezes a UUID-only no-PII contract'
);
select is_empty(
  $$select column_name
    from information_schema.columns
    where table_schema='private'
      and table_name='company_access_reconciliations'
      and column_name ~* '(email|name|phone|document|reason|password|token)'$$,
  'reconciliation persistence contains no direct identity or secret columns'
);

select ok(
  pg_get_functiondef(
    'private.internal_update_company(uuid,uuid,uuid,text,text,text,text,text,bigint,uuid)'::regprocedure
  ) ~ 'timezone[[:space:]]*=[[:space:]]*v_timezone'
  and pg_get_functiondef(
    'private.internal_update_company(uuid,uuid,uuid,text,text,text,text,text,bigint,uuid)'::regprocedure
  ) !~ 'timezone[[:space:]]*=[[:space:]]*p_timezone',
  'update persists only the owner-resolved canonical timezone variable'
);

create function test_helpers.activate_company_management_session(
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
  '25000000-0000-4000-8000-000000000100',
  'platform-company-manager@example.test'
);
insert into public.profiles(user_id,email,display_name)
values (
  '25000000-0000-4000-8000-000000000100',
  'platform-company-manager@example.test',
  'Platform Company Manager'
);
insert into public.platform_roles(user_id,role,is_active)
values ('25000000-0000-4000-8000-000000000100','super_admin',true);
select test_helpers.activate_company_management_session(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '87000000-0000-4000-8000-000000000100'
);

select test_helpers.create_company_user(
  '25000000-0000-4000-8000-000000000101',
  'active-company-admin@example.test',
  '35000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000101',
  'company_admin',
  array['administrative']::public.module_key[]
);
select test_helpers.create_company_user(
  '25000000-0000-4000-8000-000000000102',
  'suspended-company-member@example.test',
  '35000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000102',
  'member',
  '{}'::public.module_key[]
);
update public.company_memberships
set status = 'suspended',
    suspended_at = pg_catalog.clock_timestamp(),
    suspended_by = '25000000-0000-4000-8000-000000000101',
    suspension_reason = 'Suspended management fixture'
where id = '45000000-0000-4000-8000-000000000102';
select test_helpers.activate_company_management_session(
  '25000000-0000-4000-8000-000000000101',
  '95000000-0000-4000-8000-000000000101',
  '87000000-0000-4000-8000-000000000101'
);

insert into public.companies (
  id,legal_name,trade_name,cnpj_normalized,contact_email,contact_phone,
  timezone,status,archived_at,archived_by,created_at,updated_at
) values
  (
    '35000000-0000-4000-8000-000000000102',
    'Arquivo Público Nordeste Ltda.','Arquivo Nordeste','10000000000002',
    'contato-arquivo@example.test',null,'America/Recife','archived',
    pg_catalog.statement_timestamp() - interval '1 hour',
    '25000000-0000-4000-8000-000000000100',
    pg_catalog.statement_timestamp() - interval '2 hours',
    pg_catalog.statement_timestamp() - interval '1 hour'
  ),
  (
    '35000000-0000-4000-8000-000000000103',
    'Zeta Serviços Públicos Ltda.','Zeta Serviços','10000000000003',
    'contato-zeta@example.test','+5585999990000','America/Fortaleza',
    'active',null,null,
    pg_catalog.statement_timestamp() + interval '1 hour',
    pg_catalog.statement_timestamp() + interval '1 hour'
  );

insert into public.company_bank_accounts (
  id,company_id,bank_code,bank_name,
  branch_ciphertext,branch_iv,branch_tag,branch_key_version,branch_last4,
  account_ciphertext,account_iv,account_tag,account_key_version,account_last4,
  account_type,holder_name,status,is_default,created_by,updated_by
) values (
  '55000000-0000-4000-8000-000000000101',
  '35000000-0000-4000-8000-000000000101',
  '001','Banco Seguro','c2VjcmV0','AAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAA==',1,'0123','c2VjcmV0',
  'AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==',1,'9876','checking',
  'Titular Confidencial','active',true,
  '25000000-0000-4000-8000-000000000101',
  '25000000-0000-4000-8000-000000000101'
);

create temporary table company_management_results(
  label text primary key,
  result jsonb not null
);
grant select, insert on company_management_results to axsys_bff;
grant axsys_bff to postgres;

set local role axsys_bff;
insert into company_management_results(label,result)
select 'list-first', private.internal_list_companies(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  null,null::public.company_status,null,null,1
);
insert into company_management_results(label,result)
select 'list-second', private.internal_list_companies(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  null,null::public.company_status,
  (result->'nextCursor'->>'createdAt')::timestamptz,
  (result->'nextCursor'->>'id')::uuid,
  1
)
from company_management_results
where label='list-first';
insert into company_management_results(label,result)
select 'list-archived', private.internal_list_companies(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  'Arquivo Público','archived'::public.company_status,null,null,25
);
insert into company_management_results(label,result)
select 'list-literal-wildcard', private.internal_list_companies(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '%',null::public.company_status,null,null,25
);
insert into company_management_results(label,result)
select 'detail', private.internal_get_company_detail(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101'
);
reset role;

select results_eq(
  $$select array(select pg_catalog.jsonb_object_keys(result) order by 1),
           pg_catalog.jsonb_array_length(result->'items'),
           array(select pg_catalog.jsonb_object_keys(result->'items'->0)
                 order by 1),
           result->'nextCursor' is not null
    from company_management_results where label='list-first'$$,
  $$values (
    array['items','nextCursor']::text[],1,
    array[
      'cnpj','contactEmail','contactPhone','createdAt','id','legalName',
      'status','timezone','tradeName','updatedAt','version'
    ]::text[],true
  )$$,
  'list returns one exact allowlisted page and an internal keyset cursor'
);
select results_eq(
  $$select first.result->'items'->0->>'id',
           second.result->'items'->0->>'id',
           first.result->'items'->0->>'id'
             <> second.result->'items'->0->>'id'
    from company_management_results first
    cross join company_management_results second
    where first.label='list-first' and second.label='list-second'$$,
  $$select first.result->'items'->0->>'id',
           second.result->'items'->0->>'id',true
    from company_management_results first
    cross join company_management_results second
    where first.label='list-first' and second.label='list-second'$$,
  'keyset pagination advances without duplicating the boundary row'
);
select results_eq(
  $$select pg_catalog.jsonb_array_length(result->'items'),
           result->'items'->0->>'id',result->'items'->0->>'status'
    from company_management_results where label='list-archived'$$,
  $$values (
    1,'35000000-0000-4000-8000-000000000102','archived'
  )$$,
  'list applies parameterized literal search and typed status filtering'
);
select is(
  (select pg_catalog.jsonb_array_length(result->'items')
   from company_management_results where label='list-literal-wildcard'),
  0,
  'search treats SQL wildcard characters as ordinary text'
);
select results_eq(
  $$select array(select pg_catalog.jsonb_object_keys(result) order by 1),
           array(select pg_catalog.jsonb_object_keys(result->'company')
                 order by 1),
           result->'admins',result->'bankAccounts',result->'counters',
           result::text !~* '(ciphertext|holder|userId|password)'
    from company_management_results where label='detail'$$,
  $$values (
    array['admins','bankAccounts','company','counters']::text[],
    array[
      'cnpj','contactEmail','contactPhone','createdAt','id','legalName',
      'status','timezone','tradeName','updatedAt','version'
    ]::text[],
    '[{"id":"45000000-0000-4000-8000-000000000101","status":"active","displayName":"active-company-admin"}]'::jsonb,
    '[{"id":"55000000-0000-4000-8000-000000000101","status":"active","version":1,"bankCode":"001","bankName":"Banco Seguro","isDefault":true,"accountType":"checking","branchLast4":"0123","accountLast4":"9876"}]'::jsonb,
    '{"activeAdmins":1,"activeUsers":1,"bankAccounts":1}'::jsonb,
    true
  )$$,
  'detail exposes only masked bank data, display name and aggregate counters'
);
select throws_ok(
  $$select private.internal_list_companies(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      null,null::public.company_status,pg_catalog.clock_timestamp(),null,25
    )$$,
  '22023','AXSYS_COMPANY_LIST_INPUT_INVALID',
  'list rejects half-specified cursor tuples'
);
select throws_ok(
  $$select private.internal_list_companies(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      repeat('x',101),null::public.company_status,null,null,25
    )$$,
  '22023','AXSYS_COMPANY_LIST_INPUT_INVALID',
  'list enforces bounded search before reading companies'
);
select throws_ok(
  $$select private.internal_get_company_detail(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000999'
    )$$,
  'P0001','AXSYS_COMPANY_NOT_FOUND',
  'detail uses the stable non-enumerating not-found error'
);
select throws_ok(
  $$select private.internal_get_company_detail(
      '25000000-0000-4000-8000-000000000101',
      '95000000-0000-4000-8000-000000000101',
      '35000000-0000-4000-8000-000000000999'
    )$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'detail authenticates the platform actor before company lookup'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'update', private.internal_update_company(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101',
  'Empresa Gerenciada Atualizada Ltda.',
  'Empresa Gerenciada',
  'contato-gerenciada@example.test',
  '+5585999999999',
  'Brazil/East',
  1,
  '87000000-0000-4000-8000-000000000110'
);
reset role;

select results_eq(
  $$select legal_name,trade_name,contact_email::text,contact_phone,timezone,
           status::text,version,archived_at,archived_by
    from public.companies
    where id='35000000-0000-4000-8000-000000000101'$$,
  $$values (
    'Empresa Gerenciada Atualizada Ltda.','Empresa Gerenciada',
    'contato-gerenciada@example.test','+5585999999999','America/Sao_Paulo',
    'active',2::bigint,null::timestamptz,null::uuid
  )$$,
  'optimistic update persists only allowlisted fields and canonical timezone'
);
select results_eq(
  $$select array(select jsonb_object_keys(result) order by 1),
           array(select jsonb_object_keys(result->'company') order by 1),
           result->'company'->>'id',
           (result->'company'->>'version')::bigint,
           result::text !~* '(archivedBy|password|reason)'
    from company_management_results where label='update'$$,
  $$values (
    array['company']::text[],
    array[
      'archivedAt','cnpj','contactEmail','contactPhone','createdAt','id',
      'legalName','status','timezone','tradeName','updatedAt','version'
    ]::text[],
    '35000000-0000-4000-8000-000000000101',2::bigint,true
  )$$,
  'update returns an exact allowlisted snapshot without internal actor data'
);

select throws_ok(
  $$select private.internal_update_company(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000101',
      'Empresa Inválida Ltda.','Empresa Inválida',
      'invalida@example.test',null,'america/fortaleza',2,
      '87000000-0000-4000-8000-000000000111'
    )$$,
  '22023','AXSYS_INVALID_TIMEZONE',
  'case-variant timezone is rejected before company mutation'
);
select is(
  (select version from public.companies
    where id='35000000-0000-4000-8000-000000000101'),
  2::bigint,
  'invalid timezone leaves the optimistic version unchanged'
);
select throws_ok(
  $$select private.internal_update_company(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000101',
      'Empresa Stale Ltda.','Empresa Stale','stale@example.test',null,
      'America/Fortaleza',1,
      '87000000-0000-4000-8000-000000000112'
    )$$,
  'P0001','AXSYS_VERSION_CONFLICT',
  'stale optimistic update receives the frozen version conflict'
);
select throws_ok(
  $$select private.internal_update_company(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000999',
      'Empresa Ausente Ltda.','Empresa Ausente','ausente@example.test',null,
      'America/Fortaleza',1,
      '87000000-0000-4000-8000-000000000113'
    )$$,
  'P0001','AXSYS_COMPANY_NOT_FOUND',
  'unknown company receives the non-enumerating not-found error'
);
select throws_ok(
  $$select private.internal_update_company(
      '25000000-0000-4000-8000-000000000101',
      '95000000-0000-4000-8000-000000000101',
      '35000000-0000-4000-8000-000000000101',
      'Empresa Indevida Ltda.','Empresa Indevida','indevida@example.test',null,
      'America/Fortaleza',2,
      '87000000-0000-4000-8000-000000000114'
    )$$,
  '23514','AXSYS_PLATFORM_SESSION_INVALID',
  'tenant-scoped administrator cannot invoke platform company management'
);

select throws_ok(
  $$select private.internal_set_company_status(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000101',
      'archived'::public.company_status,2,'curto',
      '87000000-0000-4000-8000-000000000115'
    )$$,
  '22023','AXSYS_COMPANY_INPUT_INVALID',
  'archive reason must contain ten to five hundred trimmed characters'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'archive', private.internal_set_company_status(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101',
  'archived'::public.company_status,
  2,
  'Encerramento solicitado pelo responsável.',
  '87000000-0000-4000-8000-000000000120'
);
reset role;

select results_eq(
  $$select status::text,version,archived_at is not null,archived_by
    from public.companies
    where id='35000000-0000-4000-8000-000000000101'$$,
  $$values (
    'archived',3::bigint,true,
    '25000000-0000-4000-8000-000000000100'::uuid
  )$$,
  'archive atomically changes lifecycle fields and increments version once'
);
select results_eq(
  $$select result->'company'->>'status',
           (result->'company'->>'version')::bigint,
           result->'affectedUserIds',
           result->>'reconciliationId'
    from company_management_results where label='archive'$$,
  $$values (
    'archived',3::bigint,
    '["25000000-0000-4000-8000-000000000101","25000000-0000-4000-8000-000000000102"]'::jsonb,
    (select reconciliation.id::text
     from private.company_access_reconciliations reconciliation
     where reconciliation.company_id='35000000-0000-4000-8000-000000000101'
       and reconciliation.company_version=3)
  )$$,
  'archive returns every membership identity and its durable Auth saga ID'
);
select results_eq(
  $$select company_id,company_version,target_status::text,
           affected_user_ids,failed_user_ids,status,attempt_count,
           actor_user_id,correlation_id,
           last_completion_correlation_id,completed_at,
           updated_at >= created_at
    from private.company_access_reconciliations
    where company_id='35000000-0000-4000-8000-000000000101'
      and company_version=3$$,
  $$values (
    '35000000-0000-4000-8000-000000000101'::uuid,3::bigint,'archived',
    array[
      '25000000-0000-4000-8000-000000000101'::uuid,
      '25000000-0000-4000-8000-000000000102'::uuid
    ],'{}'::uuid[],'pending',0,
    '25000000-0000-4000-8000-000000000100'::uuid,
    '87000000-0000-4000-8000-000000000120'::uuid,
    null::uuid,null::timestamptz,true
  )$$,
  'archive persists pending no-PII reconciliation in the same transaction'
);
select results_eq(
  $$select scope::text,company_id,actor_user_id,action,resource_type,
           resource_id,outcome::text,reason_code,correlation_id,metadata
    from public.audit_events
    where correlation_id='87000000-0000-4000-8000-000000000120'$$,
  $$values (
    'platform',null::uuid,'25000000-0000-4000-8000-000000000100'::uuid,
    'company.archived','company','35000000-0000-4000-8000-000000000101'::uuid,
    'success',null::text,'87000000-0000-4000-8000-000000000120'::uuid,
    '{"nextStatus":"archived","previousStatus":"active"}'::jsonb
  )$$,
  'archive audit is atomic, redacted and records only status vocabulary'
);
select is_empty(
  $$select audit.id from public.audit_events audit
    where audit.correlation_id='87000000-0000-4000-8000-000000000120'
      and to_jsonb(audit)::text ~* 'Encerramento solicitado'$$,
  'archive reason plaintext never reaches audit persistence'
);
select throws_ok(
  $$select private.internal_set_company_status(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000101',
      'archived'::public.company_status,2,
      'Encerramento solicitado pelo responsável.',
      '87000000-0000-4000-8000-000000000121'
    )$$,
  'P0001','AXSYS_VERSION_CONFLICT',
  'stale version conflicts even when target status already matches'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'archive-replay', private.internal_set_company_status(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101',
  'archived'::public.company_status,
  3,
  'Encerramento solicitado pelo responsável.',
  '87000000-0000-4000-8000-000000000122'
);
reset role;
select results_eq(
  $$select (replay.result->'company'->>'version')::bigint,
           replay.result->'affectedUserIds',
           replay.result->>'reconciliationId'
             = archive.result->>'reconciliationId'
    from company_management_results replay
    cross join company_management_results archive
    where replay.label='archive-replay' and archive.label='archive'$$,
  $$values (
    3::bigint,
    '["25000000-0000-4000-8000-000000000101","25000000-0000-4000-8000-000000000102"]'::jsonb,
    true
  )$$,
  'same destination with current version returns the same durable saga'
);
select is(
  (select count(*) from public.audit_events
    where action='company.archived'
      and resource_id='35000000-0000-4000-8000-000000000101'),
  1::bigint,
  'idempotent archive creates no duplicate audit event'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'reconcile-failed',
       private.internal_complete_company_access_reconciliation(
         '25000000-0000-4000-8000-000000000100',
         '95000000-0000-4000-8000-000000000100',
         (archive.result->>'reconciliationId')::uuid,
         array['25000000-0000-4000-8000-000000000102'::uuid],
         '87000000-0000-4000-8000-000000000130'
       )
from company_management_results archive
where archive.label='archive';
insert into company_management_results(label,result)
select 'reconcile-failed-replay',
       private.internal_complete_company_access_reconciliation(
         '25000000-0000-4000-8000-000000000100',
         '95000000-0000-4000-8000-000000000100',
         (archive.result->>'reconciliationId')::uuid,
         array['25000000-0000-4000-8000-000000000102'::uuid],
         '87000000-0000-4000-8000-000000000130'
       )
from company_management_results archive
where archive.label='archive';
reset role;

select results_eq(
  $$select result->>'status',result->'failedUserIds',
           (result->>'attemptCount')::integer,
           result=(select replay.result from company_management_results replay
                   where replay.label='reconcile-failed-replay')
    from company_management_results where label='reconcile-failed'$$,
  $$values (
    'pending',
    '["25000000-0000-4000-8000-000000000102"]'::jsonb,
    1,true
  )$$,
  'failed Auth completion remains pending and correlation replay is idempotent'
);
select results_eq(
  $$select failed_user_ids,status,attempt_count,
           last_completion_correlation_id,completed_at
    from private.company_access_reconciliations
    where id=(select (result->>'reconciliationId')::uuid
              from company_management_results where label='archive')$$,
  $$values (
    array['25000000-0000-4000-8000-000000000102'::uuid],
    'pending',1,
    '87000000-0000-4000-8000-000000000130'::uuid,null::timestamptz
  )$$,
  'pending saga durably retains only failed UUIDs for a later retry'
);
select throws_ok(
  $$select private.internal_complete_company_access_reconciliation(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      (select (result->>'reconciliationId')::uuid
       from company_management_results where label='archive'),
      array['25000000-0000-4000-8000-000000000999'::uuid],
      '87000000-0000-4000-8000-000000000131'
    )$$,
  '22023','AXSYS_RECONCILIATION_FAILED_USERS_INVALID',
  'completion rejects IDs outside the operation affected-user allowlist'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'reconcile-complete',
       private.internal_complete_company_access_reconciliation(
         '25000000-0000-4000-8000-000000000100',
         '95000000-0000-4000-8000-000000000100',
         (archive.result->>'reconciliationId')::uuid,
         '{}'::uuid[],
         '87000000-0000-4000-8000-000000000132'
       )
from company_management_results archive
where archive.label='archive';
insert into company_management_results(label,result)
select 'reconcile-complete-replay',
       private.internal_complete_company_access_reconciliation(
         '25000000-0000-4000-8000-000000000100',
         '95000000-0000-4000-8000-000000000100',
         (archive.result->>'reconciliationId')::uuid,
         '{}'::uuid[],
         '87000000-0000-4000-8000-000000000133'
       )
from company_management_results archive
where archive.label='archive';
reset role;

select results_eq(
  $$select completed_result.result->>'status',
           completed_result.result->'failedUserIds',
           (completed_result.result->>'attemptCount')::integer,
           completed_result.result->>'reconciliationId'
             = replay.result->>'reconciliationId',
           (replay.result->>'attemptCount')::integer
    from company_management_results completed_result
    cross join company_management_results replay
    where completed_result.label='reconcile-complete'
      and replay.label='reconcile-complete-replay'$$,
  $$values ('complete','[]'::jsonb,2,true,2)$$,
  'empty failure set completes once and terminal empty replay stays idempotent'
);
select throws_ok(
  $$select private.internal_complete_company_access_reconciliation(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      (select (result->>'reconciliationId')::uuid
       from company_management_results where label='archive'),
      array['25000000-0000-4000-8000-000000000101'::uuid],
      '87000000-0000-4000-8000-000000000134'
    )$$,
  'P0001','AXSYS_RECONCILIATION_COMPLETE',
  'terminal reconciliation cannot be reopened by a stale failed attempt'
);

select throws_ok(
  $$select private.internal_set_company_status(
      '25000000-0000-4000-8000-000000000100',
      '95000000-0000-4000-8000-000000000100',
      '35000000-0000-4000-8000-000000000101',
      'active'::public.company_status,3,'reason is forbidden',
      '87000000-0000-4000-8000-000000000123'
    )$$,
  '22023','AXSYS_COMPANY_INPUT_INVALID',
  'reactivation accepts only a null reason'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'reactivate', private.internal_set_company_status(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101',
  'active'::public.company_status,
  3,
  null,
  '87000000-0000-4000-8000-000000000124'
);
reset role;

select results_eq(
  $$select status::text,version,archived_at,archived_by
    from public.companies
    where id='35000000-0000-4000-8000-000000000101'$$,
  $$values ('active',4::bigint,null::timestamptz,null::uuid)$$,
  'reactivation clears archive fields and increments version once'
);
select results_eq(
  $$select management.result->'company'->>'status',
           (management.result->'company'->>'version')::bigint,
           management.result->'affectedUserIds',
           management.result->>'reconciliationId'
             = reconciliation.id::text
    from company_management_results management
    join private.company_access_reconciliations reconciliation
      on reconciliation.company_id='35000000-0000-4000-8000-000000000101'
     and reconciliation.company_version=4
    where management.label='reactivate'$$,
  $$values (
    'active',4::bigint,
    '["25000000-0000-4000-8000-000000000101"]'::jsonb,
    true
  )$$,
  'reactivation returns active memberships and its second durable saga'
);
select results_eq(
  $$select action,metadata
    from public.audit_events
    where correlation_id='87000000-0000-4000-8000-000000000124'$$,
  $$values (
    'company.reactivated',
    '{"nextStatus":"active","previousStatus":"archived"}'::jsonb
  )$$,
  'reactivation audit is atomic and contains only status vocabulary'
);

set local role axsys_bff;
insert into company_management_results(label,result)
select 'reactivate-replay', private.internal_set_company_status(
  '25000000-0000-4000-8000-000000000100',
  '95000000-0000-4000-8000-000000000100',
  '35000000-0000-4000-8000-000000000101',
  'active'::public.company_status,
  4,
  null,
  '87000000-0000-4000-8000-000000000125'
);
reset role;
select is(
  (select count(*) from public.audit_events
    where action in ('company.archived','company.reactivated')
      and resource_id='35000000-0000-4000-8000-000000000101'),
  2::bigint,
  'idempotent reactivation creates no duplicate audit event'
);
select results_eq(
  $$select (replay.result->'company'->>'version')::bigint,
           replay.result->'affectedUserIds',
           replay.result->>'reconciliationId'
             = transition.result->>'reconciliationId'
    from company_management_results replay
    cross join company_management_results transition
    where replay.label='reactivate-replay'
      and transition.label='reactivate'$$,
  $$values (
    4::bigint,
    '["25000000-0000-4000-8000-000000000101"]'::jsonb,
    true
  )$$,
  'idempotent reactivation preserves version and reuses its pending saga'
);
select results_eq(
  $$select company_version,target_status::text,status,attempt_count,
           affected_user_ids,failed_user_ids
    from private.company_access_reconciliations
    where company_id='35000000-0000-4000-8000-000000000101'
    order by company_version$$,
  $$values
    (3::bigint,'archived','complete',2,
     array[
       '25000000-0000-4000-8000-000000000101'::uuid,
       '25000000-0000-4000-8000-000000000102'::uuid
     ],'{}'::uuid[]),
    (4::bigint,'active','pending',0,
     array['25000000-0000-4000-8000-000000000101'::uuid],
     '{}'::uuid[])$$,
  'each lifecycle version has one durable saga and a crash leaves pending work'
);

select * from finish();
rollback;
