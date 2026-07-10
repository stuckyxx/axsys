do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'axsys_bff') then
    create role axsys_bff
      login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 20;
  end if;
end
$$;

alter role axsys_bff
  login
  noinherit
  nocreatedb
  nocreaterole
  connection limit 20;

revoke all privileges on schema public from public;
grant usage on schema public to authenticator, anon, authenticated, service_role, supabase_admin;

revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;
revoke all privileges on all tables in schema public from anon, authenticated, service_role;
revoke all privileges on all sequences in schema public from anon, authenticated, service_role;
revoke all privileges on all functions in schema public from anon, authenticated, service_role;

set role postgres;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all privileges on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public;
alter default privileges for role postgres
  revoke all privileges on functions from public;
reset role;

revoke all privileges on database postgres from axsys_bff;
revoke all privileges on schema public from axsys_bff;
revoke all privileges on all tables in schema public from axsys_bff;
revoke all privileges on all sequences in schema public from axsys_bff;
revoke all privileges on all functions in schema public from axsys_bff;
grant connect on database postgres to axsys_bff;

do $$
declare
  role_state record;
begin
  select
    rolcanlogin,
    rolinherit,
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolreplication,
    rolbypassrls,
    rolconnlimit
  into strict role_state
  from pg_roles
  where rolname = 'axsys_bff';

  if not role_state.rolcanlogin
    or role_state.rolinherit
    or role_state.rolsuper
    or role_state.rolcreatedb
    or role_state.rolcreaterole
    or role_state.rolreplication
    or role_state.rolbypassrls
    or role_state.rolconnlimit <> 20
  then
    raise exception 'axsys_bff catalog assertion failed: unsafe role attributes';
  end if;

  if exists (
    select 1
    from pg_auth_members
    where member = (select oid from pg_roles where rolname = 'axsys_bff')
  ) then
    raise exception 'axsys_bff catalog assertion failed: unexpected membership';
  end if;

  if exists (
    select 1
    from pg_auth_members membership
    join pg_roles member_role on member_role.oid = membership.member
    where membership.roleid = (select oid from pg_roles where rolname = 'axsys_bff')
      and member_role.rolname not in ('postgres', 'supabase_admin')
  ) then
    raise exception 'axsys_bff catalog assertion failed: unexpected reverse membership';
  end if;

  if exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
    where defaults.defaclnamespace in (0, 'public'::regnamespace)
      and owner_role.rolname = 'postgres'
      and grantee_role.rolname in ('anon', 'authenticated', 'service_role')
      and defaults.defaclobjtype in ('r', 'S', 'f')
  ) then
    raise exception 'public default ACL assertion failed: unexpected API role grant';
  end if;

  if exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    where defaults.defaclnamespace = 'public'::regnamespace
      and owner_role.rolname = 'postgres'
      and defaults.defaclobjtype = 'f'
      and grant_item.grantee = 0
  ) then
    raise exception 'public default ACL assertion failed: unexpected PUBLIC function grant';
  end if;

  if not exists (
    select 1
    from pg_default_acl defaults
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    where defaults.defaclnamespace = 0
      and owner_role.rolname = 'postgres'
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        where grant_item.grantee = 0
      )
  ) then
    raise exception 'global default ACL assertion failed: PUBLIC function grant remains';
  end if;

  if has_schema_privilege('axsys_bff', 'public', 'USAGE')
    or has_schema_privilege('axsys_bff', 'public', 'CREATE')
  then
    raise exception 'axsys_bff catalog assertion failed: public schema privilege';
  end if;

  if not has_database_privilege('axsys_bff', 'postgres', 'CONNECT') then
    raise exception 'axsys_bff catalog assertion failed: missing database connect';
  end if;
end
$$;
