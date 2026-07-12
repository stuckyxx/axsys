do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_FILE_FINALIZATION_MIGRATION_OWNER_INVALID';
  end if;
end
$$;

insert into private.rate_limit_policies (
  bucket,
  attempt_limit,
  window_seconds,
  block_seconds,
  clear_on_success
) values ('file-mutation-user', 20, 60, 60, false);

create function private.lock_authorized_file_upload_intent(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid
) returns public.file_upload_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_role public.membership_role;
begin
  if p_actor_user_id is null or p_session_id is null or p_intent_id is null then
    raise exception using errcode = '22023', message = 'file_upload_input_invalid';
  end if;

  if not private.assert_auth_session(p_session_id, p_actor_user_id) then
    raise exception using errcode = '23514', message = 'file_upload_session_invalid';
  end if;

  select intent.*
  into v_intent
  from public.file_upload_intents intent
  where intent.id = p_intent_id
    and intent.actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'file_upload_not_found';
  end if;

  select membership.role
  into v_role
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
    and control.revoked_at is null;
  if not found
     or v_intent.purpose not in (
       'profile_avatar'::public.file_purpose,
       'company_letterhead'::public.file_purpose,
       'company_signature'::public.file_purpose
     )
     or (
       v_intent.purpose = 'profile_avatar'::public.file_purpose
       and v_intent.target_resource_id is distinct from p_actor_user_id
     )
     or (
       v_intent.purpose in (
         'company_letterhead'::public.file_purpose,
         'company_signature'::public.file_purpose
       )
       and (
         v_intent.target_resource_id is distinct from v_intent.company_id
         or v_role is distinct from 'company_admin'::public.membership_role
       )
     ) then
    raise exception using errcode = '42501', message = 'file_upload_not_found';
  end if;

  return v_intent;
end;
$$;

create function private.file_object_server_json(
  p_file public.file_objects
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_file.id,
    'companyId', p_file.company_id,
    'ownerUserId', p_file.owner_user_id,
    'purpose', p_file.purpose,
    'bucket', p_file.bucket,
    'objectPath', p_file.object_path,
    'originalName', p_file.original_name,
    'detectedMime', p_file.detected_mime,
    'byteSize', p_file.byte_size,
    'sha256', p_file.sha256,
    'scanStatus', p_file.scan_status,
    'status', p_file.status,
    'createdBy', p_file.created_by,
    'createdAt', p_file.created_at,
    'promotedAt', p_file.promoted_at
  )
$$;

create function private.internal_begin_file_finalization(
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
  v_file public.file_objects%rowtype;
  v_now timestamptz;
begin
  v_intent := private.lock_authorized_file_upload_intent(
    p_actor_user_id,
    p_session_id,
    p_intent_id
  );
  v_now := pg_catalog.clock_timestamp();

  if v_intent.status = 'ready'::public.upload_intent_status
     and v_intent.file_object_id is not null then
    select file_object.*
    into v_file
    from public.file_objects file_object
    where file_object.company_id = v_intent.company_id
      and file_object.id = v_intent.file_object_id
      and file_object.purpose = v_intent.purpose
      and file_object.status = 'ready'::public.file_status
      and file_object.scan_status = 'clean'::public.file_scan_status;
    if not found then
      raise exception using errcode = '23514', message = 'file_upload_ready_state_invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'kind', 'ready',
      'file', private.file_object_server_json(v_file)
    );
  end if;

  if v_intent.status = 'finalizing'::public.upload_intent_status then
    raise exception using errcode = '40001', message = 'file_finalization_in_progress';
  end if;
  if v_intent.status is distinct from 'issued'::public.upload_intent_status
     or v_intent.file_object_id is not null
     or v_intent.authorization_issued_at is null
     or v_intent.upload_authorization_expires_at is null
     or v_intent.cleanup_not_before is null
     or v_intent.cleanup_not_before <= v_now
     or v_intent.authorization_retired_at is not null
     or v_intent.authorization_cleanup_claim_id is not null
     or v_intent.authorization_cleanup_claimed_at is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using errcode = '23514', message = 'file_upload_not_finalizable';
  end if;

  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update public.file_upload_intents intent
  set status = 'finalizing'::public.upload_intent_status,
      cleanup_error_code = null,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.status = 'issued'::public.upload_intent_status;
  if not found then
    raise exception using errcode = '40001', message = 'file_finalization_begin_lost';
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', 'finalizing',
    'intent', pg_catalog.jsonb_build_object(
      'id', v_intent.id,
      'companyId', v_intent.company_id,
      'actorUserId', v_intent.actor_user_id,
      'purpose', v_intent.purpose,
      'quarantinePath', v_intent.quarantine_object_path,
      'declaredName', v_intent.declared_name,
      'declaredMime', v_intent.declared_mime,
      'declaredSize', v_intent.declared_size,
      'cleanupNotBefore', v_intent.cleanup_not_before
    )
  );
end;
$$;

create function private.internal_finalize_file_upload(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid,
  p_file_id uuid,
  p_object_path text,
  p_detected_mime text,
  p_final_extension text,
  p_byte_size bigint,
  p_sha256 text,
  p_correlation_id uuid
) returns public.file_objects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
  v_usage private.company_storage_usage%rowtype;
  v_file public.file_objects%rowtype;
  v_expected_path text;
  v_now timestamptz;
begin
  if p_file_id is null
     or p_correlation_id is null
     or p_object_path is null
     or p_detected_mime is distinct from 'image/webp'
     or p_final_extension is distinct from 'webp'
     or p_byte_size is null
     or p_byte_size not between 1 and 5242880
     or p_sha256 is null
     or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'file_finalize_input_invalid';
  end if;

  v_intent := private.lock_authorized_file_upload_intent(
    p_actor_user_id,
    p_session_id,
    p_intent_id
  );
  v_expected_path := v_intent.company_id::text || '/' || v_intent.purpose::text
    || '/' || p_file_id::text || '.webp';
  v_now := pg_catalog.clock_timestamp();

  if v_intent.status is distinct from 'finalizing'::public.upload_intent_status
     or v_intent.file_object_id is not null
     or v_intent.cleanup_not_before is null
     or v_intent.cleanup_not_before <= v_now
     or v_intent.authorization_retired_at is not null
     or v_intent.authorization_cleanup_claim_id is not null
     or v_intent.authorization_cleanup_claimed_at is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2
     or p_object_path is distinct from v_expected_path then
    raise exception using errcode = '23514', message = 'file_finalize_state_invalid';
  end if;

  select usage.*
  into v_usage
  from private.company_storage_usage usage
  where usage.company_id = v_intent.company_id
  for update;
  if not found
     or v_usage.reserved_bytes < v_intent.declared_size
     or v_usage.used_bytes + p_byte_size
        + v_usage.reserved_bytes - v_intent.declared_size > v_usage.quota_bytes then
    raise exception using errcode = '23514', message = 'file_finalize_quota_invalid';
  end if;

  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  insert into public.file_objects (
    id,
    company_id,
    owner_user_id,
    purpose,
    bucket,
    object_path,
    original_name,
    detected_mime,
    byte_size,
    sha256,
    scan_status,
    status,
    created_by,
    created_at,
    promoted_at
  ) values (
    p_file_id,
    v_intent.company_id,
    case
      when v_intent.purpose = 'profile_avatar'::public.file_purpose
        then v_intent.actor_user_id
      else null
    end,
    v_intent.purpose,
    'axsys-private',
    p_object_path,
    v_intent.declared_name,
    p_detected_mime,
    p_byte_size,
    p_sha256,
    'clean'::public.file_scan_status,
    'ready'::public.file_status,
    p_actor_user_id,
    v_now,
    v_now
  )
  returning * into v_file;

  update private.company_storage_usage usage
  set used_bytes = usage.used_bytes + p_byte_size,
      reserved_bytes = usage.reserved_bytes - v_intent.declared_size,
      version = usage.version + 1,
      updated_at = v_now
  where usage.company_id = v_intent.company_id;

  update public.file_upload_intents intent
  set status = 'ready'::public.upload_intent_status,
      quota_hold_bytes = v_intent.declared_size,
      file_object_id = p_file_id,
      cleanup_error_code = null,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.status = 'finalizing'::public.upload_intent_status;
  if not found then
    raise exception using errcode = '40001', message = 'file_finalize_commit_lost';
  end if;

  insert into public.audit_events (
    scope,
    company_id,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    outcome,
    reason_code,
    correlation_id,
    metadata,
    occurred_at
  ) values (
    'tenant'::public.audit_scope,
    v_intent.company_id,
    p_actor_user_id,
    'file.upload_finalized',
    'file',
    p_file_id,
    'success'::public.audit_outcome,
    null,
    p_correlation_id,
    pg_catalog.jsonb_build_object('purpose', v_intent.purpose),
    v_now
  );

  return v_file;
end;
$$;

create function private.internal_reject_file_upload(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid,
  p_reason_code text
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
  if p_reason_code is null or p_reason_code not in (
    'FILE_EXTENSION_MISMATCH',
    'FILE_MAGIC_BYTES_INVALID',
    'FILE_SIZE_MISMATCH',
    'FILE_TYPE_MISMATCH',
    'MALWARE_DETECTED',
    'TRANSFORMED_FILE_INVALID'
  ) then
    raise exception using errcode = '22023', message = 'file_reject_reason_invalid';
  end if;
  v_intent := private.lock_authorized_file_upload_intent(
    p_actor_user_id,
    p_session_id,
    p_intent_id
  );
  if v_intent.status = 'rejected'::public.upload_intent_status
     and v_intent.cleanup_error_code is not distinct from p_reason_code
     and v_intent.quota_hold_bytes = v_intent.declared_size then
    return;
  end if;
  if v_intent.status is distinct from 'finalizing'::public.upload_intent_status
     or v_intent.file_object_id is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using errcode = '23514', message = 'file_reject_state_invalid';
  end if;

  select usage.*
  into v_usage
  from private.company_storage_usage usage
  where usage.company_id = v_intent.company_id
  for update;
  if not found or v_usage.reserved_bytes < v_intent.declared_size then
    raise exception using errcode = '23514', message = 'file_reject_quota_invalid';
  end if;
  v_now := pg_catalog.clock_timestamp();
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update private.company_storage_usage usage
  set reserved_bytes = usage.reserved_bytes - v_intent.declared_size,
      version = usage.version + 1,
      updated_at = v_now
  where usage.company_id = v_intent.company_id;
  update public.file_upload_intents intent
  set status = 'rejected'::public.upload_intent_status,
      quota_hold_bytes = v_intent.declared_size,
      cleanup_error_code = p_reason_code,
      version = intent.version + 1,
      updated_at = v_now
  where intent.id = v_intent.id
    and intent.status = 'finalizing'::public.upload_intent_status;
  if not found then
    raise exception using errcode = '40001', message = 'file_reject_commit_lost';
  end if;
  insert into public.audit_events (
    scope, company_id, actor_user_id, action, resource_type, resource_id,
    outcome, reason_code, correlation_id, metadata, occurred_at
  ) values (
    'tenant'::public.audit_scope,
    v_intent.company_id,
    p_actor_user_id,
    'file.upload_rejected',
    'file',
    null,
    'failure'::public.audit_outcome,
    p_reason_code,
    v_intent.id,
    pg_catalog.jsonb_build_object('purpose', v_intent.purpose),
    v_now
  );
end;
$$;

create function private.internal_release_file_finalization_for_retry(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid,
  p_reason_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
begin
  if p_reason_code is null or p_reason_code not in (
    'FILE_FINALIZATION_UNAVAILABLE',
    'FILE_QUARANTINE_DOWNLOAD_FAILED',
    'FILE_SCANNER_UNAVAILABLE',
    'FILE_TRANSFORM_UNAVAILABLE'
  ) then
    raise exception using errcode = '22023', message = 'file_retry_reason_invalid';
  end if;
  v_intent := private.lock_authorized_file_upload_intent(
    p_actor_user_id,
    p_session_id,
    p_intent_id
  );
  if v_intent.status is distinct from 'finalizing'::public.upload_intent_status
     or v_intent.file_object_id is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using errcode = '23514', message = 'file_retry_state_invalid';
  end if;
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update public.file_upload_intents intent
  set status = 'issued'::public.upload_intent_status,
      cleanup_error_code = p_reason_code,
      version = intent.version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where intent.id = v_intent.id
    and intent.status = 'finalizing'::public.upload_intent_status;
  if not found then
    raise exception using errcode = '40001', message = 'file_retry_release_lost';
  end if;
end;
$$;

create function private.internal_mark_file_cleanup_required(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_intent_id uuid,
  p_reason_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.file_upload_intents%rowtype;
begin
  if p_reason_code is null or p_reason_code not in (
    'FILE_METADATA_COMMIT_FAILED',
    'FILE_PRIVATE_UPLOAD_AMBIGUOUS'
  ) then
    raise exception using errcode = '22023', message = 'file_cleanup_reason_invalid';
  end if;
  v_intent := private.lock_authorized_file_upload_intent(
    p_actor_user_id,
    p_session_id,
    p_intent_id
  );
  if v_intent.status = 'cleanup_required'::public.upload_intent_status
     and v_intent.cleanup_error_code is not distinct from p_reason_code then
    return;
  end if;
  if v_intent.status is distinct from 'finalizing'::public.upload_intent_status
     or v_intent.file_object_id is not null
     or v_intent.quota_hold_bytes <> v_intent.declared_size * 2 then
    raise exception using errcode = '23514', message = 'file_cleanup_state_invalid';
  end if;
  perform pg_catalog.set_config('app.actor_id', p_actor_user_id::text, true);
  update public.file_upload_intents intent
  set status = 'cleanup_required'::public.upload_intent_status,
      cleanup_error_code = p_reason_code,
      version = intent.version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where intent.id = v_intent.id
    and intent.status = 'finalizing'::public.upload_intent_status;
  if not found then
    raise exception using errcode = '40001', message = 'file_cleanup_mark_lost';
  end if;
end;
$$;

revoke execute on function private.lock_authorized_file_upload_intent(uuid,uuid,uuid),
  private.file_object_server_json(public.file_objects),
  private.internal_begin_file_finalization(uuid,uuid,uuid),
  private.internal_finalize_file_upload(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid),
  private.internal_reject_file_upload(uuid,uuid,uuid,text),
  private.internal_release_file_finalization_for_retry(uuid,uuid,uuid,text),
  private.internal_mark_file_cleanup_required(uuid,uuid,uuid,text)
from public, anon, authenticated, service_role, axsys_bff;

grant execute on function private.internal_begin_file_finalization(uuid,uuid,uuid),
  private.internal_finalize_file_upload(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid),
  private.internal_reject_file_upload(uuid,uuid,uuid,text),
  private.internal_release_file_finalization_for_retry(uuid,uuid,uuid,text),
  private.internal_mark_file_cleanup_required(uuid,uuid,uuid,text)
to axsys_bff;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc function
    join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = function.proowner
    where namespace.nspname = 'private'
      and function.proname in (
        'lock_authorized_file_upload_intent',
        'file_object_server_json',
        'internal_begin_file_finalization',
        'internal_finalize_file_upload',
        'internal_reject_file_upload',
        'internal_release_file_finalization_for_retry',
        'internal_mark_file_cleanup_required'
      )
      and (
        owner.rolname <> 'postgres'
        or not ('search_path=""' = any(coalesce(function.proconfig, '{}'::text[])))
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_FILE_FINALIZATION_ROUTINE_CATALOG_INVALID';
  end if;

  if has_function_privilege(
    'axsys_bff',
    'private.lock_authorized_file_upload_intent(uuid,uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'axsys_bff',
    'private.file_object_server_json(public.file_objects)',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_FILE_FINALIZATION_HELPER_EXPOSED';
  end if;
end
$$;
