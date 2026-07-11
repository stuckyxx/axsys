begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_LOGIN_CLASSIFICATION_MIGRATION_OWNER_INVALID';
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
end
$$;

create or replace function private.fail_closed_login_session(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_reason_code text,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_session_id is null or p_correlation_id is null
     or p_reason_code is null
     or p_reason_code not in (
       'AUTH_CONTEXT_RESOLUTION_FAILED',
       'AUTH_AUDIT_ACTIVATION_FAILED',
       'TEMPORARY_PASSWORD_EXPIRED'
     ) then
    raise exception using errcode = '22023', message = 'auth_fail_closed_input_invalid';
  end if;

  perform pg_advisory_xact_lock(1672, 0);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 1673));
  v_now := clock_timestamp();

  if p_reason_code = 'TEMPORARY_PASSWORD_EXPIRED'
     and not exists (
       select 1
       from public.profiles profile
       where profile.user_id = p_actor_user_id
         and profile.is_active
         and profile.must_change_password
         and (
           profile.temporary_password_expires_at is null
           or profile.temporary_password_expires_at <= v_now
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'auth_temporary_password_expiry_unverified';
  end if;

  update private.auth_session_controls control
  set state = 'revoked', revoked_at = v_now, updated_at = v_now
  where control.session_id = p_session_id
    and control.user_id = p_actor_user_id
    and control.state in ('pending', 'active')
    and exists (
      select 1 from auth.sessions auth_session
      where auth_session.id = control.session_id
        and auth_session.user_id = control.user_id
        and auth_session.created_at = control.auth_created_at
    );
  if not found then
    raise exception using errcode = '23514', message = 'auth_fail_closed_session_invalid';
  end if;
end;
$$;

commit;
