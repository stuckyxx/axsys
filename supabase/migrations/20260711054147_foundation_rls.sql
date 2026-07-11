begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_RLS_MIGRATION_OWNER_INVALID';
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

create function private.has_registered_app_session() returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_session_claim text;
begin
  begin
    v_user_id := (select auth.uid());
  exception
    when invalid_text_representation then
      return false;
  end;

  v_session_claim := nullif((select auth.jwt() ->> 'session_id'), '');
  if v_user_id is null or v_session_claim is null then
    return false;
  end if;

  begin
    v_session_id := v_session_claim::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return exists (
    select 1
    from private.auth_session_controls control
    join auth.sessions auth_session
      on auth_session.id = control.session_id
     and auth_session.user_id = control.user_id
     and auth_session.created_at = control.auth_created_at
    join public.profiles profile
      on profile.user_id = control.user_id
    where control.session_id = v_session_id
      and control.user_id = v_user_id
      and control.state = 'active'::private.auth_session_state
      and control.activated_at is not null
      and control.revoked_at is null
      and control.absolute_expires_at > pg_catalog.statement_timestamp()
      and (
        auth_session.not_after is null
        or auth_session.not_after > pg_catalog.statement_timestamp()
      )
      and not exists (
        select 1
        from private.auth_user_session_cutoffs cutoff
        where cutoff.user_id = control.user_id
          and control.auth_created_at <= cutoff.revoked_before
      )
      and profile.is_active
  );
end;
$$;

create function private.has_active_app_session() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_registered_app_session()
    and exists (
      select 1
      from public.profiles profile
      where profile.user_id = (select auth.uid())
        and profile.is_active
        and not profile.must_change_password
    );
$$;

create function private.has_platform_role() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_app_session()
    and exists (
      select 1
      from public.platform_roles platform_role
      join public.profiles profile
        on profile.user_id = platform_role.user_id
      where platform_role.user_id = (select auth.uid())
        and platform_role.role = 'super_admin'::public.platform_role
        and platform_role.is_active
        and profile.is_active
        and not profile.must_change_password
    );
$$;

create function private.is_active_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_app_session()
    and exists (
      select 1
      from public.company_memberships membership
      join public.companies company
        on company.id = membership.company_id
      join public.profiles profile
        on profile.user_id = membership.user_id
      where membership.user_id = (select auth.uid())
        and membership.company_id = p_company_id
        and membership.status = 'active'::public.membership_status
        and company.status = 'active'::public.company_status
        and profile.is_active
        and not profile.must_change_password
    );
$$;

create function private.has_company_role(
  p_company_id uuid,
  p_role public.membership_role
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_company_member(p_company_id)
    and exists (
      select 1
      from public.company_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.company_id = p_company_id
        and membership.role = p_role
        and membership.status = 'active'::public.membership_status
    );
$$;

create function private.has_module(
  p_company_id uuid,
  p_module public.module_key
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_company_member(p_company_id)
    and exists (
      select 1
      from public.company_memberships membership
      join public.member_modules member_module
        on member_module.company_id = membership.company_id
       and member_module.membership_id = membership.id
      where membership.user_id = (select auth.uid())
        and membership.company_id = p_company_id
        and membership.status = 'active'::public.membership_status
        and member_module.module = p_module
    );
$$;

revoke execute on function private.has_registered_app_session()
  from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.has_active_app_session()
  from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.has_platform_role()
  from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.is_active_company_member(uuid)
  from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.has_company_role(uuid, public.membership_role)
  from public, anon, authenticated, service_role, axsys_bff;
revoke execute on function private.has_module(uuid, public.module_key)
  from public, anon, authenticated, service_role, axsys_bff;

grant usage on schema private to authenticated;
grant execute on function private.has_registered_app_session()
  to authenticated;
grant execute on function private.has_active_app_session()
  to authenticated;
grant execute on function private.has_platform_role()
  to authenticated;
grant execute on function private.is_active_company_member(uuid)
  to authenticated;
grant execute on function private.has_company_role(uuid, public.membership_role)
  to authenticated;
grant execute on function private.has_module(uuid, public.module_key)
  to authenticated;

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.has_registered_app_session())
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.has_active_app_session())
)
with check (
  user_id = (select auth.uid())
  and (select private.has_active_app_session())
);

create policy platform_roles_select_self
on public.platform_roles
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.has_active_app_session())
);

create policy companies_select_authorized
on public.companies
for select
to authenticated
using (
  (select private.has_platform_role())
  or (select private.is_active_company_member(id))
);

create policy memberships_select_company_admin_or_self
on public.company_memberships
for select
to authenticated
using (
  (
    user_id = (select auth.uid())
    and (select private.is_active_company_member(company_id))
  )
  or (select private.has_company_role(
    company_id,
    'company_admin'::public.membership_role
  ))
);

create policy member_modules_select_company_admin_or_self
on public.member_modules
for select
to authenticated
using (
  (
    (select private.is_active_company_member(company_id))
    and exists (
      select 1
      from public.company_memberships own_membership
      where own_membership.id = member_modules.membership_id
        and own_membership.company_id = member_modules.company_id
        and own_membership.user_id = (select auth.uid())
        and own_membership.status = 'active'::public.membership_status
    )
  )
  or (select private.has_company_role(
    company_id,
    'company_admin'::public.membership_role
  ))
);

revoke all privileges on public.profiles,
  public.platform_roles,
  public.companies,
  public.company_memberships,
  public.member_modules
  from public, anon, authenticated, service_role, axsys_bff;

grant select on public.profiles,
  public.platform_roles,
  public.companies,
  public.company_memberships,
  public.member_modules
  to authenticated;
grant update (preferred_theme) on public.profiles to authenticated;

commit;
