begin;
\ir helpers/fixtures.inc

select no_plan();

select has_function(
  'private'::name,
  'internal_upsert_bank_account'::name,
  array[
    'uuid','uuid','uuid','uuid','text','text','text','text','text','integer',
    'text','text','text','text','integer','text','public.bank_account_type',
    'text','text','text','text','integer','text','boolean','bigint','uuid'
  ],
  'BFF has one encrypted create/update boundary'
);

select has_function(
  'private'::name,
  'internal_set_default_bank_account'::name,
  array['uuid','uuid','uuid','uuid','bigint','uuid'],
  'BFF has an atomic default boundary'
);

select has_function(
  'private'::name,
  'internal_archive_bank_account'::name,
  array['uuid','uuid','uuid','uuid','uuid','text','bigint','uuid'],
  'BFF has an atomic archive boundary'
);

select has_function(
  'private'::name,
  'internal_list_company_bank_accounts'::name,
  array['uuid','uuid','uuid'],
  'BFF has a masked-only platform read boundary'
);

select results_eq(
  $$select function.proname::text collate "default",
           owner.rolname::text collate "default",
           function.prosecdef,
           ('search_path=""'=any(coalesce(function.proconfig,'{}'::text[])))
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    join pg_roles owner on owner.oid=function.proowner
    where namespace.nspname='private'
      and function.proname in (
        'assert_recent_platform_bank_actor','bank_account_masked_summary',
        'internal_archive_bank_account','internal_list_company_bank_accounts',
        'internal_set_default_bank_account','internal_upsert_bank_account'
      )
    order by function.proname$$,
  $$values
    ('assert_recent_platform_bank_actor','postgres',true,true),
    ('bank_account_masked_summary','postgres',true,true),
    ('internal_archive_bank_account','postgres',true,true),
    ('internal_list_company_bank_accounts','postgres',true,true),
    ('internal_set_default_bank_account','postgres',true,true),
    ('internal_upsert_bank_account','postgres',true,true)$$,
  'bank boundaries and helpers freeze owner, definer and empty search path'
);

select results_eq(
  $$select function.proname::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname in (
        'assert_recent_platform_bank_actor','bank_account_masked_summary',
        'internal_archive_bank_account','internal_list_company_bank_accounts',
        'internal_set_default_bank_account','internal_upsert_bank_account'
      )
      and has_function_privilege('axsys_bff',function.oid,'EXECUTE')
    order by function.proname$$,
  $$values
    ('internal_archive_bank_account'),('internal_list_company_bank_accounts'),
    ('internal_set_default_bank_account'),('internal_upsert_bank_account')$$,
  'BFF executes exactly the four bank facades, never owner-only helpers'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname in (
        'assert_recent_platform_bank_actor','bank_account_masked_summary',
        'internal_archive_bank_account','internal_list_company_bank_accounts',
        'internal_set_default_bank_account','internal_upsert_bank_account'
      )
      and has_function_privilege(role_name,function.oid,'EXECUTE')$$,
  'PUBLIC and API roles cannot execute bank facades or helpers'
);

select ok(
  has_type_privilege('axsys_bff','public.bank_account_type','USAGE')
  and not has_type_privilege('axsys_bff','public.bank_account_status','USAGE'),
  'BFF receives only the enum required by an input signature'
);

select ok(
  (select class.relrowsecurity and class.relforcerowsecurity
   from pg_class class
   where class.oid='public.company_bank_accounts'::regclass),
  'encrypted bank rows remain protected by enabled and forced RLS'
);

select is_empty(
  $$select role_name || ':' || column_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array[
      'branch_ciphertext','branch_iv','branch_tag','account_ciphertext',
      'account_iv','account_tag','holder_document_ciphertext',
      'holder_document_iv','holder_document_tag'
    ]) column_name
    where has_column_privilege(
      role_name,'public.company_bank_accounts',column_name,'SELECT'
    )$$,
  'no runtime role can select encrypted payloads, IVs or tags directly'
);

select ok(
  (select view.is_trigger_updatable='NO'
   from information_schema.views view
   where view.table_schema='public'
     and view.table_name='company_bank_account_summaries')
  and pg_get_viewdef('public.company_bank_account_summaries'::regclass)
    !~ '(ciphertext|_iv|_tag|key_version)',
  'tenant view is read-only and contains masked-only columns'
);

select * from finish();
rollback;
