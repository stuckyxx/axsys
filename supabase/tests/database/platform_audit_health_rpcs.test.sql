begin;
\ir helpers/fixtures.inc

select no_plan();

select has_function(
  'private'::name,
  'internal_list_platform_audit_events'::name,
  array[
    'uuid','uuid','text','text','public.audit_outcome',
    'timestamp with time zone','uuid','integer'
  ],
  'BFF has one bounded platform-audit read boundary'
);

select has_function(
  'private'::name,
  'internal_get_platform_health'::name,
  array['uuid','uuid'],
  'BFF has one aggregate platform-health boundary'
);

select has_function(
  'private'::name,
  'internal_list_platform_admins'::name,
  array['uuid','uuid','text','timestamp with time zone','uuid','integer'],
  'BFF has a global keyset platform-admin directory'
);

select has_function(
  'private'::name,
  'internal_get_platform_dashboard'::name,
  array['uuid','uuid'],
  'BFF has one aggregate platform-dashboard boundary'
);

select results_eq(
  $$select function.proname::text collate "default",
           pg_get_function_identity_arguments(function.oid)::text collate "default",
           pg_get_function_result(function.oid)::text collate "default",
           owner.rolname::text collate "default",
           function.prosecdef,
           ('search_path=""'=any(coalesce(function.proconfig,'{}'::text[])))
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    join pg_roles owner on owner.oid=function.proowner
    where namespace.nspname='private'
      and function.proname in (
        'assert_platform_read_actor',
        'internal_get_platform_dashboard','internal_get_platform_health',
        'internal_list_platform_admins','internal_list_platform_audit_events',
        'platform_audit_safe_metadata'
      )
    order by function.proname$$,
  $$values
    ('assert_platform_read_actor',
      'p_actor_user_id uuid, p_session_id uuid','void','postgres',true,true),
    ('internal_get_platform_dashboard',
      'p_actor_user_id uuid, p_session_id uuid','jsonb','postgres',true,true),
    ('internal_get_platform_health',
      'p_actor_user_id uuid, p_session_id uuid','jsonb','postgres',true,true),
    ('internal_list_platform_admins',
      'p_actor_user_id uuid, p_session_id uuid, p_search text, p_cursor_created_at timestamp with time zone, p_cursor_membership_id uuid, p_limit integer',
      'jsonb','postgres',true,true),
    ('internal_list_platform_audit_events',
      'p_actor_user_id uuid, p_session_id uuid, p_action text, p_resource_type text, p_outcome audit_outcome, p_cursor_occurred_at timestamp with time zone, p_cursor_id uuid, p_limit integer',
      'jsonb','postgres',true,true),
    ('platform_audit_safe_metadata','p_metadata jsonb','jsonb','postgres',true,true)$$,
  'facades and sanitizer freeze signatures, owner and definer hardening'
);

select results_eq(
  $$select function.proname::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname in (
        'assert_platform_read_actor',
        'internal_get_platform_dashboard','internal_get_platform_health',
        'internal_list_platform_admins','internal_list_platform_audit_events',
        'platform_audit_safe_metadata'
      )
      and has_function_privilege('axsys_bff',function.oid,'EXECUTE')
    order by function.proname$$,
  $$values
    ('internal_get_platform_dashboard'),('internal_get_platform_health'),
    ('internal_list_platform_admins'),('internal_list_platform_audit_events')$$,
  'BFF executes exactly the four facades and never either helper'
);

select ok(
  exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname='assert_platform_read_actor'
      and function.prosrc not like '%pg_advisory_xact_lock(1672%'
  )
  and not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname in (
        'internal_get_platform_dashboard','internal_get_platform_health',
        'internal_list_platform_admins','internal_list_platform_audit_events'
      )
      and function.prosrc like '%assert_platform_provisioning_actor%'
  ),
  'read facades revalidate without taking the global mutation lock'
);

select is_empty(
  $$select role_name || ':' || function.oid::regprocedure::text
    from unnest(array['public','anon','authenticated','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and function.proname in (
        'assert_platform_read_actor',
        'internal_get_platform_dashboard','internal_get_platform_health',
        'internal_list_platform_admins','internal_list_platform_audit_events',
        'platform_audit_safe_metadata'
      )
      and has_function_privilege(role_name,function.oid,'EXECUTE')$$,
  'PUBLIC, API and service roles cannot execute platform observability routines'
);

select results_eq(
  $$select indexname::text collate "default"
    from pg_indexes
    where schemaname in ('public','private')
      and indexname in (
        'audit_events_platform_action_keyset_idx',
        'audit_events_platform_keyset_idx',
        'audit_events_platform_outcome_keyset_idx',
        'audit_events_platform_resource_keyset_idx',
        'companies_legal_name_trgm_idx',
        'company_bank_accounts_status_dashboard_idx',
        'company_memberships_active_dashboard_idx',
        'company_memberships_platform_admin_keyset_idx',
        'file_objects_scan_failures_health_idx',
        'file_upload_intents_cleanup_health_idx',
        'file_objects_usage_health_idx',
        'file_upload_intents_holds_health_idx',
        'provisioning_operations_reconcile_idx',
        'company_access_reconciliations_pending_idx',
        'member_auth_access_reconciliations_health_idx',
        'profiles_display_name_trgm_idx',
        'profiles_email_trgm_idx'
      )
    order by indexname$$,
  $$values
    ('audit_events_platform_action_keyset_idx'),
    ('audit_events_platform_keyset_idx'),
    ('audit_events_platform_outcome_keyset_idx'),
    ('audit_events_platform_resource_keyset_idx'),
    ('companies_legal_name_trgm_idx'),
    ('company_access_reconciliations_pending_idx'),
    ('company_bank_accounts_status_dashboard_idx'),
    ('company_memberships_active_dashboard_idx'),
    ('company_memberships_platform_admin_keyset_idx'),
    ('file_objects_scan_failures_health_idx'),
    ('file_objects_usage_health_idx'),
    ('file_upload_intents_cleanup_health_idx'),
    ('file_upload_intents_holds_health_idx'),
    ('member_auth_access_reconciliations_health_idx'),
    ('profiles_display_name_trgm_idx'),
    ('profiles_email_trgm_idx'),
    ('provisioning_operations_reconcile_idx')$$,
  'audit and aggregate health scans have supporting indexes'
);

select is(
  (select pg_catalog.count(*)::integer
     from pg_proc function
     join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='private'
      and has_function_privilege('axsys_bff',function.oid,'EXECUTE')),
  55,
  'the four platform read facades extend the existing 51-boundary catalog to 55'
);

select is_empty(
  $$select role_name || ':' || table_schema || '.' || table_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) role_name
    cross join information_schema.tables
    where (table_schema,table_name) in (
      ('public','audit_events'),('public','provisioning_operations'),
      ('public','file_objects'),('public','file_upload_intents'),
      ('private','company_storage_usage'),
      ('private','company_access_reconciliations'),
      ('private','member_auth_access_reconciliations')
    )
      and has_table_privilege(
        role_name,format('%I.%I',table_schema,table_name),'SELECT'
      )$$,
  'observability adds no generic table SELECT to any runtime role'
);

select * from finish();
rollback;
