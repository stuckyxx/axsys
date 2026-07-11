create schema if not exists test_helpers;

create or replace function test_helpers.create_auth_user(
  p_user_id uuid,
  p_email text
) returns void
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    p_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    lower(btrim(p_email)),
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ) on conflict (id) do nothing;
$$;

create or replace function test_helpers.create_auth_session(
  p_session_id uuid,
  p_user_id uuid,
  p_created_at timestamptz default clock_timestamp()
) returns void
language sql
as $$
  insert into auth.sessions (
    id, user_id, created_at, updated_at
  ) values (
    p_session_id, p_user_id, p_created_at, p_created_at
  ) on conflict (id) do nothing;
$$;

create or replace function test_helpers.create_company(
  p_company_id uuid,
  p_legal_name text,
  p_cnpj text
) returns void
language sql
as $$
  insert into public.companies (
    id, legal_name, cnpj_normalized, contact_email
  ) values (
    p_company_id, p_legal_name, p_cnpj,
    lower(replace(p_legal_name, ' ', '.')) || '@example.test'
  ) on conflict (id) do nothing;
$$;

create or replace function test_helpers.create_company_user(
  p_user_id uuid,
  p_email text,
  p_company_id uuid,
  p_membership_id uuid,
  p_role public.membership_role,
  p_modules public.module_key[] default '{}'::public.module_key[]
) returns void
language plpgsql
as $$
declare
  v_module public.module_key;
begin
  perform test_helpers.create_auth_user(p_user_id, p_email);
  perform test_helpers.create_company(
    p_company_id,
    'Empresa ' || right(p_company_id::text, 1),
    lpad((10000000000000 + ascii(right(p_company_id::text, 1)))::text, 14, '0')
  );
  insert into public.profiles (user_id, email, display_name)
  values (p_user_id, lower(btrim(p_email)), split_part(p_email, '@', 1))
  on conflict (user_id) do nothing;
  insert into public.company_memberships (id, company_id, user_id, role)
  values (p_membership_id, p_company_id, p_user_id, p_role)
  on conflict (id) do nothing;
  foreach v_module in array p_modules loop
    insert into public.member_modules (company_id, membership_id, module)
    values (p_company_id, p_membership_id, v_module)
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function test_helpers.set_jwt(
  p_user_id uuid,
  p_session_id uuid default '90000000-0000-4000-8000-000000000001'
) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'session_id', p_session_id,
      'aal', 'aal1',
      'is_anonymous', false
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
end;
$$;

create or replace function test_helpers.clear_jwt() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
