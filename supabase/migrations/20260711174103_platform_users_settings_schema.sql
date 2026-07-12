do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PLATFORM_USERS_SETTINGS_SCHEMA_MIGRATION_OWNER_INVALID';
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

  if not exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from pg_catalog.aclexplode(defaults.defaclacl) grant_item
        left join pg_catalog.pg_roles grantee on grantee.oid = grant_item.grantee
        where grant_item.grantee = 0
          or grantee.rolname in ('anon', 'authenticated', 'service_role', 'axsys_bff')
      )
  )
  or not exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'T'
      and not exists (
        select 1
        from pg_catalog.aclexplode(defaults.defaclacl) grant_item
        left join pg_catalog.pg_roles grantee on grantee.oid = grant_item.grantee
        where grant_item.grantee = 0
          or grantee.rolname in ('anon', 'authenticated', 'service_role', 'axsys_bff')
      )
  )
  or exists (
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
      message = 'AXSYS_PLATFORM_USERS_SETTINGS_DEFAULT_ACL_INVALID';
  end if;
end
$$;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if 1 <> (
    select count(*)
    from pg_catalog.pg_extension extension
    join pg_catalog.pg_namespace namespace on namespace.oid = extension.extnamespace
    where extension.extname = 'pg_cron'
      and namespace.nspname = 'pg_catalog'
      and extension.extowner = 'supabase_admin'::regrole
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PG_CRON_EXTENSION_CATALOG_INVALID';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_namespace namespace
    where namespace.nspname = 'cron'
      and namespace.nspowner = 'supabase_admin'::regrole
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PG_CRON_SCHEMA_CATALOG_INVALID';
  end if;
end
$$;

-- Supabase owns pg_cron objects with the managed supabase_admin role. The local
-- migration role (postgres) is deliberately not a member and cannot SET ROLE or
-- revoke those object ACLs. Removing USAGE from cron is therefore the
-- authoritative boundary: even extension-level PUBLIC grants remain
-- unreachable. Catalog and behavioral pgTAP sentinels below freeze that model.
revoke all on schema cron
from public, anon, authenticated, service_role, axsys_bff;

do $$
begin
  if exists (
    select 1
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join unnest(array['USAGE','CREATE']) privilege
    where has_schema_privilege(role_name, 'cron', privilege)
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PG_CRON_SCHEMA_ACL_INVALID';
  end if;

  if exists (
    select 1
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_catalog.pg_class class
    cross join unnest(array['USAGE','SELECT','UPDATE']) privilege
    where class.relnamespace = 'cron'::regnamespace
      and class.relkind = 'S'
      and has_sequence_privilege(role_name, class.oid, privilege)
  ) then
    execute 'revoke all on all sequences in schema cron '
      || 'from public, anon, authenticated, service_role, axsys_bff';
  end if;

  if exists (
    select 1
    from unnest(array['public','anon','authenticated','service_role','axsys_bff']) role_name
    cross join pg_catalog.pg_class class
    cross join unnest(array['USAGE','SELECT','UPDATE']) privilege
    where class.relnamespace = 'cron'::regnamespace
      and class.relkind = 'S'
      and has_sequence_privilege(role_name, class.oid, privilege)
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_PG_CRON_SEQUENCE_ACL_INVALID';
  end if;
end
$$;

create type public.file_purpose as enum (
  'profile_avatar',
  'company_letterhead',
  'company_signature',
  'contract_attachment',
  'payment_invoice',
  'certificate',
  'generated_document'
);
create type public.file_scan_status as enum ('pending', 'clean', 'infected', 'failed');
create type public.file_status as enum ('ready', 'rejected', 'archived');
create type public.upload_intent_status as enum (
  'reserved',
  'issued',
  'finalizing',
  'ready',
  'rejected',
  'expired',
  'cancelled',
  'cleanup_required'
);
create type public.bank_account_status as enum ('active', 'archived');
create type public.bank_account_type as enum ('checking', 'savings', 'payment');
create type public.provisioning_kind as enum ('company_first_admin', 'company_member');
create type public.provisioning_status as enum (
  'reserved',
  'auth_created',
  'committed',
  'compensated',
  'compensation_required',
  'failed'
);

revoke all on type public.file_purpose,
  public.file_scan_status,
  public.file_status,
  public.upload_intent_status,
  public.bank_account_status,
  public.bank_account_type,
  public.provisioning_kind,
  public.provisioning_status
from public, anon, authenticated, service_role, axsys_bff;

create or replace function private.format_company_address(
  p_street text,
  p_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_postal_code text
) returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    ' · ',
    nullif(concat_ws(', ', nullif(btrim(p_street), ''), nullif(btrim(p_number), '')), ''),
    nullif(btrim(p_complement), ''),
    nullif(btrim(p_neighborhood), ''),
    nullif(concat_ws('/', nullif(btrim(p_city), ''), nullif(upper(btrim(p_state)), '')), ''),
    case
      when nullif(regexp_replace(coalesce(p_postal_code, ''), '[^0-9]', '', 'g'), '') is null
        then null
      else 'CEP ' || regexp_replace(p_postal_code, '[^0-9]', '', 'g')
    end
  )
$$;

create function private.is_canonical_base64(
  p_value text,
  p_expected_bytes integer
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_decoded bytea;
begin
  if p_value is null
     or p_value = ''
     or (p_expected_bytes is not null and p_expected_bytes <= 0)
     or p_value !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
  then
    return false;
  end if;

  begin
    v_decoded := pg_catalog.decode(p_value, 'base64');
  exception
    when data_exception then
      return false;
  end;

  return pg_catalog.octet_length(v_decoded) > 0
    and pg_catalog.replace(pg_catalog.encode(v_decoded, 'base64'), E'\n', '') = p_value
    and (
      p_expected_bytes is null
      or pg_catalog.octet_length(v_decoded) = p_expected_bytes
    );
end;
$$;

create table public.file_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  owner_user_id uuid references public.profiles(user_id) on delete restrict,
  purpose public.file_purpose not null,
  bucket text not null constraint file_objects_bucket_value
    check (bucket = 'axsys-private'),
  object_path text not null constraint file_objects_object_path_safe
    check (object_path !~ '(\.\.|//|^/)'),
  original_name text not null constraint file_objects_original_name_length
    check (char_length(original_name) between 1 and 255),
  detected_mime text not null,
  byte_size bigint not null constraint file_objects_byte_size_bounds check (
    byte_size >= 1
    and (
      (
        purpose in ('profile_avatar', 'company_letterhead', 'company_signature')
        and byte_size <= 5242880
      )
      or (purpose = 'certificate' and byte_size <= 10485760)
      or (purpose = 'payment_invoice' and byte_size <= 15728640)
      or (purpose = 'contract_attachment' and byte_size <= 20971520)
      or (purpose = 'generated_document' and byte_size <= 26214400)
    )
  ),
  sha256 text not null constraint file_objects_sha256_format
    check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status public.file_scan_status not null,
  status public.file_status not null,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  archived_at timestamptz,
  retirement_not_before timestamptz,
  retirement_claim_id uuid,
  retirement_claimed_at timestamptz,
  storage_deleted_at timestamptz,
  quota_released_at timestamptz,
  unique (bucket, object_path),
  unique (company_id, id),
  constraint file_objects_profile_owner
    check ((purpose = 'profile_avatar') = (owner_user_id is not null)),
  constraint file_objects_ready_state
    check (status <> 'ready' or (scan_status = 'clean' and promoted_at is not null)),
  constraint file_objects_infected_state
    check (scan_status <> 'infected' or status = 'rejected'),
  constraint file_objects_archive_state
    check ((status = 'archived') = (archived_at is not null)),
  constraint file_objects_retirement_purpose check (
    retirement_not_before is null
    or purpose in ('profile_avatar', 'company_letterhead', 'company_signature')
  ),
  constraint file_objects_retirement_claim_pair check (
    (retirement_claim_id is null) = (retirement_claimed_at is null)
  ),
  constraint file_objects_storage_quota_release_pair
    check ((storage_deleted_at is null) = (quota_released_at is null))
);

create table public.file_upload_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  purpose public.file_purpose not null,
  target_resource_id uuid,
  quarantine_object_path text not null unique
    constraint file_upload_intents_quarantine_object_path_safe
    check (quarantine_object_path !~ '(\.\.|//|^/)'),
  declared_name text not null constraint file_upload_intents_declared_name_length
    check (char_length(declared_name) between 1 and 255),
  declared_mime text not null,
  declared_size bigint not null constraint file_upload_intents_declared_size_bounds check (
    declared_size >= 1
    and (
      (
        purpose in ('profile_avatar', 'company_letterhead', 'company_signature')
        and declared_size <= 5242880
      )
      or (purpose = 'certificate' and declared_size <= 10485760)
      or (purpose = 'payment_invoice' and declared_size <= 15728640)
      or (purpose = 'contract_attachment' and declared_size <= 20971520)
      or (purpose = 'generated_document' and declared_size <= 26214400)
    )
  ),
  status public.upload_intent_status not null default 'reserved',
  quota_hold_bytes bigint not null constraint file_upload_intents_quota_hold_values check (
    quota_hold_bytes in (0, declared_size, declared_size * 2)
  ),
  authorization_issued_at timestamptz,
  upload_authorization_expires_at timestamptz,
  cleanup_not_before timestamptz,
  authorization_retired_at timestamptz,
  authorization_cleanup_claim_id uuid,
  authorization_cleanup_claimed_at timestamptz,
  cleanup_error_code text constraint file_upload_intents_cleanup_error_code_format check (
    cleanup_error_code is null or cleanup_error_code ~ '^[A-Z0-9_]{3,64}$'
  ),
  file_object_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, file_object_id)
    references public.file_objects(company_id, id)
    on delete restrict,
  constraint file_upload_intents_authorization_state check (
    (
      status in ('reserved', 'cancelled')
      and authorization_issued_at is null
      and upload_authorization_expires_at is null
      and cleanup_not_before is null
      and (
        (status = 'reserved' and authorization_retired_at is null)
        or (status = 'cancelled' and authorization_retired_at is not null)
      )
    )
    or (
      status not in ('reserved', 'cancelled')
      and authorization_issued_at is not null
      and upload_authorization_expires_at is not null
      and cleanup_not_before is not null
    )
  ),
  constraint file_upload_intents_authorization_expiry_window check (
    upload_authorization_expires_at is null
    or upload_authorization_expires_at between
      authorization_issued_at + interval '1 hour 55 minutes'
      and authorization_issued_at + interval '2 hours 5 minutes'
  ),
  constraint file_upload_intents_cleanup_window check (
    cleanup_not_before is null
    or cleanup_not_before >= upload_authorization_expires_at + interval '24 hours 15 minutes'
  ),
  constraint file_upload_intents_authorization_retirement_order check (
    authorization_retired_at is null
    or cleanup_not_before is null
    or authorization_retired_at >= cleanup_not_before
  ),
  constraint file_upload_intents_authorization_claim_pair check (
    (authorization_cleanup_claim_id is null)
    = (authorization_cleanup_claimed_at is null)
  )
);

create table private.company_storage_usage (
  company_id uuid primary key references public.companies(id) on delete restrict,
  quota_bytes bigint not null default 5368709120 constraint company_storage_usage_quota_bounds
    check (quota_bytes between 104857600 and 1099511627776),
  used_bytes bigint not null default 0 constraint company_storage_usage_used_nonnegative
    check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 constraint company_storage_usage_reserved_nonnegative
    check (reserved_bytes >= 0),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint company_storage_usage_capacity
    check (used_bytes + reserved_bytes <= quota_bytes)
);

create function private.initialize_company_storage_usage() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.company_storage_usage(company_id)
  values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

create trigger companies_initialize_storage_usage
after insert on public.companies
for each row execute function private.initialize_company_storage_usage();

insert into private.company_storage_usage(company_id)
select id
from public.companies
on conflict (company_id) do nothing;

do $$
begin
  if exists (
    select 1
    from public.companies company
    left join private.company_storage_usage usage on usage.company_id = company.id
    where usage.company_id is null
  ) then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_COMPANY_STORAGE_USAGE_BACKFILL_INCOMPLETE';
  end if;
end
$$;

alter table public.profiles
  add column avatar_file_id uuid references public.file_objects(id) on delete set null;

create index file_objects_company_purpose_status_idx
  on public.file_objects(company_id, purpose, status);
create index file_objects_owner_user_id_idx
  on public.file_objects(owner_user_id);
create index file_objects_created_by_idx
  on public.file_objects(created_by);
create index file_upload_intents_actor_status_idx
  on public.file_upload_intents(actor_user_id, status, cleanup_not_before);
create index file_upload_intents_company_file_object_idx
  on public.file_upload_intents(company_id, file_object_id);
create index file_upload_intents_expiry_idx
  on public.file_upload_intents(cleanup_not_before)
  where authorization_retired_at is null;
create index profiles_avatar_file_id_idx
  on public.profiles(avatar_file_id);

create table public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bank_code text not null constraint company_bank_accounts_bank_code_format
    check (bank_code ~ '^[0-9]{3,8}$'),
  bank_name text not null constraint company_bank_accounts_bank_name_length
    check (char_length(btrim(bank_name)) between 2 and 120),
  branch_ciphertext text not null constraint company_bank_accounts_branch_ciphertext_base64
    check (private.is_canonical_base64(branch_ciphertext, null)),
  branch_iv text not null constraint company_bank_accounts_branch_iv_length
    check (private.is_canonical_base64(branch_iv, 12)),
  branch_tag text not null constraint company_bank_accounts_branch_tag_length
    check (private.is_canonical_base64(branch_tag, 16)),
  branch_key_version integer not null
    constraint company_bank_accounts_branch_key_version_positive
    check (branch_key_version > 0),
  branch_last4 text not null constraint company_bank_accounts_branch_last4_format
    check (branch_last4 ~ '^[0-9]{1,4}$'),
  account_ciphertext text not null constraint company_bank_accounts_account_ciphertext_base64
    check (private.is_canonical_base64(account_ciphertext, null)),
  account_iv text not null constraint company_bank_accounts_account_iv_length
    check (private.is_canonical_base64(account_iv, 12)),
  account_tag text not null constraint company_bank_accounts_account_tag_length
    check (private.is_canonical_base64(account_tag, 16)),
  account_key_version integer not null
    constraint company_bank_accounts_account_key_version_positive
    check (account_key_version > 0),
  account_last4 text not null constraint company_bank_accounts_account_last4_format
    check (account_last4 ~ '^[0-9]{1,4}$'),
  account_type public.bank_account_type not null,
  holder_name text not null constraint company_bank_accounts_holder_name_length
    check (char_length(btrim(holder_name)) between 2 and 160),
  holder_document_ciphertext text
    constraint company_bank_accounts_holder_document_ciphertext_base64
    check (
      holder_document_ciphertext is null
      or private.is_canonical_base64(holder_document_ciphertext, null)
    ),
  holder_document_iv text constraint company_bank_accounts_holder_document_iv_length
    check (
      holder_document_iv is null
      or private.is_canonical_base64(holder_document_iv, 12)
    ),
  holder_document_tag text constraint company_bank_accounts_holder_document_tag_length
    check (
      holder_document_tag is null
      or private.is_canonical_base64(holder_document_tag, 16)
    ),
  holder_document_key_version integer
    constraint company_bank_accounts_holder_document_key_version_positive
    check (holder_document_key_version is null or holder_document_key_version > 0),
  holder_document_last4 text
    constraint company_bank_accounts_holder_document_last4_format
    check (holder_document_last4 is null or holder_document_last4 ~ '^[0-9]{4}$'),
  status public.bank_account_status not null default 'active',
  is_default boolean not null default false,
  version bigint not null default 1,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (company_id, id),
  constraint company_bank_accounts_default_active
    check (not is_default or status = 'active'),
  constraint company_bank_accounts_archive_state
    check ((status = 'archived') = (archived_at is not null)),
  constraint company_bank_accounts_holder_document_state check (
    (
      holder_document_ciphertext is null
      and holder_document_iv is null
      and holder_document_tag is null
      and holder_document_key_version is null
      and holder_document_last4 is null
    )
    or (
      holder_document_ciphertext is not null
      and holder_document_iv is not null
      and holder_document_tag is not null
      and holder_document_key_version is not null
      and holder_document_last4 is not null
    )
  )
);

create unique index company_bank_accounts_one_active_default_idx
  on public.company_bank_accounts(company_id)
  where status = 'active' and is_default;
create index company_bank_accounts_company_status_idx
  on public.company_bank_accounts(company_id, status, created_at);
create index company_bank_accounts_created_by_idx
  on public.company_bank_accounts(created_by);
create index company_bank_accounts_updated_by_idx
  on public.company_bank_accounts(updated_by);

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete restrict,
  representative_name text,
  representative_role text,
  representative_document_ciphertext text
    constraint company_settings_representative_document_ciphertext_base64
    check (
      representative_document_ciphertext is null
      or private.is_canonical_base64(representative_document_ciphertext, null)
    ),
  representative_document_iv text
    constraint company_settings_representative_document_iv_length
    check (
      representative_document_iv is null
      or private.is_canonical_base64(representative_document_iv, 12)
    ),
  representative_document_tag text
    constraint company_settings_representative_document_tag_length
    check (
      representative_document_tag is null
      or private.is_canonical_base64(representative_document_tag, 16)
    ),
  representative_document_key_version integer
    constraint company_settings_representative_document_key_version_positive
    check (
      representative_document_key_version is null
      or representative_document_key_version > 0
    ),
  representative_document_last4 text
    constraint company_settings_representative_document_last4_format
    check (
      representative_document_last4 is null
      or representative_document_last4 ~ '^[0-9]{4}$'
    ),
  tax_rate numeric(5,2) not null default 0
    constraint company_settings_tax_rate_bounds check (tax_rate between 0 and 100),
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text constraint company_settings_address_state_format
    check (address_state is null or address_state ~ '^[A-Z]{2}$'),
  address_postal_code text
    constraint company_settings_address_postal_code_format
    check (address_postal_code is null or address_postal_code ~ '^[0-9]{8}$'),
  consolidated_address text generated always as (
    private.format_company_address(
      address_street,
      address_number,
      address_complement,
      address_neighborhood,
      address_city,
      address_state,
      address_postal_code
    )
  ) stored,
  letterhead_file_id uuid,
  signature_file_id uuid,
  version bigint not null default 1,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_at timestamptz not null default now(),
  foreign key (company_id, letterhead_file_id)
    references public.file_objects(company_id, id)
    on delete restrict,
  foreign key (company_id, signature_file_id)
    references public.file_objects(company_id, id)
    on delete restrict,
  constraint company_settings_representative_document_state check (
    (
      representative_document_ciphertext is null
      and representative_document_iv is null
      and representative_document_tag is null
      and representative_document_key_version is null
      and representative_document_last4 is null
    )
    or (
      representative_document_ciphertext is not null
      and representative_document_iv is not null
      and representative_document_tag is not null
      and representative_document_key_version is not null
      and representative_document_last4 is not null
    )
  )
);

create table public.company_settings_drafts (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  payload jsonb not null default '{}'::jsonb
    constraint company_settings_drafts_payload_object
    check (jsonb_typeof(payload) = 'object'),
  base_version bigint not null constraint company_settings_drafts_base_version_positive
    check (base_version > 0),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_settings_updated_by_idx
  on public.company_settings(updated_by);
create index company_settings_letterhead_file_idx
  on public.company_settings(company_id, letterhead_file_id);
create index company_settings_signature_file_idx
  on public.company_settings(company_id, signature_file_id);
create index company_settings_drafts_user_id_idx
  on public.company_settings_drafts(user_id);

create table public.provisioning_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null constraint provisioning_operations_idempotency_key_hash
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  request_hash text not null constraint provisioning_operations_request_hash_format
    check (request_hash ~ '^[0-9a-f]{64}$'),
  kind public.provisioning_kind not null,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  subject_email_hash text not null
    constraint provisioning_operations_subject_email_hash_format
    check (subject_email_hash ~ '^[0-9a-f]{64}$'),
  auth_user_id uuid,
  status public.provisioning_status not null default 'reserved',
  last_error_code text constraint provisioning_operations_last_error_code_allowlist
    check (
      last_error_code is null
      or last_error_code in (
        'AUTH_CREATE_FAILED',
        'DB_COMMIT_FAILED',
        'AUTH_DELETE_FAILED',
        'AUTH_BAN_FAILED',
        'AUTH_LOOKUP_FAILED',
        'RECONCILIATION_FAILED'
      )
    ),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create index provisioning_operations_reconcile_idx
  on public.provisioning_operations(status, updated_at)
  where status in ('reserved', 'auth_created', 'compensation_required');
create index provisioning_operations_company_id_idx
  on public.provisioning_operations(company_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'axsys-quarantine',
    'axsys-quarantine',
    false,
    26214400,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'application/xml',
      'text/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'axsys-private',
    'axsys-private',
    false,
    26214400,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'application/xml',
      'text/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.file_objects enable row level security;
alter table public.file_objects force row level security;
alter table public.file_upload_intents enable row level security;
alter table public.file_upload_intents force row level security;
alter table public.company_bank_accounts enable row level security;
alter table public.company_bank_accounts force row level security;
alter table public.company_settings enable row level security;
alter table public.company_settings force row level security;
alter table public.company_settings_drafts enable row level security;
alter table public.company_settings_drafts force row level security;
alter table public.provisioning_operations enable row level security;
alter table public.provisioning_operations force row level security;
alter table private.company_storage_usage enable row level security;
alter table private.company_storage_usage force row level security;

revoke all on public.file_objects,
  public.file_upload_intents,
  public.company_bank_accounts,
  public.company_settings,
  public.company_settings_drafts,
  public.provisioning_operations
from public, anon, authenticated, service_role, axsys_bff;

revoke all on private.company_storage_usage
from public, anon, authenticated, service_role, axsys_bff;
revoke all on function private.initialize_company_storage_usage()
from public, anon, authenticated, service_role, axsys_bff;
revoke all on function private.is_canonical_base64(text, integer)
from public, anon, authenticated, service_role, axsys_bff;
revoke all on function private.format_company_address(
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
from public, anon, authenticated, service_role, axsys_bff;
