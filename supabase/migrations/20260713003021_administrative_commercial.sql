do $$ begin
  if current_user<>'postgres' or to_regclass('public.companies') is null then
    raise exception using errcode='55000',message='AXSYS_ADMINISTRATIVE_COMMERCIAL_DEPENDENCY_INVALID';
  end if;
end $$;

create type public.catalog_item_kind as enum ('service','product');
create type public.proposal_status as enum ('draft','sent','approved','rejected');
revoke all on type public.catalog_item_kind,public.proposal_status
from public,anon,authenticated,service_role,axsys_bff;

create table public.clients(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  legal_name text not null check(char_length(btrim(legal_name)) between 2 and 200),
  trade_name text check(trade_name is null or char_length(btrim(trade_name)) between 2 and 200),
  cnpj_normalized text not null check(cnpj_normalized~'^[0-9]{14}$'),
  segment text not null check(char_length(btrim(segment)) between 2 and 80),
  email text,phone text,address_street text,address_number text,address_complement text,
  address_neighborhood text,
  municipality text not null check(char_length(btrim(municipality)) between 2 and 120),
  state text not null check(state~'^[A-Z]{2}$'),
  postal_code text check(postal_code is null or postal_code~'^[0-9]{8}$'),
  archived_at timestamptz,archived_by uuid references auth.users(id) on delete restrict,
  version bigint not null default 1 check(version>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  constraint clients_company_cnpj_key unique(company_id,cnpj_normalized),
  constraint clients_company_id_id_key unique(company_id,id),
  constraint clients_company_id_id_segment_key unique(company_id,id,segment),
  constraint clients_archive_actor_check check(
    (archived_at is null and archived_by is null) or
    (archived_at is not null and archived_by is not null))
);

create table public.catalog_items(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  item_kind public.catalog_item_kind not null,
  segment text not null check(char_length(btrim(segment)) between 2 and 80),
  name text not null check(char_length(btrim(name)) between 2 and 160),
  description text not null check(char_length(btrim(description)) between 2 and 2000),
  archived_at timestamptz,archived_by uuid references auth.users(id) on delete restrict,
  version bigint not null default 1 check(version>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  constraint catalog_items_company_id_id_key unique(company_id,id),
  constraint catalog_items_company_id_id_segment_kind_key unique(company_id,id,segment,item_kind),
  constraint catalog_items_archive_actor_check check(
    (archived_at is null and archived_by is null) or
    (archived_at is not null and archived_by is not null))
);

create index clients_company_search_idx on public.clients(company_id,legal_name,id);
create index clients_company_trade_name_prefix_idx on public.clients(company_id,lower(trade_name) text_pattern_ops,id);
create index clients_company_legal_name_prefix_idx on public.clients(company_id,lower(legal_name) text_pattern_ops,id);
create index clients_company_active_idx on public.clients(company_id,segment,legal_name,id) where archived_at is null;
create index catalog_items_company_filter_idx on public.catalog_items(company_id,segment,item_kind,name,id);
create index catalog_items_company_name_prefix_idx on public.catalog_items(company_id,lower(name) text_pattern_ops,id);
create unique index catalog_items_active_name_uidx on public.catalog_items(company_id,segment,item_kind,lower(name)) where archived_at is null;

create function private.bump_version_and_updated_at() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.version:=old.version+1;new.updated_at:=now();return new;end;
$$;
revoke execute on function private.bump_version_and_updated_at()
from public,anon,authenticated,service_role,axsys_bff;
create trigger clients_bump_version before update on public.clients
for each row execute function private.bump_version_and_updated_at();
create trigger catalog_items_bump_version before update on public.catalog_items
for each row execute function private.bump_version_and_updated_at();

alter table public.clients enable row level security;
alter table public.catalog_items enable row level security;
revoke all on public.clients,public.catalog_items
from public,anon,authenticated,service_role,axsys_bff;
