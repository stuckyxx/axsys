do $$ begin
 if current_user<>'postgres' or to_regclass('public.clients') is null
 or to_regprocedure('private.assert_auth_session(uuid,uuid)') is null then
  raise exception using errcode='55000',message='AXSYS_ADMINISTRATIVE_PROPOSALS_DEPENDENCY_INVALID';
 end if;
end $$;

create table private.proposal_number_counters(
 company_id uuid primary key references public.companies(id) on delete cascade,
 last_number bigint not null check(last_number>0));
alter table private.proposal_number_counters enable row level security;
alter table private.proposal_number_counters force row level security;
revoke all on private.proposal_number_counters from public,anon,authenticated,service_role,axsys_bff;

create table public.proposals(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 client_id uuid not null,segment text not null check(char_length(btrim(segment)) between 2 and 80),
 number bigint not null check(number>0),issued_on date not null,
 status public.proposal_status not null default 'draft',
 total numeric(14,2) not null default 0 check(total>=0),sent_at timestamptz,
 version bigint not null default 1 check(version>0),
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint proposals_company_number_key unique(company_id,number),
 constraint proposals_company_id_id_key unique(company_id,id),
 constraint proposals_company_id_id_segment_key unique(company_id,id,segment),
 constraint proposals_client_segment_fk foreign key(company_id,client_id,segment)
  references public.clients(company_id,id,segment) on delete restrict,
 constraint proposals_sent_state_check check(
  (status='draft' and sent_at is null) or(status<>'draft' and sent_at is not null)));

create table public.proposal_items(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete restrict,
 proposal_id uuid not null,segment text not null,catalog_item_id uuid not null,
 item_kind public.catalog_item_kind not null,position integer not null check(position>0),
 description_snapshot text not null check(char_length(btrim(description_snapshot)) between 2 and 2000),
 months integer,monthly_amount numeric(14,2),quantity numeric(12,3),unit_amount numeric(14,2),
 line_total numeric(14,2) generated always as(round(case item_kind when 'service' then months::numeric*monthly_amount when 'product' then quantity*unit_amount end,2)) stored,
 created_at timestamptz not null default now(),
 constraint proposal_items_company_id_id_key unique(company_id,id),
 constraint proposal_items_position_key unique(proposal_id,position),
 constraint proposal_items_proposal_segment_fk foreign key(company_id,proposal_id,segment)
  references public.proposals(company_id,id,segment) on delete cascade,
 constraint proposal_items_catalog_segment_kind_fk foreign key(company_id,catalog_item_id,segment,item_kind)
  references public.catalog_items(company_id,id,segment,item_kind) on delete restrict,
 constraint proposal_items_kind_values_check check(
  (item_kind='service' and months is not null and months>0 and monthly_amount is not null and monthly_amount>=0 and quantity is null and unit_amount is null)
  or(item_kind='product' and quantity is not null and quantity>0 and unit_amount is not null and unit_amount>=0 and months is null and monthly_amount is null)));

create index proposals_company_status_idx on public.proposals(company_id,status,issued_on desc,id desc);
create index proposals_client_idx on public.proposals(company_id,client_id,issued_on desc);
create index proposal_items_proposal_idx on public.proposal_items(company_id,proposal_id,position);
create index proposal_items_catalog_idx on public.proposal_items(company_id,catalog_item_id);
create trigger proposals_bump_version before update on public.proposals
for each row execute function private.bump_version_and_updated_at();
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
revoke all on public.proposals,public.proposal_items from public,anon,authenticated,service_role,axsys_bff;

create function private.next_proposal_number(p_company_id uuid) returns bigint
language sql security definer set search_path='' as $$
 insert into private.proposal_number_counters(company_id,last_number) values(p_company_id,1)
 on conflict(company_id) do update set last_number=private.proposal_number_counters.last_number+1
 returning last_number
$$;
create function private.refresh_proposal_total() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.proposals set total=(select coalesce(sum(item.line_total),0)::numeric(14,2)
 from public.proposal_items item where item.company_id=coalesce(new.company_id,old.company_id)
 and item.proposal_id=coalesce(new.proposal_id,old.proposal_id))
 where company_id=coalesce(new.company_id,old.company_id) and id=coalesce(new.proposal_id,old.proposal_id);
 return coalesce(new,old);
end $$;
create trigger proposal_items_refresh_total after insert or update or delete on public.proposal_items
for each row execute function private.refresh_proposal_total();

create function private.assert_administrative_actor(p_actor_id uuid,p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_company_id uuid;
begin
 if p_actor_id is null or p_session_id is null then raise exception using errcode='22023',message='AXSYS_ADMINISTRATIVE_INPUT_INVALID';end if;
 if not private.assert_auth_session(p_session_id,p_actor_id) then raise exception using errcode='23514',message='AXSYS_ADMINISTRATIVE_SESSION_INVALID';end if;
 select membership.company_id into v_company_id from public.company_memberships membership
 join public.companies company on company.id=membership.company_id and company.status='active'
 join public.profiles profile on profile.user_id=membership.user_id and profile.is_active and not profile.must_change_password
 join private.auth_session_controls control on control.session_id=p_session_id and control.user_id=p_actor_id
 where membership.user_id=p_actor_id and membership.status='active'
 and control.state='active'::private.auth_session_state and control.audit_scope='tenant'
 and control.audit_company_id=membership.company_id
 and exists(select 1 from public.member_modules module where module.company_id=membership.company_id
  and module.membership_id=membership.id and module.module='administrative');
 if not found then raise exception using errcode='42501',message='AXSYS_ADMINISTRATIVE_MODULE_REQUIRED';end if;
 perform pg_catalog.set_config('app.actor_id',p_actor_id::text,true);return v_company_id;
end $$;

create function private.proposal_record_json(p_proposal public.proposals) returns jsonb
language sql stable security definer set search_path='' as $$ select pg_catalog.jsonb_build_object(
 'id',p_proposal.id,'clientId',p_proposal.client_id,'segment',p_proposal.segment,
 'number',p_proposal.number,'issuedOn',p_proposal.issued_on,'status',p_proposal.status,
 'total',to_char(p_proposal.total,'FM9999999999990.00'),'sentAt',p_proposal.sent_at,
 'version',p_proposal.version,'createdAt',p_proposal.created_at,'updatedAt',p_proposal.updated_at) $$;
create function private.proposal_item_json(p_item public.proposal_items) returns jsonb
language sql stable security definer set search_path='' as $$ select pg_catalog.jsonb_build_object(
 'id',p_item.id,'catalogItemId',p_item.catalog_item_id,'itemKind',p_item.item_kind,
 'position',p_item.position,'description',p_item.description_snapshot,'months',p_item.months,
 'monthlyAmount',case when p_item.monthly_amount is null then null else to_char(p_item.monthly_amount,'FM9999999999990.00') end,
 'quantity',case when p_item.quantity is null then null else trim_scale(p_item.quantity)::text end,
 'unitAmount',case when p_item.unit_amount is null then null else to_char(p_item.unit_amount,'FM9999999999990.00') end,
 'lineTotal',to_char(p_item.line_total,'FM9999999999990.00')) $$;
create function private.proposal_with_items_json(p_proposal_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('proposal',private.proposal_record_json(proposal),
 'items',coalesce((select jsonb_agg(private.proposal_item_json(item) order by item.position)
 from public.proposal_items item where item.company_id=proposal.company_id and item.proposal_id=proposal.id),'[]'))
 from public.proposals proposal where proposal.id=p_proposal_id
$$;

create function private.create_proposal(
 p_actor_id uuid,p_session_id uuid,p_client_id uuid,p_segment text,p_issued_on date,
 p_items jsonb,p_correlation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company_id uuid;v_number bigint;v_proposal public.proposals%rowtype;
 v_item jsonb;v_position integer:=0;v_catalog public.catalog_items%rowtype;
 v_kind public.catalog_item_kind;v_catalog_id uuid;v_description text;v_months integer;
 v_monthly numeric(14,2);v_quantity numeric(12,3);v_unit numeric(14,2);
 v_keys text[];v_expected text[];
begin
 v_company_id:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_client_id is null or p_issued_on is null or p_correlation_id is null
 or p_segment is null or char_length(btrim(p_segment)) not between 2 and 80
 or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
 or octet_length(p_items::text)>65536 then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
 perform 1 from public.clients client where client.id=p_client_id and client.company_id=v_company_id
 and client.segment=btrim(p_segment) and client.archived_at is null for share;
 if not found then raise exception using errcode='P0001',message='AXSYS_PROPOSAL_CLIENT_NOT_FOUND';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item)<>'object' then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  begin v_catalog_id:=(v_item->>'catalogItemId')::uuid;v_kind:=(v_item->>'kind')::public.catalog_item_kind;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end;
  v_description:=btrim(v_item->>'description');
  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_item) key;
  if v_kind='service' then v_expected:=array['catalogItemId','description','kind','monthlyAmount','months'];
  else v_expected:=array['catalogItemId','description','kind','quantity','unitAmount'];end if;
  select array_agg(value order by value) into v_expected from unnest(v_expected) value;
  if v_keys is distinct from v_expected or char_length(v_description) not between 2 and 2000 then
   raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end if;
  begin
   if v_kind='service' then v_months:=(v_item->>'months')::integer;v_monthly:=(v_item->>'monthlyAmount')::numeric;v_quantity:=null;v_unit:=null;
    if v_months<=0 or v_monthly<0 then raise exception 'bad';end if;
   else v_quantity:=(v_item->>'quantity')::numeric;v_unit:=(v_item->>'unitAmount')::numeric;v_months:=null;v_monthly:=null;
    if v_quantity<=0 or v_unit<0 then raise exception 'bad';end if;
   end if;
  exception when others then raise exception using errcode='22023',message='AXSYS_PROPOSAL_ITEMS_INVALID';end;
  select * into v_catalog from public.catalog_items item where item.id=v_catalog_id and item.company_id=v_company_id
   and item.segment=btrim(p_segment) and item.item_kind=v_kind and item.archived_at is null for share;
  if not found then raise exception using errcode='P0001',message='AXSYS_PROPOSAL_CATALOG_NOT_FOUND';end if;
 end loop;
 v_number:=private.next_proposal_number(v_company_id);
 insert into public.proposals(company_id,client_id,segment,number,issued_on,created_by,updated_by)
 values(v_company_id,p_client_id,btrim(p_segment),v_number,p_issued_on,p_actor_id,p_actor_id) returning * into v_proposal;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_position:=v_position+1;v_catalog_id:=(v_item->>'catalogItemId')::uuid;v_kind:=(v_item->>'kind')::public.catalog_item_kind;
  if v_kind='service' then v_months:=(v_item->>'months')::integer;v_monthly:=(v_item->>'monthlyAmount')::numeric;v_quantity:=null;v_unit:=null;
  else v_quantity:=(v_item->>'quantity')::numeric;v_unit:=(v_item->>'unitAmount')::numeric;v_months:=null;v_monthly:=null;end if;
  insert into public.proposal_items(company_id,proposal_id,segment,catalog_item_id,item_kind,position,description_snapshot,months,monthly_amount,quantity,unit_amount)
  values(v_company_id,v_proposal.id,btrim(p_segment),v_catalog_id,v_kind,v_position,btrim(v_item->>'description'),v_months,v_monthly,v_quantity,v_unit);
 end loop;
 insert into public.audit_events(scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,correlation_id,metadata)
 values('tenant',v_company_id,p_actor_id,'proposal.created','proposal',v_proposal.id,'success',p_correlation_id,
  jsonb_build_object('itemCount',jsonb_array_length(p_items)));
 return jsonb_build_object('record',private.proposal_with_items_json(v_proposal.id),'scopes',jsonb_build_array('proposals','dashboard'));
end $$;

revoke execute on function private.next_proposal_number(uuid),private.refresh_proposal_total(),
 private.assert_administrative_actor(uuid,uuid),private.proposal_record_json(public.proposals),
 private.proposal_item_json(public.proposal_items),private.proposal_with_items_json(uuid),
 private.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid)
from public,anon,authenticated,service_role,axsys_bff;
grant execute on function private.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid) to axsys_bff;
