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
