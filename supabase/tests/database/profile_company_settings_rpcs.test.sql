begin;
\ir helpers/fixtures.inc
select no_plan();

select has_function('private','internal_get_own_profile',array['uuid','uuid']);
select has_function('private','internal_update_own_profile',array['uuid','uuid','text','bigint','uuid']);
select has_function('private','internal_attach_own_avatar',array['uuid','uuid','uuid','bigint','uuid']);
select has_function('private','internal_sync_confirmed_profile_email',array['uuid','uuid','uuid']);
select has_function('private','internal_get_own_company_settings',array['uuid','uuid']);
select has_function(
  'private','internal_update_own_company_settings',array[
    'uuid','uuid','text','text','text','text','text','text','integer','text','numeric',
    'text','text','text','text','text','text','text','uuid','uuid','bigint','uuid'
  ]
);
select has_function('private','internal_get_own_company_settings_draft',array['uuid','uuid']);
select has_function(
  'private','internal_upsert_own_company_settings_draft',
  array['uuid','uuid','jsonb','bigint','bigint','uuid']
);
select has_function('private','internal_delete_own_company_settings_draft',array['uuid','uuid']);

select results_eq(
  $$select function.proname::text collate "default",owner.rolname::text collate "default",
           function.prosecdef,
           ('search_path=""'=any(coalesce(function.proconfig,'{}'::text[])))
      from pg_proc function
      join pg_namespace namespace on namespace.oid=function.pronamespace
      join pg_roles owner on owner.oid=function.proowner
     where namespace.nspname='private'
       and function.proname in (
         'assert_own_profile_actor','assert_own_company_settings_actor',
         'company_settings_safe_snapshot','validate_company_settings_draft_payload',
         'internal_get_own_profile','internal_update_own_profile',
         'internal_attach_own_avatar','internal_sync_confirmed_profile_email',
         'internal_get_own_company_settings','internal_update_own_company_settings',
         'internal_get_own_company_settings_draft',
         'internal_upsert_own_company_settings_draft',
         'internal_delete_own_company_settings_draft'
       ) order by function.proname$$,
  $$values
    ('assert_own_company_settings_actor','postgres',true,true),
    ('assert_own_profile_actor','postgres',true,true),
    ('company_settings_safe_snapshot','postgres',true,true),
    ('internal_attach_own_avatar','postgres',true,true),
    ('internal_delete_own_company_settings_draft','postgres',true,true),
    ('internal_get_own_company_settings','postgres',true,true),
    ('internal_get_own_company_settings_draft','postgres',true,true),
    ('internal_get_own_profile','postgres',true,true),
    ('internal_sync_confirmed_profile_email','postgres',true,true),
    ('internal_update_own_company_settings','postgres',true,true),
    ('internal_update_own_profile','postgres',true,true),
    ('internal_upsert_own_company_settings_draft','postgres',true,true),
    ('validate_company_settings_draft_payload','postgres',true,true)$$,
  'Task11 facades and helpers freeze owner/definer/search-path hardening'
);

select results_eq(
  $$select function.proname::text collate "default"
      from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
     where namespace.nspname='private'
       and function.proname in (
         'assert_own_profile_actor','assert_own_company_settings_actor',
         'company_settings_safe_snapshot','validate_company_settings_draft_payload',
         'internal_get_own_profile','internal_update_own_profile',
         'internal_attach_own_avatar','internal_sync_confirmed_profile_email',
         'internal_get_own_company_settings','internal_update_own_company_settings',
         'internal_get_own_company_settings_draft',
         'internal_upsert_own_company_settings_draft',
         'internal_delete_own_company_settings_draft'
       ) and has_function_privilege('axsys_bff',function.oid,'EXECUTE')
     order by function.proname$$,
  $$values
    ('internal_attach_own_avatar'),('internal_delete_own_company_settings_draft'),
    ('internal_get_own_company_settings'),('internal_get_own_company_settings_draft'),
    ('internal_get_own_profile'),('internal_sync_confirmed_profile_email'),
    ('internal_update_own_company_settings'),('internal_update_own_profile'),
    ('internal_upsert_own_company_settings_draft')$$,
  'BFF executes exactly nine Task11 facades and no helpers'
);

select is_empty(
  $$select role_name||':'||function.oid::regprocedure::text
      from unnest(array['public','anon','authenticated','service_role']) role_name
      cross join pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
     where namespace.nspname='private'
       and function.proname in (
         'assert_own_profile_actor','assert_own_company_settings_actor',
         'company_settings_safe_snapshot','validate_company_settings_draft_payload',
         'internal_get_own_profile','internal_update_own_profile',
         'internal_attach_own_avatar','internal_sync_confirmed_profile_email',
         'internal_get_own_company_settings','internal_update_own_company_settings',
         'internal_get_own_company_settings_draft',
         'internal_upsert_own_company_settings_draft',
         'internal_delete_own_company_settings_draft'
       ) and has_function_privilege(role_name,function.oid,'EXECUTE')$$,
  'PUBLIC/API/service roles cannot execute Task11 facades or helpers'
);

select is(
  (select count(*)::integer from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
   where namespace.nspname='private'
     and has_function_privilege('axsys_bff',function.oid,'EXECUTE')),
  64,'Task11 extends exact BFF catalog from 55 to 64'
);

select ok(
  not has_table_privilege('axsys_bff','public.profiles','SELECT')
  and not has_table_privilege('axsys_bff','public.company_settings','SELECT')
  and not has_table_privilege('axsys_bff','public.company_settings_drafts','SELECT')
  and not has_table_privilege('axsys_bff','public.file_objects','SELECT')
  and not has_table_privilege('axsys_bff','public.company_bank_accounts','SELECT'),
  'BFF receives no generic table reads for profile/settings'
);

select * from finish();
rollback;
