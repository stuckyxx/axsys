do $$ begin
 if current_user<>'postgres' or to_regclass('public.generated_documents') is null then
  raise exception using errcode='55000',message='AXSYS_ADMINISTRATIVE_RLS_DEPENDENCY_INVALID';
 end if;
end $$;

alter table public.clients force row level security;
alter table public.catalog_items force row level security;
alter table public.proposals force row level security;
alter table public.proposal_items force row level security;
alter table public.contracts force row level security;
alter table public.contract_attachments force row level security;
alter table public.generated_documents force row level security;
revoke all on public.clients,public.catalog_items,public.proposals,public.proposal_items,
 public.contracts,public.contract_attachments,public.generated_documents
 from public,anon,authenticated,service_role,axsys_bff;
grant select on public.clients,public.catalog_items,public.proposals,public.proposal_items,
 public.contracts,public.contract_attachments to authenticated;
grant select(id,company_id,kind,proposal_id,payment_request_id,version,template_version,
 checksum_sha256,created_at) on public.generated_documents to authenticated;

create policy clients_select_administrative on public.clients for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy catalog_items_select_administrative on public.catalog_items for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy proposals_select_administrative on public.proposals for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy proposal_items_select_administrative on public.proposal_items for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy contracts_select_administrative on public.contracts for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy contract_attachments_select_administrative on public.contract_attachments for select to authenticated
 using((select private.has_module(company_id,'administrative'::public.module_key)));
create policy generated_documents_select_proposal_administrative on public.generated_documents
 for select to authenticated using(kind='proposal' and proposal_id is not null
  and (select private.has_module(company_id,'administrative'::public.module_key)));

create function private.json_keys_exact(p_input jsonb,p_keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select p_input is not null and jsonb_typeof(p_input)='object' and octet_length(p_input::text)<=65536
 and (select array_agg(key order by key) from jsonb_object_keys(p_input) key)
   = (select array_agg(key order by key) from unnest(p_keys) key)
$$;

create function private.administrative_audit(p_company_id uuid,p_actor_id uuid,p_action text,
 p_resource_type text,p_resource_id uuid,p_correlation_id uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.audit_events(scope,company_id,actor_user_id,action,resource_type,resource_id,
  outcome,correlation_id,metadata)
 values('tenant',p_company_id,p_actor_id,p_action,p_resource_type,p_resource_id,'success',
  p_correlation_id,'{}'::jsonb)
$$;

create function private.client_json(p public.clients) returns jsonb language sql stable
security definer set search_path='' as $$ select jsonb_build_object(
 'id',p.id,'legalName',p.legal_name,'tradeName',p.trade_name,'cnpj',p.cnpj_normalized,
 'segment',p.segment,'email',p.email,'phone',p.phone,'address',jsonb_build_object(
 'street',p.address_street,'number',p.address_number,'complement',p.address_complement,
 'neighborhood',p.address_neighborhood,'municipality',p.municipality,'state',p.state,
 'postalCode',p.postal_code),'archivedAt',p.archived_at,'version',p.version,
 'createdAt',p.created_at,'updatedAt',p.updated_at) $$;
create function private.catalog_item_json(p public.catalog_items) returns jsonb language sql stable
security definer set search_path='' as $$ select jsonb_build_object(
 'id',p.id,'itemKind',p.item_kind,'segment',p.segment,'name',p.name,
 'description',p.description,'archivedAt',p.archived_at,'version',p.version,
 'createdAt',p.created_at,'updatedAt',p.updated_at) $$;
create function private.contract_json(p public.contracts) returns jsonb language sql stable
security definer set search_path='' as $$ select jsonb_build_object(
 'id',p.id,'clientId',p.client_id,'number',p.number,'object',p.object,
 'startsOn',p.starts_on,'endsOn',p.ends_on,'amount',to_char(p.amount,'FM9999999999990.00'),
 'closedAt',p.closed_at,'closeReason',p.close_reason,'version',p.version,
 'createdAt',p.created_at,'updatedAt',p.updated_at) $$;

create function private.require_target_version(p_found boolean) returns void
language plpgsql immutable set search_path='' as $$ begin
 if not p_found then raise exception using errcode='40001',message='AXSYS_VERSION_CONFLICT';end if;
end $$;

create function private.create_client(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype;co uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_correlation_id is null or not private.json_keys_exact(p_input,array['legalName','tradeName','cnpj','segment','email','phone','addressStreet','addressNumber','addressComplement','addressNeighborhood','municipality','state','postalCode']) then
  raise exception using errcode='22023',message='AXSYS_CLIENT_INPUT_INVALID';end if;
 insert into public.clients(company_id,legal_name,trade_name,cnpj_normalized,segment,email,phone,
  address_street,address_number,address_complement,address_neighborhood,municipality,state,postal_code,
  created_by,updated_by) values(co,btrim(p_input->>'legalName'),nullif(btrim(p_input->>'tradeName'),''),
  regexp_replace(p_input->>'cnpj','[^0-9]','','g'),btrim(p_input->>'segment'),nullif(lower(btrim(p_input->>'email')),''),
  nullif(btrim(p_input->>'phone'),''),nullif(btrim(p_input->>'addressStreet'),''),nullif(btrim(p_input->>'addressNumber'),''),
  nullif(btrim(p_input->>'addressComplement'),''),nullif(btrim(p_input->>'addressNeighborhood'),''),btrim(p_input->>'municipality'),
  upper(btrim(p_input->>'state')),nullif(regexp_replace(p_input->>'postalCode','[^0-9]','','g'),''),p_actor_id,p_actor_id)
 returning * into c;
 perform private.administrative_audit(co,p_actor_id,'client.created','client',c.id,p_correlation_id);
 return jsonb_build_object('record',private.client_json(c),'scopes',jsonb_build_array('clients','proposals','contracts','dashboard'));
end $$;

create function private.update_client(p_actor_id uuid,p_session_id uuid,p_client_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype;co uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['legalName','tradeName','cnpj','segment','email','phone','addressStreet','addressNumber','addressComplement','addressNeighborhood','municipality','state','postalCode']) then
  raise exception using errcode='22023',message='AXSYS_CLIENT_INPUT_INVALID';end if;
 update public.clients set legal_name=btrim(p_input->>'legalName'),trade_name=nullif(btrim(p_input->>'tradeName'),''),
  cnpj_normalized=regexp_replace(p_input->>'cnpj','[^0-9]','','g'),segment=btrim(p_input->>'segment'),
  email=nullif(lower(btrim(p_input->>'email')),''),phone=nullif(btrim(p_input->>'phone'),''),
  address_street=nullif(btrim(p_input->>'addressStreet'),''),address_number=nullif(btrim(p_input->>'addressNumber'),''),
  address_complement=nullif(btrim(p_input->>'addressComplement'),''),address_neighborhood=nullif(btrim(p_input->>'addressNeighborhood'),''),
  municipality=btrim(p_input->>'municipality'),state=upper(btrim(p_input->>'state')),
  postal_code=nullif(regexp_replace(p_input->>'postalCode','[^0-9]','','g'),''),updated_by=p_actor_id
 where id=p_client_id and company_id=co and version=p_expected_version and archived_at is null returning * into c;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'client.updated','client',c.id,p_correlation_id);
 return jsonb_build_object('record',private.client_json(c),'scopes',jsonb_build_array('clients','proposals','contracts','dashboard'));
end $$;

create function private.set_client_archived(p_actor_id uuid,p_session_id uuid,p_client_id uuid,p_expected_version bigint,p_archive boolean,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype;co uuid;act text;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 update public.clients set archived_at=case when p_archive then statement_timestamp() else null end,
  archived_by=case when p_archive then p_actor_id else null end,updated_by=p_actor_id
 where id=p_client_id and company_id=co and version=p_expected_version
  and ((p_archive and archived_at is null) or (not p_archive and archived_at is not null)) returning * into c;
 perform private.require_target_version(found);act:=case when p_archive then 'client.archived' else 'client.restored' end;
 perform private.administrative_audit(co,p_actor_id,act,'client',c.id,p_correlation_id);
 return jsonb_build_object('record',private.client_json(c),'scopes',jsonb_build_array('clients','proposals','contracts','dashboard'));
end $$;
create function private.archive_client(uuid,uuid,uuid,bigint,uuid) returns jsonb language sql security definer set search_path=''
 as $$select private.set_client_archived($1,$2,$3,$4,true,$5)$$;
create function private.restore_client(uuid,uuid,uuid,bigint,uuid) returns jsonb language sql security definer set search_path=''
 as $$select private.set_client_archived($1,$2,$3,$4,false,$5)$$;

create function private.delete_client(p_actor_id uuid,p_session_id uuid,p_client_id uuid,p_expected_version bigint,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;deleted_id uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 delete from public.clients where id=p_client_id and company_id=co and version=p_expected_version
  and archived_at is null returning id into deleted_id;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'client.deleted','client',deleted_id,p_correlation_id);
 return jsonb_build_object('record',null,'scopes',jsonb_build_array('clients','proposals','contracts','dashboard'));
end $$;

create function private.create_catalog_item(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.catalog_items%rowtype;co uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['itemKind','segment','name','description']) then
  raise exception using errcode='22023',message='AXSYS_CATALOG_INPUT_INVALID';end if;
 insert into public.catalog_items(company_id,item_kind,segment,name,description,created_by,updated_by)
 values(co,(p_input->>'itemKind')::public.catalog_item_kind,btrim(p_input->>'segment'),btrim(p_input->>'name'),btrim(p_input->>'description'),p_actor_id,p_actor_id)
 returning * into r;
 perform private.administrative_audit(co,p_actor_id,'catalog.created','catalog_item',r.id,p_correlation_id);
 return jsonb_build_object('record',private.catalog_item_json(r),'scopes',jsonb_build_array('catalog','proposals'));
end $$;
create function private.update_catalog_item(p_actor_id uuid,p_session_id uuid,p_item_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.catalog_items%rowtype;co uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['itemKind','segment','name','description']) then
  raise exception using errcode='22023',message='AXSYS_CATALOG_INPUT_INVALID';end if;
 update public.catalog_items set item_kind=(p_input->>'itemKind')::public.catalog_item_kind,
  segment=btrim(p_input->>'segment'),name=btrim(p_input->>'name'),description=btrim(p_input->>'description'),updated_by=p_actor_id
 where id=p_item_id and company_id=co and version=p_expected_version and archived_at is null returning * into r;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'catalog.updated','catalog_item',r.id,p_correlation_id);
 return jsonb_build_object('record',private.catalog_item_json(r),'scopes',jsonb_build_array('catalog','proposals'));
end $$;
create function private.set_catalog_archived(p_actor_id uuid,p_session_id uuid,p_item_id uuid,p_expected_version bigint,p_archive boolean,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.catalog_items%rowtype;co uuid;act text;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 update public.catalog_items set archived_at=case when p_archive then statement_timestamp() else null end,
  archived_by=case when p_archive then p_actor_id else null end,updated_by=p_actor_id
 where id=p_item_id and company_id=co and version=p_expected_version
  and ((p_archive and archived_at is null) or(not p_archive and archived_at is not null)) returning * into r;
 perform private.require_target_version(found);act:=case when p_archive then 'catalog.archived' else 'catalog.restored' end;
 perform private.administrative_audit(co,p_actor_id,act,'catalog_item',r.id,p_correlation_id);
 return jsonb_build_object('record',private.catalog_item_json(r),'scopes',jsonb_build_array('catalog','proposals'));
end $$;
create function private.archive_catalog_item(uuid,uuid,uuid,bigint,uuid) returns jsonb language sql security definer set search_path=''
 as $$select private.set_catalog_archived($1,$2,$3,$4,true,$5)$$;
create function private.restore_catalog_item(uuid,uuid,uuid,bigint,uuid) returns jsonb language sql security definer set search_path=''
 as $$select private.set_catalog_archived($1,$2,$3,$4,false,$5)$$;
create function private.delete_catalog_item(p_actor_id uuid,p_session_id uuid,p_item_id uuid,p_expected_version bigint,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;deleted_id uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 delete from public.catalog_items where id=p_item_id and company_id=co and version=p_expected_version
 and archived_at is null returning id into deleted_id;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'catalog.deleted','catalog_item',deleted_id,p_correlation_id);
 return jsonb_build_object('record',null,'scopes',jsonb_build_array('catalog','proposals'));
end $$;

create function private.guard_proposal_item_precision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.monthly_amount is not null and scale(new.monthly_amount)>2)
    or (new.quantity is not null and scale(new.quantity)>3)
    or (new.unit_amount is not null and scale(new.unit_amount)>2) then
  raise exception using errcode='22003',message='AXSYS_PROPOSAL_ITEM_PRECISION_INVALID';
 end if;
 return new;
end $$;
create trigger proposal_items_precision_guard before insert or update on public.proposal_items
 for each row execute function private.guard_proposal_item_precision();

create function private.update_draft_proposal(p_actor_id uuid,p_session_id uuid,p_proposal_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.proposals%rowtype;co uuid;client uuid;seg text;issued date;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['clientId','segment','issuedOn']) then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_INPUT_INVALID';end if;
 begin client:=(p_input->>'clientId')::uuid;issued:=(p_input->>'issuedOn')::date;seg:=btrim(p_input->>'segment');
 exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_INPUT_INVALID';end;
 perform 1 from public.clients c where c.company_id=co and c.id=client and c.segment=seg and c.archived_at is null;
 if not found then raise exception using errcode='23503',message='AXSYS_PROPOSAL_CLIENT_NOT_FOUND';end if;
 update public.proposals set client_id=client,segment=seg,issued_on=issued,updated_by=p_actor_id
 where company_id=co and id=p_proposal_id and version=p_expected_version and status='draft' returning * into r;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'proposal.updated','proposal',r.id,p_correlation_id);
 return jsonb_build_object('record',private.proposal_record_json(r),'scopes',jsonb_build_array('proposals','dashboard'));
end $$;

create function private.save_proposal_items(p_actor_id uuid,p_session_id uuid,p_proposal_id uuid,p_expected_version bigint,p_items jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;p public.proposals%rowtype;j jsonb;pos int:=0;k public.catalog_item_kind;cid uuid;
 months_v int;monthly_v numeric(14,2);quantity_v numeric(12,3);unit_v numeric(14,2);expected text[];
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 select * into p from public.proposals where company_id=co and id=p_proposal_id
  and version=p_expected_version and status='draft' for update;
 perform private.require_target_version(found);
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
  or octet_length(p_items::text)>65536 then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
 for j in select value from jsonb_array_elements(p_items) loop
  begin cid:=(j->>'catalogItemId')::uuid;k:=(j->>'kind')::public.catalog_item_kind;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end;
  expected:=case when k='service' then array['catalogItemId','description','kind','monthlyAmount','months']
   else array['catalogItemId','description','kind','quantity','unitAmount'] end;
  if not private.json_keys_exact(j,expected) or char_length(btrim(j->>'description')) not between 2 and 2000 then
   raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  if k='service' then
   if (j->>'monthlyAmount') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception using errcode='22003',message='AXSYS_PROPOSAL_ITEM_PRECISION_INVALID';end if;
   months_v:=(j->>'months')::int;monthly_v:=(j->>'monthlyAmount')::numeric;quantity_v:=null;unit_v:=null;
   if months_v<=0 then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  else
   if (j->>'quantity') !~ '^[0-9]+(\.[0-9]{1,3})?$' or (j->>'unitAmount') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception using errcode='22003',message='AXSYS_PROPOSAL_ITEM_PRECISION_INVALID';end if;
   quantity_v:=(j->>'quantity')::numeric;unit_v:=(j->>'unitAmount')::numeric;months_v:=null;monthly_v:=null;
   if quantity_v<=0 then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  end if;
  perform 1 from public.catalog_items i where i.company_id=co and i.id=cid and i.segment=p.segment and i.item_kind=k and i.archived_at is null;
  if not found then raise exception using errcode='23503',message='AXSYS_PROPOSAL_CATALOG_NOT_FOUND';end if;
 end loop;
 delete from public.proposal_items where company_id=co and proposal_id=p.id;
 for j in select value from jsonb_array_elements(p_items) loop
  pos:=pos+1;cid:=(j->>'catalogItemId')::uuid;k:=(j->>'kind')::public.catalog_item_kind;
  if k='service' then months_v:=(j->>'months')::int;monthly_v:=(j->>'monthlyAmount')::numeric;quantity_v:=null;unit_v:=null;
  else quantity_v:=(j->>'quantity')::numeric;unit_v:=(j->>'unitAmount')::numeric;months_v:=null;monthly_v:=null;end if;
  insert into public.proposal_items(company_id,proposal_id,segment,catalog_item_id,item_kind,position,
   description_snapshot,months,monthly_amount,quantity,unit_amount)
  values(co,p.id,p.segment,cid,k,pos,btrim(j->>'description'),months_v,monthly_v,quantity_v,unit_v);
 end loop;
 perform private.administrative_audit(co,p_actor_id,'proposal.items_saved','proposal',p.id,p_correlation_id);
 return jsonb_build_object('record',private.proposal_with_items_json(p.id),'scopes',jsonb_build_array('proposals','dashboard'));
end $$;

create function private.transition_proposal_status(p_actor_id uuid,p_session_id uuid,p_proposal_id uuid,p_expected_version bigint,p_next_status public.proposal_status,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;r public.proposals%rowtype;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 update public.proposals set status=p_next_status,updated_by=p_actor_id
 where company_id=co and id=p_proposal_id and version=p_expected_version returning * into r;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'proposal.status_changed','proposal',r.id,p_correlation_id);
 return jsonb_build_object('record',private.proposal_record_json(r),'scopes',jsonb_build_array('proposals','dashboard'));
end $$;

create function private.delete_draft_proposal(p_actor_id uuid,p_session_id uuid,p_proposal_id uuid,p_expected_version bigint,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;deleted_id uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 delete from public.proposals p where p.company_id=co and p.id=p_proposal_id and p.version=p_expected_version
  and p.status='draft' and not exists(select 1 from public.generated_documents d where d.company_id=co and d.proposal_id=p.id)
 returning p.id into deleted_id;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'proposal.deleted','proposal',deleted_id,p_correlation_id);
 return jsonb_build_object('record',null,'scopes',jsonb_build_array('proposals','dashboard'));
end $$;

create function private.create_contract(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;r public.contracts%rowtype;cid uuid;start_v date;end_v date;amount_v numeric(14,2);
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['clientId','number','object','startsOn','endsOn','amount'])
  or (p_input->>'amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
  raise exception using errcode='22023',message='AXSYS_CONTRACT_INPUT_INVALID';end if;
 begin cid:=(p_input->>'clientId')::uuid;start_v:=(p_input->>'startsOn')::date;
  end_v:=(p_input->>'endsOn')::date;amount_v:=(p_input->>'amount')::numeric;
 exception when others then raise exception using errcode='22023',message='AXSYS_CONTRACT_INPUT_INVALID';end;
 perform 1 from public.clients c where c.company_id=co and c.id=cid and c.archived_at is null;
 if not found then raise exception using errcode='23503',message='AXSYS_CONTRACT_CLIENT_NOT_FOUND';end if;
 insert into public.contracts(company_id,client_id,number,object,starts_on,ends_on,amount,created_by,updated_by)
 values(co,cid,btrim(p_input->>'number'),btrim(p_input->>'object'),start_v,end_v,amount_v,p_actor_id,p_actor_id)
 returning * into r;
 perform private.administrative_audit(co,p_actor_id,'contract.created','contract',r.id,p_correlation_id);
 return jsonb_build_object('record',private.contract_json(r),'scopes',jsonb_build_array('contracts','notifications','dashboard'));
end $$;
create function private.update_contract(p_actor_id uuid,p_session_id uuid,p_contract_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;r public.contracts%rowtype;cid uuid;start_v date;end_v date;amount_v numeric(14,2);
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if not private.json_keys_exact(p_input,array['clientId','number','object','startsOn','endsOn','amount'])
  or (p_input->>'amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
  raise exception using errcode='22023',message='AXSYS_CONTRACT_INPUT_INVALID';end if;
 begin cid:=(p_input->>'clientId')::uuid;start_v:=(p_input->>'startsOn')::date;
  end_v:=(p_input->>'endsOn')::date;amount_v:=(p_input->>'amount')::numeric;
 exception when others then raise exception using errcode='22023',message='AXSYS_CONTRACT_INPUT_INVALID';end;
 perform 1 from public.clients c where c.company_id=co and c.id=cid and c.archived_at is null;
 if not found then raise exception using errcode='23503',message='AXSYS_CONTRACT_CLIENT_NOT_FOUND';end if;
 update public.contracts set client_id=cid,number=btrim(p_input->>'number'),object=btrim(p_input->>'object'),
  starts_on=start_v,ends_on=end_v,amount=amount_v,updated_by=p_actor_id
 where company_id=co and id=p_contract_id and version=p_expected_version and closed_at is null returning * into r;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'contract.updated','contract',r.id,p_correlation_id);
 return jsonb_build_object('record',private.contract_json(r),'scopes',jsonb_build_array('contracts','notifications','dashboard','payments'));
end $$;
create function private.close_contract(p_actor_id uuid,p_session_id uuid,p_contract_id uuid,p_expected_version bigint,p_reason text,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;r public.contracts%rowtype;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if char_length(btrim(p_reason)) not between 3 and 1000 then raise exception using errcode='22023',message='AXSYS_CONTRACT_REASON_INVALID';end if;
 update public.contracts set closed_at=statement_timestamp(),closed_by=p_actor_id,close_reason=btrim(p_reason),updated_by=p_actor_id
 where company_id=co and id=p_contract_id and version=p_expected_version and closed_at is null returning * into r;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'contract.closed','contract',r.id,p_correlation_id);
 return jsonb_build_object('record',private.contract_json(r),'scopes',jsonb_build_array('contracts','notifications','dashboard','payments'));
end $$;
create function private.delete_contract(p_actor_id uuid,p_session_id uuid,p_contract_id uuid,p_expected_version bigint,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;deleted_id uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 delete from public.contracts c where c.company_id=co and c.id=p_contract_id and c.version=p_expected_version
  and c.closed_at is null and not exists(select 1 from public.contract_attachments a where a.company_id=co and a.contract_id=c.id)
 returning c.id into deleted_id;
 perform private.require_target_version(found);
 perform private.administrative_audit(co,p_actor_id,'contract.deleted','contract',deleted_id,p_correlation_id);
 return jsonb_build_object('record',null,'scopes',jsonb_build_array('contracts','notifications','dashboard','payments'));
end $$;

create function private.version_contract_attachment(p_actor_id uuid,p_session_id uuid,p_contract_id uuid,p_file_id uuid,p_attachment_group_id uuid,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid;gid uuid:=coalesce(p_attachment_group_id,gen_random_uuid());next_v int:=1;
 a public.contract_attachments%rowtype;f public.file_objects%rowtype;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 perform 1 from public.contracts c where c.company_id=co and c.id=p_contract_id and c.closed_at is null for update;
 if not found then raise exception using errcode='23503',message='AXSYS_CONTRACT_OPEN_NOT_FOUND';end if;
 select * into f from public.file_objects file where file.company_id=co and file.id=p_file_id
  and file.purpose='contract_attachment' and file.status='ready' and file.scan_status='clean' for update;
 if not found or not exists(select 1 from public.file_upload_intents i where i.company_id=co
  and i.file_object_id=f.id and i.target_resource_id=p_contract_id and i.purpose='contract_attachment' and i.status='ready') then
  raise exception using errcode='23514',message='AXSYS_CONTRACT_ATTACHMENT_FILE_INVALID';end if;
 select current.version+1 into next_v from public.contract_attachments current
  where current.company_id=co and current.contract_id=p_contract_id and current.attachment_group_id=gid
   and current.superseded_at is null for update;
 if found then
  update public.contract_attachments set superseded_at=statement_timestamp(),superseded_by=p_actor_id
   where company_id=co and contract_id=p_contract_id and attachment_group_id=gid and superseded_at is null;
 else next_v:=1;end if;
 insert into public.contract_attachments(company_id,contract_id,file_object_id,attachment_group_id,version,created_by)
 values(co,p_contract_id,p_file_id,gid,next_v,p_actor_id) returning * into a;
 perform private.administrative_audit(co,p_actor_id,'contract.attachment_versioned','contract_attachment',a.id,p_correlation_id);
 return jsonb_build_object('record',jsonb_build_object('id',a.id,'contractId',a.contract_id,
  'fileObjectId',a.file_object_id,'attachmentGroupId',a.attachment_group_id,'version',a.version,
  'originalName',f.original_name,'mime',f.detected_mime,'byteSize',f.byte_size,
  'isCurrent',true,'createdAt',a.created_at),'scopes',jsonb_build_array('contracts','storage'));
end $$;

alter function private.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid)
 rename to create_proposal_validated_core;
revoke all on function private.create_proposal_validated_core(uuid,uuid,uuid,text,date,jsonb,uuid)
 from public,anon,authenticated,service_role,axsys_bff;
create or replace function private.create_proposal_validated_core(p_actor_id uuid,p_session_id uuid,
 p_client_id uuid,p_segment text,p_issued_on date,p_items jsonb,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare co uuid;n bigint;p public.proposals%rowtype;j jsonb;pos int:=0;k public.catalog_item_kind;
 cid uuid;description_v text;months_v int;monthly_v numeric(14,2);quantity_v numeric(12,3);
 unit_v numeric(14,2);keys_v text[];expected text[];
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_client_id is null or p_issued_on is null or p_correlation_id is null
  or p_segment is null or char_length(btrim(p_segment)) not between 2 and 80
  or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
  or octet_length(p_items::text)>65536 then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
 perform 1 from public.clients c where c.id=p_client_id and c.company_id=co
  and c.segment=btrim(p_segment) and c.archived_at is null for share;
 if not found then raise exception using errcode='P0001',message='AXSYS_PROPOSAL_CLIENT_NOT_FOUND';end if;
 for j in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(j)<>'object' then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  begin cid:=(j->>'catalogItemId')::uuid;k:=(j->>'kind')::public.catalog_item_kind;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end;
  description_v:=btrim(j->>'description');select array_agg(key order by key) into keys_v from jsonb_object_keys(j) key;
  expected:=case when k='service' then array['catalogItemId','description','kind','monthlyAmount','months']
   else array['catalogItemId','description','kind','quantity','unitAmount'] end;
  select array_agg(value order by value) into expected from unnest(expected) value;
  if keys_v is distinct from expected or char_length(description_v) not between 2 and 2000 then
   raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  begin
   if k='service' then months_v:=(j->>'months')::int;monthly_v:=(j->>'monthlyAmount')::numeric;quantity_v:=null;unit_v:=null;
    if months_v<=0 or monthly_v<0 then raise exception 'bad';end if;
   else quantity_v:=(j->>'quantity')::numeric;unit_v:=(j->>'unitAmount')::numeric;months_v:=null;monthly_v:=null;
    if quantity_v<=0 or unit_v<0 then raise exception 'bad';end if;
   end if;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end;
  perform 1 from public.catalog_items i where i.id=cid and i.company_id=co
   and i.segment=btrim(p_segment) and i.item_kind=k and i.archived_at is null for share;
  if not found then raise exception using errcode='P0001',message='AXSYS_PROPOSAL_CATALOG_NOT_FOUND';end if;
 end loop;
 n:=private.next_proposal_number(co);
 insert into public.proposals(company_id,client_id,segment,number,issued_on,created_by,updated_by)
 values(co,p_client_id,btrim(p_segment),n,p_issued_on,p_actor_id,p_actor_id) returning * into p;
 for j in select value from jsonb_array_elements(p_items) loop
  pos:=pos+1;cid:=(j->>'catalogItemId')::uuid;k:=(j->>'kind')::public.catalog_item_kind;
  if k='service' then months_v:=(j->>'months')::int;monthly_v:=(j->>'monthlyAmount')::numeric;quantity_v:=null;unit_v:=null;
  else quantity_v:=(j->>'quantity')::numeric;unit_v:=(j->>'unitAmount')::numeric;months_v:=null;monthly_v:=null;end if;
  insert into public.proposal_items(company_id,proposal_id,segment,catalog_item_id,item_kind,position,
   description_snapshot,months,monthly_amount,quantity,unit_amount)
  values(co,p.id,btrim(p_segment),cid,k,pos,btrim(j->>'description'),months_v,monthly_v,quantity_v,unit_v);
 end loop;
 perform private.administrative_audit(co,p_actor_id,'proposal.created','proposal',p.id,p_correlation_id);
 return jsonb_build_object('record',private.proposal_with_items_json(p.id),'scopes',jsonb_build_array('proposals','dashboard'));
end $$;
create function private.create_proposal(p_actor_id uuid,p_session_id uuid,p_client_id uuid,p_segment text,
 p_issued_on date,p_items jsonb,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j jsonb;k text;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
    or octet_length(p_items::text)>65536 then
  raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';
 end if;
 for j in select value from jsonb_array_elements(p_items) loop
  k:=j->>'kind';
  if (k='service' and ((j->>'monthlyAmount') is null or (j->>'monthlyAmount') !~ '^[0-9]+(\.[0-9]{1,2})?$'))
   or (k='product' and ((j->>'quantity') is null or (j->>'quantity') !~ '^[0-9]+(\.[0-9]{1,3})?$'
      or (j->>'unitAmount') is null or (j->>'unitAmount') !~ '^[0-9]+(\.[0-9]{1,2})?$')) then
   raise exception using errcode='22003',message='AXSYS_PROPOSAL_ITEM_PRECISION_INVALID';
  end if;
 end loop;
 return private.create_proposal_validated_core(p_actor_id,p_session_id,p_client_id,p_segment,
  p_issued_on,p_items,p_correlation_id);
end $$;

revoke all on function private.json_keys_exact(jsonb,text[]),
 private.administrative_audit(uuid,uuid,text,text,uuid,uuid),
 private.client_json(public.clients),private.catalog_item_json(public.catalog_items),
 private.contract_json(public.contracts),private.require_target_version(boolean),
 private.set_client_archived(uuid,uuid,uuid,bigint,boolean,uuid),
 private.set_catalog_archived(uuid,uuid,uuid,bigint,boolean,uuid),
 private.guard_proposal_item_precision(),
 private.create_client(uuid,uuid,jsonb,uuid),
 private.update_client(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.archive_client(uuid,uuid,uuid,bigint,uuid),
 private.restore_client(uuid,uuid,uuid,bigint,uuid),
 private.delete_client(uuid,uuid,uuid,bigint,uuid),
 private.create_catalog_item(uuid,uuid,jsonb,uuid),
 private.update_catalog_item(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.archive_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.restore_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.delete_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid),
 private.update_draft_proposal(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.save_proposal_items(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.transition_proposal_status(uuid,uuid,uuid,bigint,public.proposal_status,uuid),
 private.delete_draft_proposal(uuid,uuid,uuid,bigint,uuid),
 private.create_contract(uuid,uuid,jsonb,uuid),
 private.update_contract(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.close_contract(uuid,uuid,uuid,bigint,text,uuid),
 private.delete_contract(uuid,uuid,uuid,bigint,uuid),
 private.version_contract_attachment(uuid,uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,axsys_bff;

grant execute on function private.create_client(uuid,uuid,jsonb,uuid),
 private.update_client(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.archive_client(uuid,uuid,uuid,bigint,uuid),
 private.restore_client(uuid,uuid,uuid,bigint,uuid),
 private.delete_client(uuid,uuid,uuid,bigint,uuid),
 private.create_catalog_item(uuid,uuid,jsonb,uuid),
 private.update_catalog_item(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.archive_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.restore_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.delete_catalog_item(uuid,uuid,uuid,bigint,uuid),
 private.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid),
 private.update_draft_proposal(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.save_proposal_items(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.transition_proposal_status(uuid,uuid,uuid,bigint,public.proposal_status,uuid),
 private.delete_draft_proposal(uuid,uuid,uuid,bigint,uuid),
 private.create_contract(uuid,uuid,jsonb,uuid),
 private.update_contract(uuid,uuid,uuid,bigint,jsonb,uuid),
 private.close_contract(uuid,uuid,uuid,bigint,text,uuid),
 private.delete_contract(uuid,uuid,uuid,bigint,uuid),
 private.version_contract_attachment(uuid,uuid,uuid,uuid,uuid,uuid)
 to axsys_bff;
grant usage on type public.proposal_status to axsys_bff;
