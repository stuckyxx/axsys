do $$ begin
 if current_user<>'postgres' or to_regclass('public.generated_documents') is null
  or to_regprocedure('private.begin_download_audit_core(uuid,uuid,uuid,text,uuid,uuid)') is null
  or to_regprocedure('private.assert_administrative_actor(uuid,uuid)') is null then
  raise exception using errcode='55000',message='AXSYS_PROPOSAL_DOCUMENT_DEPENDENCY_INVALID';
 end if;
end $$;

create table private.generated_document_orphan_cleanup (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 proposal_id uuid not null,
 object_path text not null unique check(object_path !~ '(\.\.|//|^/)'),
 path_hash text not null unique check(path_hash~'^[0-9a-f]{64}$'),
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 status text not null default 'pending' check(status in ('pending','claimed','resolved')),
 attempts integer not null default 0 check(attempts>=0),
 claim_id uuid,
 claimed_at timestamptz,
 last_error_code text check(last_error_code is null or last_error_code~'^[A-Z0-9_]{3,64}$'),
 created_by uuid not null references public.profiles(user_id) on delete restrict,
 correlation_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint generated_document_orphan_proposal_fk foreign key(company_id,proposal_id)
  references public.proposals(company_id,id) on delete restrict,
 constraint generated_document_orphan_claim_check check((claim_id is null)=(claimed_at is null))
);
revoke all on private.generated_document_orphan_cleanup from public,anon,authenticated,service_role,axsys_bff;

create function private.record_generated_document_orphan_cleanup(p_actor_id uuid,p_session_id uuid,
 p_proposal_id uuid,p_object_path text,p_sha256 text,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare co uuid;cleanup private.generated_document_orphan_cleanup%rowtype;inserted boolean:=false;
 path_hash text;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_proposal_id is null or p_correlation_id is null or p_sha256 !~ '^[0-9a-f]{64}$'
  or p_object_path is null
  or p_object_path !~ ('^'||co::text||'/generated-documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$') then
  raise exception using errcode='22023',message='AXSYS_GENERATED_DOCUMENT_ORPHAN_INVALID';end if;
 perform 1 from public.proposals proposal where proposal.company_id=co and proposal.id=p_proposal_id;
 if not found then raise exception using errcode='P0002',message='AXSYS_PROPOSAL_DOCUMENT_NOT_FOUND';end if;
 if exists(select 1 from public.file_objects file where file.bucket='axsys-private' and file.object_path=p_object_path) then
  raise exception using errcode='23514',message='AXSYS_GENERATED_DOCUMENT_ORPHAN_ALREADY_TRACKED';end if;
 path_hash:=encode(extensions.digest(p_object_path,'sha256'),'hex');
 insert into private.generated_document_orphan_cleanup(company_id,proposal_id,object_path,path_hash,
  sha256,created_by,correlation_id) values(co,p_proposal_id,p_object_path,path_hash,p_sha256,p_actor_id,p_correlation_id)
 on conflict(object_path) do nothing returning * into cleanup;
 inserted:=found;
 if not inserted then
  select * into cleanup from private.generated_document_orphan_cleanup orphan where orphan.object_path=p_object_path;
 end if;
 if inserted then
  insert into public.security_events(event_type,user_id,outcome,reason_code,correlation_id,metadata)
  values('generated_document.orphan_cleanup_required',p_actor_id,'failure','STORAGE_CLEANUP_FAILED',
   p_correlation_id,jsonb_build_object('pathHash',path_hash,'sha256',p_sha256));
 end if;
 return jsonb_build_object('cleanupId',cleanup.id,'recordedAt',cleanup.created_at);
end $$;

create function private.assert_proposal_document_snapshot(p_snapshot jsonb,p_proposal public.proposals)
returns void language plpgsql security definer set search_path='' as $$
declare j jsonb;k public.catalog_item_kind;item_count int:=0;
begin
 if not private.json_keys_exact(p_snapshot,array['templateVersion','generatedAt','proposal','company','client','items','author'])
  or p_snapshot->>'templateVersion'<>'proposal-v1'
  or jsonb_typeof(p_snapshot->'proposal')<>'object'
  or jsonb_typeof(p_snapshot->'company')<>'object'
  or jsonb_typeof(p_snapshot->'client')<>'object'
  or jsonb_typeof(p_snapshot->'items')<>'array'
  or jsonb_typeof(p_snapshot->'author')<>'object'
  or not private.json_keys_exact(p_snapshot->'proposal',array['number','status','issuedOn','total'])
  or not private.json_keys_exact(p_snapshot->'company',array['legalName','tradeName','cnpj','consolidatedAddress','representative','branding'])
  or not private.json_keys_exact(p_snapshot->'company'->'representative',array['name','role'])
  or not private.json_keys_exact(p_snapshot->'company'->'branding',array['letterheadSha256','signatureSha256'])
  or not private.json_keys_exact(p_snapshot->'client',array['legalName','tradeName','cnpj','email','phone','address'])
  or not private.json_keys_exact(p_snapshot->'client'->'address',array['street','number','complement','neighborhood','municipality','state','postalCode'])
  or not private.json_keys_exact(p_snapshot->'author',array['displayName','email'])
  or jsonb_array_length(p_snapshot->'items') not between 1 and 100
  or octet_length(p_snapshot::text)>131072 then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_SNAPSHOT_INVALID';
 end if;
 begin
  if (p_snapshot->>'generatedAt')::timestamptz is null
   or (p_snapshot->'proposal'->>'number')::bigint<>p_proposal.number
   or (p_snapshot->'proposal'->>'status')::public.proposal_status<>p_proposal.status
   or (p_snapshot->'proposal'->>'issuedOn')::date<>p_proposal.issued_on
   or (p_snapshot->'proposal'->>'total')::numeric(14,2)<>p_proposal.total
   or (p_snapshot->'proposal'->>'total') !~ '^[0-9]{1,12}\.[0-9]{2}$' then
   raise exception 'mismatch';
  end if;
 exception when others then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_SNAPSHOT_INVALID';
 end;
 for j in select value from jsonb_array_elements(p_snapshot->'items') loop
  item_count:=item_count+1;
  begin k:=(j->>'itemKind')::public.catalog_item_kind;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_SNAPSHOT_INVALID';end;
  if not private.json_keys_exact(j,array['catalogItemId','itemKind','position','description','months','monthlyAmount','quantity','unitAmount','lineTotal'])
   or not exists(
    select 1 from public.proposal_items item
    where item.company_id=p_proposal.company_id and item.proposal_id=p_proposal.id
     and item.catalog_item_id=(j->>'catalogItemId')::uuid and item.item_kind=k
     and item.position=(j->>'position')::int and item.description_snapshot=j->>'description'
     and item.months is not distinct from (case when j->'months'='null'::jsonb then null else (j->>'months')::int end)
     and (case when item.monthly_amount is null then null else to_char(item.monthly_amount,'FM9999999999990.00') end) is not distinct from j->>'monthlyAmount'
     and (case when item.quantity is null then null else trim_scale(item.quantity)::text end) is not distinct from j->>'quantity'
     and (case when item.unit_amount is null then null else to_char(item.unit_amount,'FM9999999999990.00') end) is not distinct from j->>'unitAmount'
     and to_char(item.line_total,'FM9999999999990.00')=j->>'lineTotal'
   ) then raise exception using errcode='22023',message='AXSYS_PROPOSAL_SNAPSHOT_INVALID';end if;
 end loop;
 if item_count<>(select count(*) from public.proposal_items item where item.company_id=p_proposal.company_id and item.proposal_id=p_proposal.id)
  or not exists(select 1 from public.companies company where company.id=p_proposal.company_id
   and company.legal_name=p_snapshot->'company'->>'legalName' and company.cnpj_normalized=p_snapshot->'company'->>'cnpj')
  or not exists(select 1 from public.clients client where client.company_id=p_proposal.company_id and client.id=p_proposal.client_id
   and client.legal_name=p_snapshot->'client'->>'legalName' and client.cnpj_normalized=p_snapshot->'client'->>'cnpj') then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_SNAPSHOT_INVALID';
 end if;
end $$;

create function private.store_proposal_document(p_actor_id uuid,p_session_id uuid,p_proposal_id uuid,
 p_object_path text,p_content_type text,p_byte_size bigint,p_sha256 text,p_snapshot jsonb,
 p_template_version text,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare co uuid;p public.proposals%rowtype;usage private.company_storage_usage%rowtype;
 file_id uuid;document public.generated_documents%rowtype;created timestamptz:=statement_timestamp();
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_proposal_id is null or p_correlation_id is null or p_content_type<>'application/pdf'
  or p_byte_size is null or p_byte_size not between 1 and 26214400
  or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
  or p_template_version<>'proposal-v1' or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
  or p_object_path is null
  or p_object_path !~ ('^'||co::text||'/generated-documents/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$') then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_DOCUMENT_INPUT_INVALID';
 end if;
 select * into p from public.proposals proposal where proposal.company_id=co and proposal.id=p_proposal_id for update;
 if not found then raise exception using errcode='P0002',message='AXSYS_PROPOSAL_DOCUMENT_NOT_FOUND';end if;
 perform private.assert_proposal_document_snapshot(p_snapshot,p);
 select * into usage from private.company_storage_usage storage where storage.company_id=co for update;
 if not found or usage.used_bytes+usage.reserved_bytes+p_byte_size>usage.quota_bytes then
  raise exception using errcode='53100',message='AXSYS_STORAGE_QUOTA_EXCEEDED';
 end if;
 update private.company_storage_usage storage set used_bytes=storage.used_bytes+p_byte_size,
  version=storage.version+1,updated_at=created where storage.company_id=co;
 insert into public.file_objects(company_id,purpose,bucket,object_path,original_name,detected_mime,
  byte_size,sha256,scan_status,status,created_by,created_at,promoted_at)
 values(co,'generated_document','axsys-private',p_object_path,'proposta-'||p.number::text||'.pdf',
  p_content_type,p_byte_size,p_sha256,'clean','ready',p_actor_id,created,created) returning id into file_id;
 insert into public.generated_documents(company_id,kind,proposal_id,file_object_id,checksum_sha256,
  immutable_snapshot,template_version,created_by,created_at)
 values(co,'proposal',p.id,file_id,p_sha256,p_snapshot,p_template_version,p_actor_id,created) returning * into document;
 insert into public.audit_events(scope,company_id,actor_user_id,action,resource_type,resource_id,
  outcome,correlation_id,metadata) values('tenant',co,p_actor_id,'proposal.document_generated',
  'generated_document',document.id,'success',p_correlation_id,
  jsonb_build_object('version',document.version,'checksumSha256',document.checksum_sha256));
 return jsonb_build_object('documentId',document.id,'version',document.version,
  'checksumSha256',document.checksum_sha256,'templateVersion',document.template_version,
  'createdAt',document.created_at,'scopes',jsonb_build_array('proposals','storage'));
end $$;

create function private.authorize_proposal_document_download(p_actor_id uuid,p_session_id uuid,
 p_document_id uuid,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare co uuid;d public.generated_documents%rowtype;f public.file_objects%rowtype;
 proposal_number bigint;attempt_id uuid;nonce text;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_document_id is null or p_correlation_id is null then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_DOCUMENT_DOWNLOAD_INVALID';end if;
 select document.* into d from public.generated_documents document
 join public.proposals proposal on proposal.company_id=document.company_id and proposal.id=document.proposal_id
 join public.file_objects file on file.company_id=document.company_id and file.id=document.file_object_id
 where document.company_id=co and document.id=p_document_id and document.kind='proposal'
  and file.purpose='generated_document' and file.status='ready' and file.scan_status='clean';
 if not found then raise exception using errcode='P0002',message='AXSYS_PROPOSAL_DOCUMENT_NOT_FOUND';end if;
 select * into f from public.file_objects file where file.company_id=co and file.id=d.file_object_id
  and file.purpose='generated_document' and file.status='ready' and file.scan_status='clean';
 select proposal.number into proposal_number from public.proposals proposal
  where proposal.company_id=co and proposal.id=d.proposal_id;
 select audit.attempt_id,audit.completion_nonce into attempt_id,nonce
 from private.begin_download_audit_core(p_actor_id,p_session_id,co,'generated_document',d.id,p_correlation_id) audit;
 return jsonb_build_object('bucket',f.bucket,'path',f.object_path,'mime',f.detected_mime,
  'byteSize',f.byte_size,'sha256',f.sha256,
  'downloadName','proposta-'||proposal_number::text||'-v'||d.version::text||'.pdf',
  'attemptId',attempt_id,'completionNonce',nonce);
end $$;

revoke all on function private.assert_proposal_document_snapshot(jsonb,public.proposals),
 private.record_generated_document_orphan_cleanup(uuid,uuid,uuid,text,text,uuid),
 private.store_proposal_document(uuid,uuid,uuid,text,text,bigint,text,jsonb,text,uuid),
 private.authorize_proposal_document_download(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,axsys_bff;
grant execute on function private.store_proposal_document(uuid,uuid,uuid,text,text,bigint,text,jsonb,text,uuid),
 private.authorize_proposal_document_download(uuid,uuid,uuid,uuid),
 private.record_generated_document_orphan_cleanup(uuid,uuid,uuid,text,text,uuid) to axsys_bff;
