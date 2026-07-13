do $$
begin
  if current_user<>'postgres' then
    raise exception using errcode='42501',message='AXSYS_COMPANY_SETTINGS_RPCS_OWNER_INVALID';
  end if;
  if to_regclass('public.company_settings') is null
     or to_regclass('public.company_settings_drafts') is null
     or to_regprocedure('private.assert_auth_session(uuid,uuid)') is null
     or to_regprocedure('private.bank_account_masked_summary(public.company_bank_accounts)') is null then
    raise exception using errcode='55000',message='AXSYS_COMPANY_SETTINGS_RPCS_DEPENDENCY_INVALID';
  end if;
end
$$;

insert into private.rate_limit_policies(
  bucket,attempt_limit,window_seconds,block_seconds,clear_on_success
) values ('company-settings-draft',30,60,60,false)
on conflict(bucket) do update set attempt_limit=excluded.attempt_limit,
  window_seconds=excluded.window_seconds,block_seconds=excluded.block_seconds,
  clear_on_success=excluded.clear_on_success;

create function private.assert_own_company_settings_actor(
  p_actor_user_id uuid,p_session_id uuid,p_require_write boolean
) returns table(company_id uuid,can_edit boolean)
language plpgsql security definer set search_path='' as $$
declare v_company_id uuid;v_can_edit boolean;
begin
  if p_actor_user_id is null or p_session_id is null or p_require_write is null then
    raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_INPUT_INVALID';
  end if;
  if not private.assert_auth_session(p_session_id,p_actor_user_id) then
    raise exception using errcode='23514',message='AXSYS_COMPANY_SETTINGS_SESSION_INVALID';
  end if;
  select membership.company_id,
    (membership.role='company_admin'::public.membership_role or exists(
      select 1 from public.member_modules module
      where module.company_id=membership.company_id and module.membership_id=membership.id
        and module.module='administrative'::public.module_key
    ))
  into v_company_id,v_can_edit
  from public.company_memberships membership
  join public.companies company on company.id=membership.company_id
  join public.profiles profile on profile.user_id=membership.user_id
  join private.auth_session_controls control
    on control.user_id=membership.user_id and control.session_id=p_session_id
  where membership.user_id=p_actor_user_id and membership.status='active'
    and company.status='active' and profile.is_active and not profile.must_change_password
    and control.state='active'::private.auth_session_state
    and control.audit_scope='tenant'::public.audit_scope
    and control.audit_company_id=membership.company_id
    and (
      membership.role='company_admin'::public.membership_role
      or exists(select 1 from public.member_modules module
        where module.company_id=membership.company_id and module.membership_id=membership.id
          and module.module in ('administrative','financial'))
    );
  if not found then
    raise exception using errcode='42501',message='AXSYS_COMPANY_SETTINGS_READ_REQUIRED';
  end if;
  if p_require_write and not v_can_edit then
    raise exception using errcode='42501',message='AXSYS_COMPANY_SETTINGS_WRITE_REQUIRED';
  end if;
  perform pg_catalog.set_config('app.actor_id',p_actor_user_id::text,true);
  company_id:=v_company_id;can_edit:=v_can_edit;return next;
end;
$$;

create function private.company_settings_safe_snapshot(
  p_company_id uuid,p_can_edit boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'companyId',settings.company_id,
    'representativeName',settings.representative_name,
    'representativeRole',settings.representative_role,
    'maskedRepresentativeDocument',case when settings.representative_document_last4 is null
      then null else '••••'||settings.representative_document_last4 end,
    'taxRate',settings.tax_rate,
    'addressStreet',settings.address_street,'addressNumber',settings.address_number,
    'addressComplement',settings.address_complement,
    'addressNeighborhood',settings.address_neighborhood,
    'addressCity',settings.address_city,'addressState',settings.address_state,
    'addressPostalCode',settings.address_postal_code,
    'consolidatedAddress',settings.consolidated_address,
    'letterheadFileId',settings.letterhead_file_id,
    'signatureFileId',settings.signature_file_id,
    'version',settings.version,'updatedAt',settings.updated_at,
    'canEdit',p_can_edit,
    'banks',coalesce((select pg_catalog.jsonb_agg(
      private.bank_account_masked_summary(bank)
      order by bank.is_default desc,bank.created_at,bank.id)
      from public.company_bank_accounts bank where bank.company_id=p_company_id
        and bank.status='active'::public.bank_account_status),'[]'::jsonb)
  ) into v_result from public.company_settings settings
  where settings.company_id=p_company_id;
  return v_result;
end;
$$;

create function private.validate_company_settings_draft_payload(p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_key text; v_action text;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object'
     or pg_catalog.octet_length(p_payload::text)>16384 then return false; end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_payload) loop
    if v_key<>all(array[
      'representativeName','representativeRole','representativeDocumentAction',
      'representativeDocumentCiphertext','representativeDocumentIv',
      'representativeDocumentTag','representativeDocumentKeyVersion',
      'representativeDocumentLast4','taxRate','addressStreet','addressNumber',
      'addressComplement','addressNeighborhood','addressCity','addressState',
      'addressPostalCode','letterheadFileId','signatureFileId'
    ]) then return false; end if;
  end loop;
  for v_key in select unnest(array[
    'representativeName','representativeRole','representativeDocumentAction',
    'representativeDocumentCiphertext','representativeDocumentIv',
    'representativeDocumentTag','representativeDocumentLast4','addressStreet',
    'addressNumber','addressComplement','addressNeighborhood','addressCity',
    'addressState','addressPostalCode','letterheadFileId','signatureFileId'
  ]) loop
    if p_payload ? v_key and p_payload->v_key<>'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload->v_key)<>'string' then return false; end if;
  end loop;
  for v_key in select unnest(array['representativeDocumentKeyVersion','taxRate']) loop
    if p_payload ? v_key and p_payload->v_key<>'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload->v_key)<>'number' then return false; end if;
  end loop;
  if pg_catalog.char_length(coalesce(p_payload->>'representativeName',''))>160
     or pg_catalog.char_length(coalesce(p_payload->>'representativeRole',''))>160
     or pg_catalog.char_length(coalesce(p_payload->>'addressStreet',''))>160
     or pg_catalog.char_length(coalesce(p_payload->>'addressNumber',''))>40
     or pg_catalog.char_length(coalesce(p_payload->>'addressComplement',''))>160
     or pg_catalog.char_length(coalesce(p_payload->>'addressNeighborhood',''))>120
     or pg_catalog.char_length(coalesce(p_payload->>'addressCity',''))>120
     or (p_payload->>'addressState' is not null and p_payload->>'addressState'!~'^[A-Z]{2}$')
     or (p_payload->>'addressPostalCode' is not null and p_payload->>'addressPostalCode'!~'^[0-9]{8}$')
     or (p_payload->>'letterheadFileId' is not null and p_payload->>'letterheadFileId'
       !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or (p_payload->>'signatureFileId' is not null and p_payload->>'signatureFileId'
       !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or (p_payload->>'taxRate' is not null and (
       p_payload->>'taxRate'!~'^[0-9]{1,3}(\.[0-9]{1,2})?$'
       or (p_payload->>'taxRate')::numeric not between 0 and 100
     )) then return false; end if;
  v_action:=coalesce(p_payload->>'representativeDocumentAction','preserve');
  if v_action not in ('preserve','replace','clear') then return false; end if;
  if v_action='replace' and not (
    private.is_canonical_base64(p_payload->>'representativeDocumentCiphertext',null)
    and private.is_canonical_base64(p_payload->>'representativeDocumentIv',12)
    and private.is_canonical_base64(p_payload->>'representativeDocumentTag',16)
    and (p_payload->>'representativeDocumentKeyVersion')~'^[1-9][0-9]*$'
    and (p_payload->>'representativeDocumentLast4')~'^[0-9]{4}$'
  ) then return false; end if;
  if v_action in ('preserve','clear') and exists(
    select 1 from unnest(array[
      'representativeDocumentCiphertext','representativeDocumentIv',
      'representativeDocumentTag','representativeDocumentKeyVersion',
      'representativeDocumentLast4'
    ]) key where p_payload ? key and p_payload->key<>'null'::jsonb
  ) then return false; end if;
  return true;
end;
$$;

create function private.internal_get_own_company_settings(
  p_actor_user_id uuid,p_session_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access record; v_result jsonb;
begin
  select * into v_access from private.assert_own_company_settings_actor(
    p_actor_user_id,p_session_id,false);
  v_result:=private.company_settings_safe_snapshot(v_access.company_id,v_access.can_edit);
  if v_result is null then raise exception using errcode='P0001',message='AXSYS_COMPANY_SETTINGS_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create function private.internal_update_own_company_settings(
  p_actor_user_id uuid,p_session_id uuid,
  p_representative_name text,p_representative_role text,
  p_representative_document_action text,
  p_representative_document_ciphertext text,p_representative_document_iv text,
  p_representative_document_tag text,p_representative_document_key_version integer,
  p_representative_document_last4 text,p_tax_rate numeric,
  p_address_street text,p_address_number text,p_address_complement text,
  p_address_neighborhood text,p_address_city text,p_address_state text,
  p_address_postal_code text,p_letterhead_file_id uuid,p_signature_file_id uuid,
  p_expected_version bigint,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access record; v_current public.company_settings%rowtype;
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_doc_cipher text; v_doc_iv text; v_doc_tag text; v_doc_key integer; v_doc_last4 text;
begin
  select * into v_access from private.assert_own_company_settings_actor(
    p_actor_user_id,p_session_id,true);
  if p_expected_version is null or p_correlation_id is null
     or p_representative_document_action not in ('preserve','replace','clear')
     or p_tax_rate is null or p_tax_rate not between 0 and 100
     or (p_representative_name is not null and
       pg_catalog.char_length(pg_catalog.btrim(p_representative_name)) not between 2 and 160)
     or (p_representative_role is not null and
       pg_catalog.char_length(pg_catalog.btrim(p_representative_role)) not between 2 and 160)
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_address_street),''))>160
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_address_number),''))>40
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_address_complement),''))>160
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_address_neighborhood),''))>120
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_address_city),''))>120 then
    raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_INPUT_INVALID';
  end if;
  select * into v_current from public.company_settings settings
   where settings.company_id=v_access.company_id for update;
  if not found then raise exception using errcode='P0001',message='AXSYS_COMPANY_SETTINGS_NOT_FOUND'; end if;
  if v_current.version<>p_expected_version then
    raise exception using errcode='40001',message='AXSYS_COMPANY_SETTINGS_VERSION_CONFLICT';
  end if;
  if p_representative_document_action='preserve' then
    if p_representative_document_ciphertext is not null or p_representative_document_iv is not null
       or p_representative_document_tag is not null or p_representative_document_key_version is not null
       or p_representative_document_last4 is not null then
      raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_DOCUMENT_INVALID';
    end if;
    v_doc_cipher:=v_current.representative_document_ciphertext;
    v_doc_iv:=v_current.representative_document_iv;v_doc_tag:=v_current.representative_document_tag;
    v_doc_key:=v_current.representative_document_key_version;
    v_doc_last4:=v_current.representative_document_last4;
  elsif p_representative_document_action='clear' then
    if p_representative_document_ciphertext is not null or p_representative_document_iv is not null
       or p_representative_document_tag is not null or p_representative_document_key_version is not null
       or p_representative_document_last4 is not null then
      raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_DOCUMENT_INVALID';
    end if;
  else
    if not private.is_canonical_base64(p_representative_document_ciphertext,null)
       or not private.is_canonical_base64(p_representative_document_iv,12)
       or not private.is_canonical_base64(p_representative_document_tag,16)
       or p_representative_document_key_version is null
       or p_representative_document_last4!~'^[0-9]{4}$' then
      raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_DOCUMENT_INVALID';
    end if;
    v_doc_cipher:=p_representative_document_ciphertext;v_doc_iv:=p_representative_document_iv;
    v_doc_tag:=p_representative_document_tag;v_doc_key:=p_representative_document_key_version;
    v_doc_last4:=p_representative_document_last4;
  end if;
  if p_letterhead_file_id is not null then
    perform 1 from public.file_objects file_object where file_object.id=p_letterhead_file_id
      and file_object.company_id=v_access.company_id and file_object.owner_user_id is null
      and file_object.purpose='company_letterhead' and file_object.status='ready'
      and file_object.scan_status='clean' and file_object.retirement_claim_id is null
      and file_object.storage_deleted_at is null for update;
    if not found then raise exception using errcode='P0001',message='AXSYS_INVALID_LETTERHEAD_FILE'; end if;
  end if;
  if p_signature_file_id is not null then
    perform 1 from public.file_objects file_object where file_object.id=p_signature_file_id
      and file_object.company_id=v_access.company_id and file_object.owner_user_id is null
      and file_object.purpose='company_signature' and file_object.status='ready'
      and file_object.scan_status='clean' and file_object.retirement_claim_id is null
      and file_object.storage_deleted_at is null for update;
    if not found then raise exception using errcode='P0001',message='AXSYS_INVALID_SIGNATURE_FILE'; end if;
  end if;
  if v_current.letterhead_file_id is not null
     and v_current.letterhead_file_id is distinct from p_letterhead_file_id then
    update public.file_objects set status='archived',archived_at=v_now,
      retirement_not_before=v_now+interval '30 days'
    where id=v_current.letterhead_file_id and status='ready' and retirement_claim_id is null;
  end if;
  if v_current.signature_file_id is not null
     and v_current.signature_file_id is distinct from p_signature_file_id then
    update public.file_objects set status='archived',archived_at=v_now,
      retirement_not_before=v_now+interval '30 days'
    where id=v_current.signature_file_id and status='ready' and retirement_claim_id is null;
  end if;
  update public.company_settings settings set
    representative_name=nullif(pg_catalog.btrim(p_representative_name),''),
    representative_role=nullif(pg_catalog.btrim(p_representative_role),''),
    representative_document_ciphertext=v_doc_cipher,representative_document_iv=v_doc_iv,
    representative_document_tag=v_doc_tag,representative_document_key_version=v_doc_key,
    representative_document_last4=v_doc_last4,tax_rate=p_tax_rate,
    address_street=nullif(pg_catalog.btrim(p_address_street),''),
    address_number=nullif(pg_catalog.btrim(p_address_number),''),
    address_complement=nullif(pg_catalog.btrim(p_address_complement),''),
    address_neighborhood=nullif(pg_catalog.btrim(p_address_neighborhood),''),
    address_city=nullif(pg_catalog.btrim(p_address_city),''),
    address_state=nullif(pg_catalog.upper(pg_catalog.btrim(p_address_state)),''),
    address_postal_code=nullif(pg_catalog.regexp_replace(coalesce(p_address_postal_code,''),'[^0-9]','','g'),''),
    letterhead_file_id=p_letterhead_file_id,signature_file_id=p_signature_file_id,
    version=settings.version+1,updated_by=p_actor_user_id,updated_at=v_now
  where settings.company_id=v_access.company_id and settings.version=p_expected_version;
  if not found then raise exception using errcode='40001',message='AXSYS_COMPANY_SETTINGS_VERSION_CONFLICT'; end if;
  delete from public.company_settings_drafts draft
   where draft.company_id=v_access.company_id and draft.user_id=p_actor_user_id;
  insert into public.audit_events(
    scope,company_id,actor_user_id,action,resource_type,resource_id,outcome,
    correlation_id,metadata
  ) values ('tenant',v_access.company_id,p_actor_user_id,'company.settings_updated',
    'company',v_access.company_id,'success',p_correlation_id,
    pg_catalog.jsonb_build_object(
      'brandingChanged',v_current.letterhead_file_id is distinct from p_letterhead_file_id
        or v_current.signature_file_id is distinct from p_signature_file_id,
      'representativeDocumentChanged',p_representative_document_action<>'preserve'));
  return private.company_settings_safe_snapshot(v_access.company_id,true);
exception when check_violation then
  raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_INPUT_INVALID';
end;
$$;

create function private.internal_get_own_company_settings_draft(
  p_actor_user_id uuid,p_session_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access record;v_result jsonb;
begin
  select * into v_access from private.assert_own_company_settings_actor(
    p_actor_user_id,p_session_id,true);
  select pg_catalog.jsonb_build_object('payload',draft.payload,'baseVersion',draft.base_version,
    'version',draft.version,'updatedAt',draft.updated_at) into v_result
  from public.company_settings_drafts draft where draft.company_id=v_access.company_id
    and draft.user_id=p_actor_user_id;
  return v_result;
end;
$$;

create function private.internal_upsert_own_company_settings_draft(
  p_actor_user_id uuid,p_session_id uuid,p_payload jsonb,p_base_version bigint,
  p_expected_draft_version bigint,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access record;v_draft public.company_settings_drafts%rowtype;
begin
  select * into v_access from private.assert_own_company_settings_actor(
    p_actor_user_id,p_session_id,true);
  if p_base_version is null or p_base_version<1 or p_correlation_id is null
     or not private.validate_company_settings_draft_payload(p_payload) then
    raise exception using errcode='22023',message='AXSYS_COMPANY_SETTINGS_DRAFT_INVALID';
  end if;
  if p_expected_draft_version is null then
    insert into public.company_settings_drafts(company_id,user_id,payload,base_version)
    values(v_access.company_id,p_actor_user_id,p_payload,p_base_version)
    on conflict do nothing returning * into v_draft;
  else
    update public.company_settings_drafts draft set payload=p_payload,
      base_version=p_base_version,version=draft.version+1,updated_at=pg_catalog.clock_timestamp()
    where draft.company_id=v_access.company_id and draft.user_id=p_actor_user_id
      and draft.version=p_expected_draft_version returning * into v_draft;
  end if;
  if not found then raise exception using errcode='40001',message='AXSYS_DRAFT_VERSION_CONFLICT'; end if;
  return pg_catalog.jsonb_build_object('payload',v_draft.payload,
    'baseVersion',v_draft.base_version,'version',v_draft.version,'updatedAt',v_draft.updated_at);
end;
$$;

create function private.internal_delete_own_company_settings_draft(
  p_actor_user_id uuid,p_session_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_access record;v_deleted boolean;
begin
  select * into v_access from private.assert_own_company_settings_actor(
    p_actor_user_id,p_session_id,true);
  delete from public.company_settings_drafts draft where draft.company_id=v_access.company_id
    and draft.user_id=p_actor_user_id returning true into v_deleted;
  return coalesce(v_deleted,false);
end;
$$;

revoke execute on function private.assert_own_company_settings_actor(uuid,uuid,boolean),
  private.company_settings_safe_snapshot(uuid,boolean),
  private.validate_company_settings_draft_payload(jsonb),
  private.internal_get_own_company_settings(uuid,uuid),
  private.internal_update_own_company_settings(
    uuid,uuid,text,text,text,text,text,text,integer,text,numeric,text,text,text,text,
    text,text,text,uuid,uuid,bigint,uuid),
  private.internal_get_own_company_settings_draft(uuid,uuid),
  private.internal_upsert_own_company_settings_draft(uuid,uuid,jsonb,bigint,bigint,uuid),
  private.internal_delete_own_company_settings_draft(uuid,uuid)
from public,anon,authenticated,service_role,axsys_bff;
grant execute on function private.internal_get_own_company_settings(uuid,uuid),
  private.internal_update_own_company_settings(
    uuid,uuid,text,text,text,text,text,text,integer,text,numeric,text,text,text,text,
    text,text,text,uuid,uuid,bigint,uuid),
  private.internal_get_own_company_settings_draft(uuid,uuid),
  private.internal_upsert_own_company_settings_draft(uuid,uuid,jsonb,bigint,bigint,uuid),
  private.internal_delete_own_company_settings_draft(uuid,uuid)
to axsys_bff;
