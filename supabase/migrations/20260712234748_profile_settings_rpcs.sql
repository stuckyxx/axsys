do $$
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='AXSYS_PROFILE_RPCS_OWNER_INVALID';
  end if;
  if to_regclass('public.profiles') is null
     or to_regclass('public.file_objects') is null
     or to_regprocedure('private.assert_auth_session(uuid,uuid)') is null then
    raise exception using errcode='55000',message='AXSYS_PROFILE_RPCS_DEPENDENCY_INVALID';
  end if;
end
$$;

create function private.assert_own_profile_actor(
  p_actor_user_id uuid,p_session_id uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_actor_user_id is null or p_session_id is null then
    raise exception using errcode='22023',message='AXSYS_PROFILE_INPUT_INVALID';
  end if;
  if not private.assert_auth_session(p_session_id,p_actor_user_id) then
    raise exception using errcode='23514',message='AXSYS_PROFILE_SESSION_INVALID';
  end if;
  if not exists (
    select 1 from public.profiles profile
    join private.auth_session_controls control
      on control.user_id=profile.user_id and control.session_id=p_session_id
    where profile.user_id=p_actor_user_id and profile.is_active
      and not profile.must_change_password
      and control.state='active'::private.auth_session_state
      and control.revoked_at is null
      and control.absolute_expires_at>pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode='23514',message='AXSYS_PROFILE_SESSION_INVALID';
  end if;
  perform pg_catalog.set_config('app.actor_id',p_actor_user_id::text,true);
end;
$$;

create function private.own_profile_snapshot(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'userId',profile.user_id,'email',profile.email::text,
    'displayName',profile.display_name,'preferredTheme',profile.preferred_theme,
    'avatarFileId',profile.avatar_file_id,'version',profile.version
  ) from public.profiles profile where profile.user_id=p_user_id
$$;

create function private.internal_get_own_profile(
  p_actor_user_id uuid,p_session_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.assert_own_profile_actor(p_actor_user_id,p_session_id);
  v_result:=private.own_profile_snapshot(p_actor_user_id);
  if v_result is null then
    raise exception using errcode='P0001',message='AXSYS_PROFILE_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

create function private.internal_update_own_profile(
  p_actor_user_id uuid,p_session_id uuid,p_display_name text,
  p_expected_version bigint,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_control private.auth_session_controls%rowtype;
begin
  perform private.assert_own_profile_actor(p_actor_user_id,p_session_id);
  if p_expected_version is null or p_correlation_id is null
     or p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 2 and 120 then
    raise exception using errcode='22023',message='AXSYS_PROFILE_INPUT_INVALID';
  end if;
  update public.profiles profile set display_name=pg_catalog.btrim(p_display_name)
  where profile.user_id=p_actor_user_id and profile.version=p_expected_version;
  if not found then
    raise exception using errcode='40001',message='AXSYS_PROFILE_VERSION_CONFLICT';
  end if;
  select * into v_control from private.auth_session_controls control
   where control.session_id=p_session_id and control.user_id=p_actor_user_id;
  insert into public.audit_events(
    scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
    correlation_id,metadata
  ) values (
    v_control.audit_scope,v_control.audit_company_id,p_actor_user_id,
    'profile.display_name_updated','profile',p_actor_user_id,'success',
    p_correlation_id,'{"displayNameChanged":true}'::jsonb
  );
  return private.own_profile_snapshot(p_actor_user_id);
end;
$$;

create function private.internal_attach_own_avatar(
  p_actor_user_id uuid,p_session_id uuid,p_file_id uuid,
  p_expected_version bigint,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;
  v_company_id uuid; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform private.assert_own_profile_actor(p_actor_user_id,p_session_id);
  if p_file_id is null or p_expected_version is null or p_correlation_id is null then
    raise exception using errcode='22023',message='AXSYS_PROFILE_INPUT_INVALID';
  end if;
  select membership.company_id into v_company_id
  from public.company_memberships membership join public.companies company
    on company.id=membership.company_id and company.status='active'
  where membership.user_id=p_actor_user_id and membership.status='active';
  if not found then
    raise exception using errcode='42501',message='AXSYS_PROFILE_AVATAR_FORBIDDEN';
  end if;
  select * into v_profile from public.profiles profile
   where profile.user_id=p_actor_user_id for update;
  if v_profile.version<>p_expected_version then
    raise exception using errcode='40001',message='AXSYS_PROFILE_VERSION_CONFLICT';
  end if;
  perform 1 from public.file_objects file_object
   where file_object.id=p_file_id and file_object.company_id=v_company_id
     and file_object.owner_user_id=p_actor_user_id
     and file_object.purpose='profile_avatar' and file_object.status='ready'
     and file_object.scan_status='clean' and file_object.storage_deleted_at is null
     and file_object.quota_released_at is null
     and file_object.retirement_claim_id is null
   for update;
  if not found then
    raise exception using errcode='P0001',message='AXSYS_PROFILE_AVATAR_INVALID';
  end if;
  if v_profile.avatar_file_id is not null and v_profile.avatar_file_id<>p_file_id then
    update public.file_objects file_object set status='archived',archived_at=v_now,
      retirement_not_before=v_now+interval '30 days'
    where file_object.id=v_profile.avatar_file_id
      and file_object.company_id=v_company_id and file_object.owner_user_id=p_actor_user_id
      and file_object.purpose='profile_avatar' and file_object.status='ready'
      and file_object.retirement_claim_id is null and file_object.storage_deleted_at is null;
    if not found then
      raise exception using errcode='P0001',message='AXSYS_PROFILE_PREVIOUS_AVATAR_INVALID';
    end if;
  end if;
  update public.profiles profile set avatar_file_id=p_file_id
   where profile.user_id=p_actor_user_id and profile.version=p_expected_version;
  if not found then
    raise exception using errcode='40001',message='AXSYS_PROFILE_VERSION_CONFLICT';
  end if;
  insert into public.audit_events(
    scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
    correlation_id,metadata
  ) values ('tenant',v_company_id,p_actor_user_id,'profile.avatar_updated','profile',
    p_actor_user_id,'success',p_correlation_id,'{"avatarChanged":true}'::jsonb);
  return private.own_profile_snapshot(p_actor_user_id);
end;
$$;

create function private.internal_sync_confirmed_profile_email(
  p_actor_user_id uuid,p_session_id uuid,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text; v_profile public.profiles%rowtype;
  v_control private.auth_session_controls%rowtype;
begin
  perform private.assert_own_profile_actor(p_actor_user_id,p_session_id);
  if p_correlation_id is null then
    raise exception using errcode='22023',message='AXSYS_PROFILE_INPUT_INVALID';
  end if;
  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)) into v_email
  from auth.users auth_user where auth_user.id=p_actor_user_id
    and auth_user.email is not null and auth_user.email_confirmed_at is not null;
  if not found or v_email='' then
    raise exception using errcode='23514',message='AXSYS_PROFILE_AUTH_EMAIL_UNCONFIRMED';
  end if;
  select * into v_profile from public.profiles profile
   where profile.user_id=p_actor_user_id for update;
  if v_profile.email::text<>v_email then
    update public.profiles profile set email=v_email
     where profile.user_id=p_actor_user_id;
    select * into v_control from private.auth_session_controls control
     where control.session_id=p_session_id and control.user_id=p_actor_user_id;
    insert into public.audit_events(
      scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
      correlation_id,metadata
    ) values (v_control.audit_scope,v_control.audit_company_id,p_actor_user_id,
      'profile.email_synced','profile',p_actor_user_id,'success',p_correlation_id,'{}');
  end if;
  return private.own_profile_snapshot(p_actor_user_id);
end;
$$;

revoke update(display_name,email,avatar_file_id) on public.profiles
from anon,authenticated,service_role,axsys_bff;
revoke execute on function private.assert_own_profile_actor(uuid,uuid),
  private.own_profile_snapshot(uuid),private.internal_get_own_profile(uuid,uuid),
  private.internal_update_own_profile(uuid,uuid,text,bigint,uuid),
  private.internal_attach_own_avatar(uuid,uuid,uuid,bigint,uuid),
  private.internal_sync_confirmed_profile_email(uuid,uuid,uuid)
from public,anon,authenticated,service_role,axsys_bff;
grant execute on function private.internal_get_own_profile(uuid,uuid),
  private.internal_update_own_profile(uuid,uuid,text,bigint,uuid),
  private.internal_attach_own_avatar(uuid,uuid,uuid,bigint,uuid),
  private.internal_sync_confirmed_profile_email(uuid,uuid,uuid)
to axsys_bff;
