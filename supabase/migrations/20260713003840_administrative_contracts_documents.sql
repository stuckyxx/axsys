do $$ begin
 if current_user <> 'postgres'
    or to_regclass('public.proposals') is null
    or to_regclass('public.file_objects') is null then
  raise exception using errcode='55000',message='AXSYS_ADMINISTRATIVE_CONTRACTS_DEPENDENCY_INVALID';
 end if;
end $$;

create table public.contracts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 client_id uuid not null,
 number text not null check (char_length(btrim(number)) between 1 and 80),
 object text not null check (char_length(btrim(object)) between 3 and 4000),
 starts_on date not null,
 ends_on date not null,
 amount numeric(14,2) not null check (amount >= 0),
 closed_at timestamptz,
 closed_by uuid references auth.users(id) on delete restrict,
 close_reason text,
 version bigint not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint contracts_company_number_key unique (company_id, number),
 constraint contracts_company_id_id_key unique (company_id, id),
 constraint contracts_company_id_id_client_key unique (company_id, id, client_id),
 constraint contracts_client_fk foreign key (company_id, client_id)
  references public.clients(company_id, id) on delete restrict,
 constraint contracts_dates_check check (ends_on >= starts_on),
 constraint contracts_closure_check check (
  (closed_at is null and closed_by is null and close_reason is null)
  or (closed_at is not null and closed_by is not null
      and char_length(btrim(close_reason)) between 3 and 1000)
 )
);

create table public.contract_attachments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 contract_id uuid not null,
 file_object_id uuid not null,
 attachment_group_id uuid not null default gen_random_uuid(),
 version integer not null check (version > 0),
 superseded_at timestamptz,
 superseded_by uuid references auth.users(id) on delete restrict,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 constraint contract_attachments_company_id_id_key unique (company_id, id),
 constraint contract_attachments_contract_fk foreign key (company_id, contract_id)
  references public.contracts(company_id, id) on delete restrict,
 constraint contract_attachments_file_fk foreign key (company_id, file_object_id)
  references public.file_objects(company_id, id) on delete restrict,
 constraint contract_attachments_group_version_key
  unique (company_id, contract_id, attachment_group_id, version),
 constraint contract_attachments_file_once_key unique (company_id, file_object_id),
 constraint contract_attachments_superseded_actor_check check (
  (superseded_at is null and superseded_by is null)
  or (superseded_at is not null and superseded_by is not null)
 )
);

create unique index contract_attachments_one_current_uidx
 on public.contract_attachments(company_id, contract_id, attachment_group_id)
 where superseded_at is null;
create index contracts_company_ends_cursor_idx on public.contracts(company_id, ends_on, id);
create index contracts_company_client_idx on public.contracts(company_id, client_id, ends_on, id);
create index contracts_company_open_idx on public.contracts(company_id, ends_on, id) where closed_at is null;
create index contracts_company_object_prefix_idx on public.contracts(company_id, lower(object) text_pattern_ops, id);
create index contracts_company_number_prefix_idx on public.contracts(company_id, lower(number) text_pattern_ops, id);
create index contract_attachments_contract_idx
 on public.contract_attachments(company_id, contract_id, attachment_group_id, version desc);
create trigger contracts_bump_version before update on public.contracts
 for each row execute function private.bump_version_and_updated_at();

create type public.document_kind as enum ('proposal','payment_letter','payment_process');

create table public.generated_documents (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 kind public.document_kind not null,
 proposal_id uuid,
 payment_request_id uuid,
 file_object_id uuid not null,
 version integer not null check (version > 0),
 checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
 immutable_snapshot jsonb not null check (jsonb_typeof(immutable_snapshot) = 'object'),
 template_version text not null check (char_length(btrim(template_version)) between 1 and 40),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 constraint generated_documents_company_id_id_key unique (company_id, id),
 constraint generated_documents_file_fk foreign key (company_id, file_object_id)
  references public.file_objects(company_id, id) on delete restrict,
 constraint generated_documents_proposal_fk foreign key (company_id, proposal_id)
  references public.proposals(company_id, id) on delete restrict,
 constraint generated_documents_exact_parent_check check (
  (kind='proposal' and proposal_id is not null and payment_request_id is null)
  or (kind in ('payment_letter','payment_process') and proposal_id is null and payment_request_id is not null)
 ),
 constraint generated_documents_parent_version_key unique nulls not distinct
  (company_id, kind, proposal_id, payment_request_id, version)
);
create index generated_documents_proposal_idx
 on public.generated_documents(company_id, proposal_id, version desc) where proposal_id is not null;
create index generated_documents_payment_idx
 on public.generated_documents(company_id, payment_request_id, kind, version desc) where payment_request_id is not null;

create function private.reject_generated_document_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='23514',message='generated documents are immutable';
end $$;
create trigger generated_documents_immutable before update or delete on public.generated_documents
 for each row execute function private.reject_generated_document_mutation();

create function private.guard_generated_document_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_file public.file_objects%rowtype;
begin
 if new.version is not null then
  raise exception using errcode='23514',message='AXSYS_DOCUMENT_VERSION_SERVER_ASSIGNED';
 end if;
 select * into v_file from public.file_objects file
 where file.company_id=new.company_id and file.id=new.file_object_id for share;
 if not found or v_file.purpose<>'generated_document' or v_file.status<>'ready'
    or v_file.scan_status<>'clean' or v_file.sha256<>new.checksum_sha256 then
  raise exception using errcode='23514',message='AXSYS_GENERATED_DOCUMENT_FILE_INVALID';
 end if;
 if new.kind='proposal' then
  perform 1 from public.proposals proposal
   where proposal.company_id=new.company_id and proposal.id=new.proposal_id for update;
  if not found then
   raise exception using errcode='23503',message='AXSYS_PROPOSAL_NOT_FOUND';
  end if;
  select coalesce(max(document.version),0)+1 into new.version
  from public.generated_documents document
  where document.company_id=new.company_id and document.kind='proposal'
    and document.proposal_id=new.proposal_id;
 else
  raise exception using errcode='55000',message='PAYMENT_DOCUMENT_WRITER_NOT_INSTALLED';
 end if;
 return new;
end $$;
create trigger generated_documents_guard before insert on public.generated_documents
 for each row execute function private.guard_generated_document_insert();

create function private.guard_contract_attachment_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists (
  select 1 from public.file_objects file
  join public.file_upload_intents intent
   on intent.company_id=file.company_id and intent.file_object_id=file.id
  where file.company_id=new.company_id and file.id=new.file_object_id
    and file.purpose='contract_attachment' and file.status='ready' and file.scan_status='clean'
    and intent.purpose='contract_attachment' and intent.target_resource_id=new.contract_id
 ) then
  raise exception using errcode='23514',message='AXSYS_CONTRACT_ATTACHMENT_FILE_INVALID';
 end if;
 return new;
end $$;
create trigger contract_attachments_guard before insert on public.contract_attachments
 for each row execute function private.guard_contract_attachment_insert();

create function private.guard_proposal_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- Exact legal predicate:
 -- (old.status='draft' and new.status in ('draft','sent'))
 -- or (old.status='sent' and new.status in ('sent','approved','rejected'))
 -- or (old.status=new.status and old.status in ('approved','rejected')).
 if not ((old.status='draft' and new.status in ('draft','sent'))
      or (old.status='sent' and new.status in ('sent','approved','rejected'))
      or (old.status=new.status and old.status in ('approved','rejected'))) then
  raise exception using errcode='23514',message='AXSYS_PROPOSAL_TRANSITION_INVALID';
 end if;
 if old.status<>'draft' and (
  new.company_id is distinct from old.company_id or new.number is distinct from old.number
  or new.client_id is distinct from old.client_id or new.segment is distinct from old.segment
  or new.issued_on is distinct from old.issued_on or new.total is distinct from old.total
 ) then
  raise exception using errcode='23514',message='AXSYS_PROPOSAL_IMMUTABLE';
 end if;
 if old.status='draft' and new.status='sent' then
  if not exists(select 1 from public.generated_documents document
   where document.company_id=old.company_id and document.proposal_id=old.id and document.kind='proposal') then
   raise exception using errcode='23514',message='AXSYS_PROPOSAL_DOCUMENT_REQUIRED';
  end if;
  new.sent_at:=coalesce(old.sent_at,statement_timestamp());
 elsif old.status='draft' then
  new.sent_at:=null;
 else
  new.sent_at:=old.sent_at;
 end if;
 return new;
end $$;
create trigger proposals_state_guard before update on public.proposals
 for each row execute function private.guard_proposal_update();

create function private.guard_proposal_item_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_status public.proposal_status;
begin
 select proposal.status into v_status from public.proposals proposal
 where proposal.company_id=coalesce(new.company_id,old.company_id)
   and proposal.id=coalesce(new.proposal_id,old.proposal_id) for share;
 if v_status is distinct from 'draft'::public.proposal_status then
  raise exception using errcode='23514',message='AXSYS_PROPOSAL_ITEMS_IMMUTABLE';
 end if;
 return coalesce(new,old);
end $$;
create trigger proposal_items_state_guard before update or delete on public.proposal_items
 for each row execute function private.guard_proposal_item_mutation();

alter table public.contracts enable row level security;
alter table public.contract_attachments enable row level security;
alter table public.generated_documents enable row level security;
revoke all on public.contracts,public.contract_attachments,public.generated_documents
 from public,anon,authenticated,service_role,axsys_bff;
revoke all on type public.document_kind from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.reject_generated_document_mutation(),
 private.guard_generated_document_insert(),private.guard_contract_attachment_insert(),
 private.guard_proposal_update(),private.guard_proposal_item_mutation()
 from public,anon,authenticated,service_role,axsys_bff;
