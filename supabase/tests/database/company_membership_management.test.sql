begin;
select plan(18);

select has_function('private', 'internal_reserve_company_admin_provisioning',
  array['uuid','uuid','uuid','text','text','text','uuid']);
select has_function('private', 'internal_commit_company_admin_provisioning',
  array['uuid','uuid','uuid','uuid','uuid','text','text','module_key[]','uuid']);
select has_function('private', 'internal_platform_update_company_admin',
  array['uuid','uuid','uuid','text','membership_status','module_key[]','text','bigint','uuid']);
select has_function('private', 'internal_get_company_user', array['uuid','uuid','uuid']);
select has_function('private', 'internal_get_platform_company_admin', array['uuid','uuid','uuid']);
select has_function('private', 'internal_find_provisioning_auth_user',
  array['uuid','uuid','uuid','text']);
select has_function('private', 'internal_complete_member_auth_access_reconciliation',
  array['uuid','uuid','uuid','uuid','boolean','text','uuid']);

select has_table(
  'private'::name,'member_auth_access_reconciliations'::name
);
select is_empty(
  $$select column_name from information_schema.columns
    where table_schema='private' and table_name='member_auth_access_reconciliations'
      and column_name ~* '(email|name|phone|document|password|token|reason|payload|metadata)'$$,
  'Auth access reconciliation state contains no PII, reason or arbitrary payload'
);

select has_function('public', 'company_reserve_member_provisioning',
  array['text','text','text','uuid']);
select has_function('public', 'company_commit_member_provisioning',
  array['uuid','uuid','text','text','membership_role','module_key[]','uuid']);
select has_function('public', 'company_update_membership',
  array['uuid','text','membership_role','membership_status','module_key[]','text','bigint','uuid']);
select has_function('public', 'company_get_api_access_context', array[]::text[]);

select results_eq(
  $$select function.proname::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
    order by function.proname$$,
  $$select expected collate "default" from (
    values
      ('activate_file_upload_authorization'),('assert_auth_session'),
      ('authorize_image_file_download'),('begin_password_recovery'),
      ('begin_temporary_password_reset'),('cancel_stale_reserved_upload_intents'),
      ('cancel_unissued_file_reservation'),('claim_upload_authorizations_for_retirement'),
      ('clear_rate_limit'),('complete_download_audit'),('complete_password_recovery'),
      ('complete_temporary_password_change'),('complete_temporary_password_reset'),
      ('complete_upload_authorization_retirement'),('consume_rate_limit'),
      ('fail_closed_login_session'),('fail_password_recovery'),
      ('fail_temporary_password_reset'),('internal_archive_bank_account'),
      ('internal_begin_file_finalization'),
      ('internal_commit_company_admin_provisioning'),('internal_commit_company_provisioning'),
      ('internal_complete_member_auth_access_reconciliation'),
      ('internal_complete_company_access_reconciliation'),('internal_finalize_file_upload'),
      ('internal_get_company_detail'),('internal_get_company_user'),
      ('internal_get_platform_company_admin'),('internal_list_companies'),
      ('internal_find_provisioning_auth_user'),
      ('internal_list_company_bank_accounts'),
      ('internal_mark_file_cleanup_required'),('internal_mark_provisioning_auth_created'),
      ('internal_mark_provisioning_compensation'),('internal_platform_update_company_admin'),
      ('internal_reject_file_upload'),('internal_release_file_finalization_for_retry'),
      ('internal_reserve_company_admin_provisioning'),('internal_reserve_company_provisioning'),
      ('internal_set_company_status'),('internal_set_default_bank_account'),
      ('internal_update_company'),('internal_upsert_bank_account'),
      ('list_company_user_directory'),
      ('register_auth_session'),('release_upload_authorization_retirement_claim'),
      ('reserve_image_upload_intent'),('revoke_sessions_and_write_logout'),
      ('rotate_app_session_after_reauthentication'),('write_authenticated_audit_event'),
      ('write_security_event')
  ) names(expected) order by expected$$,
  'BFF catalog contains exactly 51 purpose-specific boundaries'
);

select is_empty(
  $$select function.oid::regprocedure::text
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname like 'internal_%company%admin%'
      and has_function_privilege('authenticated', function.oid, 'EXECUTE')$$,
  'authenticated cannot execute platform administration boundaries'
);

select results_eq(
  $$select function.proname::text collate "default"
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname like 'company_%member%provisioning'
      and has_function_privilege('authenticated', function.oid, 'EXECUTE')
    order by function.proname$$,
  $$values ('company_commit_member_provisioning'),('company_reserve_member_provisioning')$$,
  'authenticated receives only the two member provisioning boundaries'
);

select ok(
  has_function_privilege('authenticated',
    'public.company_update_membership(uuid,text,membership_role,membership_status,module_key[],text,bigint,uuid)'::regprocedure,
    'EXECUTE'),
  'authenticated can update a membership through the scoped boundary'
);

select is_empty(
  $$select role_name, function.oid::regprocedure::text
    from unnest(array['public','anon','service_role']) role_name
    cross join pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where function.proname in (
      'company_reserve_member_provisioning',
      'company_commit_member_provisioning',
      'company_get_api_access_context',
      'company_update_membership'
    ) and has_function_privilege(role_name, function.oid, 'EXECUTE')$$,
  'PUBLIC anon and service_role cannot execute company membership mutations'
);

select * from finish();
rollback;
