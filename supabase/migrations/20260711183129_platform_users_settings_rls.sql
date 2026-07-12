do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PLATFORM_USERS_SETTINGS_RLS_MIGRATION_OWNER_INVALID';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_namespace namespace
    where namespace.nspname = 'private'
      and namespace.nspowner = 'postgres'::regrole
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PRIVATE_SCHEMA_OWNER_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) grant_item
    left join pg_catalog.pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace in (
        0,
        'public'::regnamespace,
        'private'::regnamespace
      )
      and defaults.defaclobjtype in ('r', 'S', 'f', 'T')
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon', 'authenticated', 'service_role', 'axsys_bff')
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PLATFORM_USERS_SETTINGS_RLS_DEFAULT_ACL_INVALID';
  end if;
end
$$;

revoke all on public.file_objects,
  public.file_upload_intents,
  public.company_bank_accounts,
  public.company_settings,
  public.company_settings_drafts,
  public.provisioning_operations
from public, anon, authenticated, service_role, axsys_bff;

create function private.reserve_image_upload_intent(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_purpose text,
  p_declared_name text,
  p_declared_mime text,
  p_declared_size bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role public.membership_role;
  v_target_resource_id uuid;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_purpose is null
     or p_declared_name is null
     or p_declared_mime is null
     or p_declared_size is null
     or p_purpose not in (
       'profile_avatar',
       'company_letterhead',
       'company_signature'
     )
     or p_declared_mime not in ('image/png', 'image/jpeg', 'image/webp')
     or p_declared_size not between 1 and 5242880 then
    raise exception using
      errcode = '22023',
      message = 'image_upload_input_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);
  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using
      errcode = '23514',
      message = 'image_upload_actor_session_invalid';
  end if;

  select membership.company_id, membership.role
  into v_company_id, v_role
  from public.company_memberships membership
  join public.companies company on company.id = membership.company_id
  join public.profiles profile on profile.user_id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'::public.membership_status
    and company.status = 'active'::public.company_status
    and profile.is_active
    and not profile.must_change_password;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'image_upload_forbidden';
  end if;

  if not exists (
    select 1
    from private.auth_session_controls control
    where control.session_id = p_session_id
      and control.user_id = p_actor_user_id
      and control.state = 'active'::private.auth_session_state
      and control.audit_scope = 'tenant'::public.audit_scope
      and control.audit_company_id = v_company_id
      and control.revoked_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'image_upload_actor_session_invalid';
  end if;

  if p_purpose = 'profile_avatar' then
    v_target_resource_id := p_actor_user_id;
  else
    if v_role <> 'company_admin'::public.membership_role then
      raise exception using
        errcode = '42501',
        message = 'image_upload_forbidden';
    end if;
    v_target_resource_id := v_company_id;
  end if;

  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  return private.reserve_upload_capability_core(
    v_company_id,
    p_actor_user_id,
    p_purpose::public.file_purpose,
    v_target_resource_id,
    p_declared_name,
    p_declared_mime,
    p_declared_size
  );
end;
$$;

revoke execute on function private.reserve_image_upload_intent(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
)
from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.reserve_image_upload_intent(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
)
to axsys_bff;

create function private.activate_file_upload_authorization(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_issued_at timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null or p_intent_id is null then
    raise exception using
      errcode = '22023',
      message = 'upload_authorization_input_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);
  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using
      errcode = '23514',
      message = 'upload_authorization_actor_session_invalid';
  end if;

  select intent.*
  into v_intent
  from public.file_upload_intents intent
  where intent.id = p_intent_id
    and intent.actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'upload_intent_not_found';
  end if;

  if not exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    join public.profiles profile on profile.user_id = membership.user_id
    join private.auth_session_controls control
      on control.session_id = p_session_id
     and control.user_id = membership.user_id
    where membership.company_id = v_intent.company_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'::public.membership_status
      and company.status = 'active'::public.company_status
      and profile.is_active
      and not profile.must_change_password
      and control.state = 'active'::private.auth_session_state
      and control.audit_scope = 'tenant'::public.audit_scope
      and control.audit_company_id = membership.company_id
      and control.revoked_at is null
  ) then
    raise exception using
      errcode = '42501',
      message = 'upload_authorization_forbidden';
  end if;

  if v_intent.status = 'issued'::public.upload_intent_status
     and v_intent.authorization_issued_at is not null
     and v_intent.upload_authorization_expires_at is not null
     and v_intent.cleanup_not_before is not null
     and v_intent.authorization_retired_at is null then
    return pg_catalog.jsonb_build_object(
      'uploadAuthorizationExpiresAt', v_intent.upload_authorization_expires_at,
      'finalizeBefore', v_intent.cleanup_not_before
    );
  end if;

  if v_intent.status is distinct from 'reserved'::public.upload_intent_status
     or v_intent.authorization_issued_at is not null
     or v_intent.upload_authorization_expires_at is not null
     or v_intent.cleanup_not_before is not null
     or v_intent.authorization_retired_at is not null
     or v_intent.authorization_cleanup_claim_id is not null
     or v_intent.authorization_cleanup_claimed_at is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using
      errcode = '23514',
      message = 'upload_authorization_state_invalid';
  end if;

  -- This commit point is deliberately before the Task 4 Storage/TUS call.
  -- Once these deadlines exist, failure or ambiguity outside PostgreSQL must
  -- preserve the capability hold until cleanup_not_before.
  v_issued_at := pg_catalog.clock_timestamp();
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update public.file_upload_intents intent
  set status = 'issued'::public.upload_intent_status,
      authorization_issued_at = v_issued_at,
      upload_authorization_expires_at = v_issued_at + interval '2 hours',
      cleanup_not_before = v_issued_at + interval '26 hours 15 minutes',
      version = intent.version + 1,
      updated_at = v_issued_at
  where intent.id = v_intent.id
    and intent.status = 'reserved'::public.upload_intent_status
    and intent.authorization_issued_at is null
    and intent.upload_authorization_expires_at is null
    and intent.cleanup_not_before is null
    and intent.authorization_retired_at is null;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'upload_authorization_activation_lost';
  end if;

  return pg_catalog.jsonb_build_object(
    'uploadAuthorizationExpiresAt', v_issued_at + interval '2 hours',
    'finalizeBefore', v_issued_at + interval '26 hours 15 minutes'
  );
end;
$$;

revoke execute on function private.activate_file_upload_authorization(uuid,uuid,uuid)
from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.activate_file_upload_authorization(uuid,uuid,uuid)
to axsys_bff;

create function private.cancel_unissued_file_reservation(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_usage private.company_storage_usage%rowtype;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null or p_intent_id is null then
    raise exception using
      errcode = '22023',
      message = 'upload_cancellation_input_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);
  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using
      errcode = '23514',
      message = 'upload_cancellation_actor_session_invalid';
  end if;

  select intent.*
  into v_intent
  from public.file_upload_intents intent
  where intent.id = p_intent_id
    and intent.actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'upload_intent_not_found';
  end if;

  if not exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    join public.profiles profile on profile.user_id = membership.user_id
    join private.auth_session_controls control
      on control.session_id = p_session_id
     and control.user_id = membership.user_id
    where membership.company_id = v_intent.company_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'::public.membership_status
      and company.status = 'active'::public.company_status
      and profile.is_active
      and not profile.must_change_password
      and control.state = 'active'::private.auth_session_state
      and control.audit_scope = 'tenant'::public.audit_scope
      and control.audit_company_id = membership.company_id
      and control.revoked_at is null
  ) then
    raise exception using
      errcode = '42501',
      message = 'upload_cancellation_forbidden';
  end if;

  if v_intent.status is distinct from 'reserved'::public.upload_intent_status
     or v_intent.authorization_issued_at is not null
     or v_intent.upload_authorization_expires_at is not null
     or v_intent.cleanup_not_before is not null
     or v_intent.authorization_retired_at is not null
     or v_intent.authorization_cleanup_claim_id is not null
     or v_intent.authorization_cleanup_claimed_at is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using
      errcode = '23514',
      message = 'upload_reservation_not_cancellable';
  end if;

  select usage.*
  into v_usage
  from private.company_storage_usage usage
  where usage.company_id = v_intent.company_id
  for update;
  if not found or v_usage.reserved_bytes < v_intent.quota_hold_bytes then
    raise exception using
      errcode = '23514',
      message = 'company_storage_quota_inconsistent';
  end if;

  v_now := pg_catalog.clock_timestamp();
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update private.company_storage_usage usage
  set reserved_bytes = usage.reserved_bytes - v_intent.quota_hold_bytes,
      version = usage.version + 1,
      updated_at = v_now
  where usage.company_id = v_intent.company_id;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'company_storage_quota_update_lost';
  end if;

  update public.file_upload_intents intent
  set status = 'cancelled'::public.upload_intent_status,
      quota_hold_bytes = 0,
      authorization_retired_at = v_now,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.status = 'reserved'::public.upload_intent_status
    and intent.authorization_issued_at is null
    and intent.upload_authorization_expires_at is null
    and intent.cleanup_not_before is null
    and intent.authorization_retired_at is null;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'upload_reservation_cancellation_lost';
  end if;
end;
$$;

revoke execute on function private.cancel_unissued_file_reservation(uuid,uuid,uuid)
from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.cancel_unissued_file_reservation(uuid,uuid,uuid)
to axsys_bff;

grant select (
  id,
  company_id,
  owner_user_id,
  purpose,
  detected_mime,
  byte_size,
  scan_status,
  status,
  created_at,
  promoted_at,
  archived_at
) on public.file_objects to authenticated;

grant select (
  id,
  company_id,
  actor_user_id,
  purpose,
  target_resource_id,
  declared_mime,
  declared_size,
  status,
  file_object_id,
  created_at
) on public.file_upload_intents to authenticated;

grant select (
  id,
  company_id,
  bank_code,
  bank_name,
  branch_last4,
  account_last4,
  account_type,
  holder_name,
  holder_document_last4,
  status,
  is_default,
  version,
  created_at,
  updated_at
) on public.company_bank_accounts to authenticated;

grant select (
  company_id,
  representative_name,
  representative_role,
  representative_document_last4,
  tax_rate,
  address_street,
  address_number,
  address_complement,
  address_neighborhood,
  address_city,
  address_state,
  address_postal_code,
  consolidated_address,
  letterhead_file_id,
  signature_file_id,
  version,
  updated_at
) on public.company_settings to authenticated;

grant select on public.company_settings_drafts to authenticated;

create policy file_objects_tenant_select
on public.file_objects
for select
to authenticated
using (
  status = 'ready'::public.file_status
  and scan_status = 'clean'::public.file_scan_status
  and private.is_active_company_member(company_id)
  and purpose in (
    'profile_avatar'::public.file_purpose,
    'company_letterhead'::public.file_purpose,
    'company_signature'::public.file_purpose
  )
);

create policy upload_intents_own_select
on public.file_upload_intents
for select
to authenticated
using (
  actor_user_id = (select auth.uid())
  and private.is_active_company_member(company_id)
);

create policy company_bank_accounts_tenant_select
on public.company_bank_accounts
for select
to authenticated
using (
  status = 'active'::public.bank_account_status
  and private.is_active_company_member(company_id)
  and (
    private.has_company_role(
      company_id,
      'company_admin'::public.membership_role
    )
    or private.has_module(company_id, 'financial'::public.module_key)
  )
);

create policy company_settings_tenant_select
on public.company_settings
for select
to authenticated
using (private.is_active_company_member(company_id));

create policy company_settings_drafts_own_select
on public.company_settings_drafts
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.has_company_role(
    company_id,
    'company_admin'::public.membership_role
  )
);

create view public.company_bank_account_summaries
with (security_invoker = true)
as
select
  bank.id,
  bank.company_id,
  bank.bank_code,
  bank.bank_name,
  pg_catalog.repeat(
    '•',
    greatest(0, 4 - pg_catalog.char_length(bank.branch_last4))
  ) || bank.branch_last4 as masked_branch,
  pg_catalog.repeat(
    '•',
    greatest(0, 4 - pg_catalog.char_length(bank.account_last4))
  ) || bank.account_last4 as masked_account,
  bank.account_type,
  bank.holder_name,
  case
    when bank.holder_document_last4 is null then null
    else '••••' || bank.holder_document_last4
  end as masked_holder_document,
  bank.status,
  bank.is_default,
  bank.version,
  bank.created_at,
  bank.updated_at
from public.company_bank_accounts bank
where bank.status = 'active'::public.bank_account_status;

revoke all on public.company_bank_account_summaries
from public, anon, authenticated, service_role, axsys_bff;
grant select on public.company_bank_account_summaries to authenticated;

create view public.company_settings_safe
with (security_invoker = true)
as
select
  settings.company_id,
  settings.representative_name,
  settings.representative_role,
  case
    when settings.representative_document_last4 is null then null
    else '••••' || settings.representative_document_last4
  end as masked_representative_document,
  settings.tax_rate,
  settings.address_street,
  settings.address_number,
  settings.address_complement,
  settings.address_neighborhood,
  settings.address_city,
  settings.address_state,
  settings.address_postal_code,
  settings.consolidated_address,
  settings.letterhead_file_id,
  settings.signature_file_id,
  settings.version,
  settings.updated_at
from public.company_settings settings;

revoke all on public.company_settings_safe
from public, anon, authenticated, service_role, axsys_bff;
grant select on public.company_settings_safe to authenticated;

create function private.reserve_upload_capability_core(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_purpose public.file_purpose,
  p_target_resource_id uuid,
  p_declared_name text,
  p_declared_mime text,
  p_declared_size bigint
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_usage private.company_storage_usage%rowtype;
  v_capability_count bigint;
  v_capability_bytes bigint;
  v_max_size bigint;
  v_hold_bytes bigint;
  v_intent_id uuid;
  v_random_id uuid;
  v_quarantine_path text;
begin
  if p_company_id is null
     or p_actor_user_id is null
     or p_purpose is null
     or p_declared_name is null
     or p_declared_mime is null
     or p_declared_size is null
     or pg_catalog.char_length(p_declared_name) not between 1 and 255
     or p_declared_name <> pg_catalog.btrim(p_declared_name)
     or pg_catalog.strpos(p_declared_name, '/') > 0
     or pg_catalog.strpos(p_declared_name, pg_catalog.chr(92)) > 0
     or pg_catalog.strpos(p_declared_name, pg_catalog.chr(10)) > 0
     or pg_catalog.strpos(p_declared_name, pg_catalog.chr(13)) > 0
     or pg_catalog.char_length(p_declared_mime) not between 3 and 160
     or p_declared_mime <> pg_catalog.lower(pg_catalog.btrim(p_declared_mime))
     or p_declared_mime not in (
       'image/png',
       'image/jpeg',
       'image/webp',
       'application/pdf',
       'application/xml',
       'text/xml',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     ) then
    raise exception using
      errcode = '22023',
      message = 'upload_capability_input_invalid';
  end if;

  v_max_size := case p_purpose
    when 'profile_avatar'::public.file_purpose then 5242880
    when 'company_letterhead'::public.file_purpose then 5242880
    when 'company_signature'::public.file_purpose then 5242880
    when 'certificate'::public.file_purpose then 10485760
    when 'payment_invoice'::public.file_purpose then 15728640
    when 'contract_attachment'::public.file_purpose then 20971520
    when 'generated_document'::public.file_purpose then 26214400
  end;
  if p_declared_size < 1 or p_declared_size > v_max_size then
    raise exception using
      errcode = '22023',
      message = 'upload_capability_size_invalid';
  end if;

  if not exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    join public.profiles profile on profile.user_id = membership.user_id
    where membership.company_id = p_company_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'::public.membership_status
      and company.status = 'active'::public.company_status
      and profile.is_active
      and not profile.must_change_password
  ) then
    raise exception using
      errcode = '42501',
      message = 'upload_capability_actor_forbidden';
  end if;

  select usage.*
  into v_usage
  from private.company_storage_usage usage
  where usage.company_id = p_company_id
  for update;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'company_storage_usage_missing';
  end if;

  v_hold_bytes := p_declared_size * 2;
  select pg_catalog.count(*)::bigint,
         coalesce(pg_catalog.sum(intent.quota_hold_bytes), 0)::bigint
  into v_capability_count, v_capability_bytes
  from public.file_upload_intents intent
  where intent.company_id = p_company_id
    and intent.actor_user_id = p_actor_user_id
    and intent.authorization_retired_at is null;

  if v_capability_bytes + v_hold_bytes > 104857600 then
    raise exception using
      errcode = '54000',
      message = 'upload_capability_bytes_exceeded';
  end if;
  if v_capability_count >= 3 then
    raise exception using
      errcode = '54000',
      message = 'upload_capability_count_exceeded';
  end if;

  if v_usage.used_bytes + v_usage.reserved_bytes + v_hold_bytes
     > v_usage.quota_bytes then
    raise exception using
      errcode = '53100',
      message = 'company_storage_quota_exceeded';
  end if;

  v_intent_id := pg_catalog.gen_random_uuid();
  v_random_id := pg_catalog.gen_random_uuid();
  v_quarantine_path := pg_catalog.concat_ws(
    '/',
    p_company_id::text,
    p_actor_user_id::text,
    v_intent_id::text,
    v_random_id::text
  );

  update private.company_storage_usage usage
  set reserved_bytes = usage.reserved_bytes + v_hold_bytes,
      version = usage.version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where usage.company_id = p_company_id;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'company_storage_quota_update_lost';
  end if;

  insert into public.file_upload_intents (
    id,
    company_id,
    actor_user_id,
    purpose,
    target_resource_id,
    quarantine_object_path,
    declared_name,
    declared_mime,
    declared_size,
    status,
    quota_hold_bytes
  ) values (
    v_intent_id,
    p_company_id,
    p_actor_user_id,
    p_purpose,
    p_target_resource_id,
    v_quarantine_path,
    p_declared_name,
    p_declared_mime,
    p_declared_size,
    'reserved'::public.upload_intent_status,
    v_hold_bytes
  );

  return pg_catalog.jsonb_build_object(
    'intentId', v_intent_id,
    'quarantinePath', v_quarantine_path,
    'declaredSize', p_declared_size
  );
end;
$$;

revoke execute on function private.reserve_upload_capability_core(
  uuid,
  uuid,
  public.file_purpose,
  uuid,
  text,
  text,
  bigint
)
from public, anon, authenticated, service_role, axsys_bff;

create function private.list_company_user_directory(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_cursor uuid,
  p_limit integer,
  p_query text
) returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  modules text[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
rows 100
as $$
declare
  v_company_id uuid;
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_query text;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_limit is null
     or p_limit not between 1 and 100
     or (p_query is not null and pg_catalog.char_length(p_query) > 100) then
    raise exception using
      errcode = '22023',
      message = 'company_directory_input_invalid';
  end if;

  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using
      errcode = '23514',
      message = 'company_directory_session_invalid';
  end if;

  select membership.company_id
  into v_company_id
  from public.company_memberships membership
  join public.companies company on company.id = membership.company_id
  join public.profiles profile on profile.user_id = membership.user_id
  join private.auth_session_controls control
    on control.session_id = p_session_id
   and control.user_id = membership.user_id
  where membership.user_id = p_actor_user_id
    and membership.role = 'company_admin'::public.membership_role
    and membership.status = 'active'::public.membership_status
    and company.status = 'active'::public.company_status
    and profile.is_active
    and not profile.must_change_password
    and control.state = 'active'::private.auth_session_state
    and control.audit_scope = 'tenant'::public.audit_scope
    and control.audit_company_id = membership.company_id
    and control.revoked_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'company_directory_forbidden';
  end if;

  v_query := nullif(pg_catalog.lower(pg_catalog.btrim(p_query)), '');

  if p_cursor is not null then
    select membership.created_at, membership.id
    into v_cursor_created_at, v_cursor_id
    from public.company_memberships membership
    where membership.company_id = v_company_id
      and membership.user_id = p_cursor;
    if not found then
      raise exception using
        errcode = '22023',
        message = 'company_directory_cursor_invalid';
    end if;
  end if;

  return query
  select membership.user_id,
         profile.display_name,
         profile.email::text,
         membership.role::text,
         membership.status::text,
         coalesce(
           (
             select pg_catalog.array_agg(module_row.module::text order by module_row.module::text)
             from public.member_modules module_row
             where module_row.company_id = membership.company_id
               and module_row.membership_id = membership.id
           ),
           '{}'::text[]
         ) as modules,
         membership.created_at
  from public.company_memberships membership
  join public.profiles profile on profile.user_id = membership.user_id
  where membership.company_id = v_company_id
    and (
      p_cursor is null
      or (membership.created_at, membership.id)
         < (v_cursor_created_at, v_cursor_id)
    )
    and (
      v_query is null
      or pg_catalog.strpos(pg_catalog.lower(profile.display_name), v_query) > 0
      or pg_catalog.strpos(pg_catalog.lower(profile.email::text), v_query) > 0
    )
  order by membership.created_at desc, membership.id desc
  limit p_limit;
end;
$$;

revoke execute on function private.list_company_user_directory(
  uuid,
  uuid,
  uuid,
  integer,
  text
)
from public, anon, authenticated, service_role, axsys_bff;
grant execute on function private.list_company_user_directory(
  uuid,
  uuid,
  uuid,
  integer,
  text
)
to axsys_bff;

create or replace function private.guard_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id
     or new.user_id is distinct from old.user_id then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger guard_membership_identity_before_update
before update of company_id, user_id
on public.company_memberships
for each row execute function private.guard_membership_identity();

create or replace function private.protect_last_company_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'membership_delete_forbidden';
  end if;

  if old.role = 'company_admin'::public.membership_role
     and old.status = 'active'::public.membership_status
     and (
       new.role is distinct from 'company_admin'::public.membership_role
       or new.status is distinct from 'active'::public.membership_status
     ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(old.company_id::text, 2102)
    );
    if not exists (
      select 1
      from public.company_memberships other
      where other.company_id = old.company_id
        and other.id <> old.id
        and other.role = 'company_admin'::public.membership_role
        and other.status = 'active'::public.membership_status
    ) then
      raise exception using
        errcode = '23514',
        message = 'last_active_company_admin';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_membership_identity()
from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.protect_last_company_admin()
from public, anon, authenticated, service_role, axsys_bff;

create or replace function private.guard_company_branding_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.letterhead_file_id is not null and not exists (
    select 1
    from public.file_objects file_object
    where file_object.company_id = new.company_id
      and file_object.id = new.letterhead_file_id
      and file_object.purpose = 'company_letterhead'::public.file_purpose
      and file_object.status = 'ready'::public.file_status
      and file_object.scan_status = 'clean'::public.file_scan_status
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_INVALID_LETTERHEAD_FILE';
  end if;

  if new.signature_file_id is not null and not exists (
    select 1
    from public.file_objects file_object
    where file_object.company_id = new.company_id
      and file_object.id = new.signature_file_id
      and file_object.purpose = 'company_signature'::public.file_purpose
      and file_object.status = 'ready'::public.file_status
      and file_object.scan_status = 'clean'::public.file_scan_status
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_INVALID_SIGNATURE_FILE';
  end if;
  return new;
end;
$$;

create trigger guard_company_branding_files_before_write
before insert or update of letterhead_file_id, signature_file_id
on public.company_settings
for each row execute function private.guard_company_branding_files();

revoke execute on function private.guard_company_branding_files()
from public, anon, authenticated, service_role, axsys_bff;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc function
    join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = function.proowner
    where namespace.nspname = 'private'
      and function.proname in (
        'reserve_upload_capability_core',
        'reserve_image_upload_intent',
        'activate_file_upload_authorization',
        'cancel_unissued_file_reservation',
        'list_company_user_directory',
        'guard_membership_identity',
        'protect_last_company_admin',
        'guard_company_branding_files'
      )
      and (
        owner.rolname <> 'postgres'
        or not ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PLATFORM_USERS_SETTINGS_RLS_ROUTINE_CATALOG_INVALID';
  end if;

  if has_function_privilege(
    'axsys_bff',
    'private.reserve_upload_capability_core(uuid,uuid,public.file_purpose,uuid,text,text,bigint)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_UPLOAD_CAPABILITY_CORE_EXPOSED';
  end if;
end
$$;
