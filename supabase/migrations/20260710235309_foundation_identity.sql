do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_IDENTITY_MIGRATION_OWNER_INVALID';
  end if;

  if not exists (
    select 1
    from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        left join pg_roles grantee on grantee.oid = grant_item.grantee
        where grant_item.grantee = 0
           or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) or exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace in (0, 'public'::regnamespace)
      and defaults.defaclobjtype in ('r','S','f')
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_GLOBAL_DEFAULT_ACL_NOT_HARDENED';
  end if;
end
$$;

create extension if not exists citext with schema extensions;

create type public.company_status as enum ('active', 'archived');
create type public.platform_role as enum ('super_admin');
create type public.membership_role as enum ('company_admin', 'member');
create type public.membership_status as enum ('active', 'suspended');
create type public.module_key as enum ('administrative', 'financial', 'certificates');
create type public.theme_preference as enum ('dark', 'light');

create schema if not exists private authorization postgres;
do $$
begin
  if (
    select namespace.nspowner <> 'postgres'::regrole
    from pg_namespace namespace
    where namespace.nspname = 'private'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_PRIVATE_SCHEMA_OWNER_INVALID';
  end if;
end
$$;
revoke all on schema private from public, anon, authenticated, service_role, axsys_bff;
grant usage on schema private to axsys_bff;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role, axsys_bff;

revoke all on schema public from public;
grant all on schema public to postgres;
grant usage on schema public to authenticator, anon, authenticated, service_role,
  supabase_admin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  display_name text not null,
  preferred_theme public.theme_preference not null default 'dark',
  must_change_password boolean not null default false,
  temporary_password_expires_at timestamptz,
  password_changed_at timestamptz,
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profiles_email_normalized check (email::text = lower(btrim(email::text))),
  constraint profiles_display_name_length check (char_length(btrim(display_name)) between 2 and 120),
  constraint profiles_temporary_password_state check (
    (must_change_password and temporary_password_expires_at is not null)
    or (not must_change_password and temporary_password_expires_at is null)
  )
);

create table public.platform_roles (
  user_id uuid primary key references public.profiles(user_id) on delete restrict,
  role public.platform_role not null default 'super_admin',
  is_active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  cnpj_normalized text not null unique,
  contact_email extensions.citext not null,
  contact_phone text,
  timezone text not null default 'America/Fortaleza',
  status public.company_status not null default 'active',
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint companies_legal_name_length check (char_length(btrim(legal_name)) between 2 and 160),
  constraint companies_cnpj_format check (cnpj_normalized ~ '^[0-9]{14}$'),
  constraint companies_email_normalized check (contact_email::text = lower(btrim(contact_email::text))),
  constraint companies_archive_state check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid not null unique references public.profiles(user_id) on delete restrict,
  role public.membership_role not null,
  status public.membership_status not null default 'active',
  created_by uuid references public.profiles(user_id) on delete restrict,
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(user_id) on delete restrict,
  suspension_reason text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, id),
  unique (company_id, user_id),
  constraint memberships_suspension_state check (
    (status = 'active' and suspended_at is null and suspended_by is null and suspension_reason is null)
    or (
      status = 'suspended'
      and suspended_at is not null
      and suspension_reason is not null
      and char_length(btrim(suspension_reason)) between 3 and 500
    )
  )
);

create table public.member_modules (
  company_id uuid not null,
  membership_id uuid not null,
  module public.module_key not null,
  granted_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (membership_id, module),
  foreign key (company_id, membership_id)
    references public.company_memberships(company_id, id)
    on delete cascade
);

create index companies_status_idx on public.companies(status);
create index memberships_company_status_idx
  on public.company_memberships(company_id, status, role);
create index memberships_user_status_idx
  on public.company_memberships(user_id, status);
create index member_modules_company_module_idx
  on public.member_modules(company_id, module, membership_id);
create index platform_roles_created_by_idx
  on public.platform_roles(created_by);
create index companies_archived_by_idx
  on public.companies(archived_by);
create index memberships_created_by_idx
  on public.company_memberships(created_by);
create index memberships_suspended_by_idx
  on public.company_memberships(suspended_by);
create index member_modules_granted_by_idx
  on public.member_modules(granted_by);
create index member_modules_company_membership_idx
  on public.member_modules(company_id, membership_id);

create function private.touch_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger profiles_touch_version before update on public.profiles
for each row execute function private.touch_version();
create trigger companies_touch_version before update on public.companies
for each row execute function private.touch_version();
create trigger memberships_touch_version before update on public.company_memberships
for each row execute function private.touch_version();

create function private.serialize_identity_invariants() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(1672, 0);
  return null;
end;
$$;

create trigger platform_roles_serialize_identity_invariants
before insert or update of user_id on public.platform_roles
for each statement execute function private.serialize_identity_invariants();
create trigger company_memberships_serialize_identity_invariants
before insert or update of user_id, company_id, role, status or delete
on public.company_memberships
for each statement execute function private.serialize_identity_invariants();

create function private.enforce_identity_exclusivity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id <> new.user_id then
    if old.user_id::text < new.user_id::text then
      perform pg_advisory_xact_lock(hashtextextended(old.user_id::text, 1672));
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
    else
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
      perform pg_advisory_xact_lock(hashtextextended(old.user_id::text, 1672));
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
  end if;

  if tg_table_name = 'platform_roles' and exists (
    select 1 from public.company_memberships where user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'identity_scope_conflict';
  end if;
  if tg_table_name = 'company_memberships' and exists (
    select 1 from public.platform_roles where user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'identity_scope_conflict';
  end if;
  return new;
end;
$$;

create trigger platform_role_identity_exclusivity
before insert or update of user_id on public.platform_roles
for each row execute function private.enforce_identity_exclusivity();
create trigger membership_identity_exclusivity
before insert or update of user_id on public.company_memberships
for each row execute function private.enforce_identity_exclusivity();

create function private.protect_last_company_admin() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_leaves_active_admin_set boolean;
begin
  if tg_op = 'DELETE' then
    v_leaves_active_admin_set := true;
  else
    v_leaves_active_admin_set :=
      new.company_id is distinct from old.company_id
      or new.role is distinct from 'company_admin'::public.membership_role
      or new.status is distinct from 'active'::public.membership_status;
  end if;

  if old.role = 'company_admin'
     and old.status = 'active'
     and v_leaves_active_admin_set then
    perform pg_advisory_xact_lock(hashtextextended(old.company_id::text, 2102));
    if not exists (
      select 1 from public.company_memberships other
      where other.company_id = old.company_id
        and other.id <> old.id
        and other.role = 'company_admin'
        and other.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'last_active_company_admin';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_last_company_admin
before update of company_id, role, status or delete on public.company_memberships
for each row execute function private.protect_last_company_admin();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_roles force row level security;
alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.company_memberships enable row level security;
alter table public.company_memberships force row level security;
alter table public.member_modules enable row level security;
alter table public.member_modules force row level security;

revoke all on public.profiles, public.platform_roles, public.companies,
  public.company_memberships, public.member_modules
  from public, anon, authenticated, service_role, axsys_bff;
revoke all on all functions in schema private
  from public, anon, authenticated, service_role, axsys_bff;
