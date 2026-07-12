do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_BANK_ACCOUNT_MIGRATION_OWNER_INVALID';
  end if;

  if to_regclass('public.company_bank_accounts') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure(
       'private.assert_platform_provisioning_actor(uuid,uuid)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_BANK_ACCOUNT_DEPENDENCY_INVALID';
  end if;
end
$$;

create function private.bank_account_masked_summary(
  p_bank public.company_bank_accounts
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_bank.id,
    'companyId', p_bank.company_id,
    'bankCode', p_bank.bank_code,
    'bankName', p_bank.bank_name,
    'maskedBranch', pg_catalog.repeat(
      '•',
      greatest(0, 4 - pg_catalog.char_length(p_bank.branch_last4))
    ) || p_bank.branch_last4,
    'maskedAccount', pg_catalog.repeat(
      '•',
      greatest(0, 4 - pg_catalog.char_length(p_bank.account_last4))
    ) || p_bank.account_last4,
    'accountType', p_bank.account_type::text,
    'holderName', p_bank.holder_name,
    'maskedHolderDocument', case
      when p_bank.holder_document_last4 is null then null
      else '••••' || p_bank.holder_document_last4
    end,
    'status', p_bank.status::text,
    'isDefault', p_bank.is_default,
    'version', p_bank.version,
    'createdAt', p_bank.created_at,
    'updatedAt', p_bank.updated_at
  )
$$;

create function private.assert_recent_platform_bank_actor(
  p_actor_user_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );

  if not exists (
    select 1
    from private.auth_session_controls control
    where control.session_id = p_session_id
      and control.user_id = p_actor_user_id
      and control.state = 'active'::private.auth_session_state
      and control.audit_scope = 'platform'::public.audit_scope
      and control.audit_company_id is null
      and control.revoked_at is null
      and control.auth_created_at
        > pg_catalog.clock_timestamp() - interval '10 minutes'
  ) then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_RECENT_AUTH_REQUIRED';
  end if;
end;
$$;

create function private.internal_upsert_bank_account(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_bank_account_id uuid,
  p_bank_code text,
  p_bank_name text,
  p_branch_ciphertext text,
  p_branch_iv text,
  p_branch_tag text,
  p_branch_key_version integer,
  p_branch_last4 text,
  p_account_ciphertext text,
  p_account_iv text,
  p_account_tag text,
  p_account_key_version integer,
  p_account_last4 text,
  p_account_type public.bank_account_type,
  p_holder_name text,
  p_holder_document_ciphertext text,
  p_holder_document_iv text,
  p_holder_document_tag text,
  p_holder_document_key_version integer,
  p_holder_document_last4 text,
  p_make_default boolean,
  p_expected_version bigint,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.company_bank_accounts%rowtype;
  v_result public.company_bank_accounts%rowtype;
  v_make_default boolean;
  v_is_create boolean;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_company_id is null
     or p_bank_account_id is null
     or p_bank_code is null
     or p_bank_name is null
     or p_branch_ciphertext is null
     or p_branch_iv is null
     or p_branch_tag is null
     or p_branch_key_version is null
     or p_branch_last4 is null
     or p_account_ciphertext is null
     or p_account_iv is null
     or p_account_tag is null
     or p_account_key_version is null
     or p_account_last4 is null
     or p_account_type is null
     or p_holder_name is null
     or p_make_default is null
     or p_correlation_id is null
     or p_branch_key_version <> p_account_key_version
     or (
       p_holder_document_key_version is not null
       and p_holder_document_key_version <> p_branch_key_version
     )
     or (
       (p_holder_document_ciphertext is null)::integer
       + (p_holder_document_iv is null)::integer
       + (p_holder_document_tag is null)::integer
       + (p_holder_document_key_version is null)::integer
       + (p_holder_document_last4 is null)::integer
     ) not in (0, 5) then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_BANK_ACCOUNT_INPUT_INVALID';
  end if;

  perform private.assert_recent_platform_bank_actor(
    p_actor_user_id,
    p_session_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text, 2108)
  );

  perform 1
  from public.companies company
  where company.id = p_company_id
    and company.status = 'active'::public.company_status
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_COMPANY_NOT_FOUND';
  end if;

  select bank.*
  into v_existing
  from public.company_bank_accounts bank
  where bank.id = p_bank_account_id
    and bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
  for update;
  v_is_create := not found;

  if v_is_create and exists (
    select 1
    from public.company_bank_accounts bank
    where bank.id = p_bank_account_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_BANK_ACCOUNT_NOT_FOUND';
  end if;

  if v_is_create and p_expected_version is not null then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_BANK_ACCOUNT_NOT_FOUND';
  elsif not v_is_create and p_expected_version is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_BANK_ACCOUNT_VERSION_REQUIRED';
  elsif not v_is_create
        and v_existing.version is distinct from p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
  end if;

  select not exists (
    select 1
    from public.company_bank_accounts bank
    where bank.company_id = p_company_id
      and bank.status = 'active'::public.bank_account_status
  ) into v_make_default;
  v_make_default := v_make_default or p_make_default;

  if not v_is_create and v_existing.is_default then
    v_make_default := true;
  end if;

  if v_make_default then
    update public.company_bank_accounts bank
    set is_default = false,
        version = bank.version + 1,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = p_actor_user_id
    where bank.company_id = p_company_id
      and bank.status = 'active'::public.bank_account_status
      and bank.is_default
      and bank.id <> p_bank_account_id;
  end if;

  if v_is_create then
    insert into public.company_bank_accounts (
      id,company_id,bank_code,bank_name,
      branch_ciphertext,branch_iv,branch_tag,branch_key_version,branch_last4,
      account_ciphertext,account_iv,account_tag,account_key_version,account_last4,
      account_type,holder_name,
      holder_document_ciphertext,holder_document_iv,holder_document_tag,
      holder_document_key_version,holder_document_last4,
      is_default,created_by,updated_by
    ) values (
      p_bank_account_id,p_company_id,p_bank_code,pg_catalog.btrim(p_bank_name),
      p_branch_ciphertext,p_branch_iv,p_branch_tag,p_branch_key_version,
      p_branch_last4,p_account_ciphertext,p_account_iv,p_account_tag,
      p_account_key_version,p_account_last4,p_account_type,
      pg_catalog.btrim(p_holder_name),p_holder_document_ciphertext,
      p_holder_document_iv,p_holder_document_tag,p_holder_document_key_version,
      p_holder_document_last4,v_make_default,p_actor_user_id,p_actor_user_id
    ) returning * into v_result;
  else
    update public.company_bank_accounts bank
    set bank_code = p_bank_code,
        bank_name = pg_catalog.btrim(p_bank_name),
        branch_ciphertext = p_branch_ciphertext,
        branch_iv = p_branch_iv,
        branch_tag = p_branch_tag,
        branch_key_version = p_branch_key_version,
        branch_last4 = p_branch_last4,
        account_ciphertext = p_account_ciphertext,
        account_iv = p_account_iv,
        account_tag = p_account_tag,
        account_key_version = p_account_key_version,
        account_last4 = p_account_last4,
        account_type = p_account_type,
        holder_name = pg_catalog.btrim(p_holder_name),
        holder_document_ciphertext = p_holder_document_ciphertext,
        holder_document_iv = p_holder_document_iv,
        holder_document_tag = p_holder_document_tag,
        holder_document_key_version = p_holder_document_key_version,
        holder_document_last4 = p_holder_document_last4,
        is_default = v_make_default,
        version = bank.version + 1,
        updated_by = p_actor_user_id,
        updated_at = pg_catalog.clock_timestamp()
    where bank.id = p_bank_account_id
      and bank.company_id = p_company_id
      and bank.status = 'active'::public.bank_account_status
      and bank.version = p_expected_version
    returning * into v_result;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
    end if;
  end if;

  insert into public.audit_events (
    scope,company_id,actor_user_id,action,resource_type,resource_id,
    outcome,correlation_id,metadata
  ) values (
    'platform',null,p_actor_user_id,
    case when v_is_create then 'bank_account.created'
      else 'bank_account.updated' end,
    'bank_account',p_bank_account_id,'success',p_correlation_id,
    pg_catalog.jsonb_build_object(
      'bankCode',p_bank_code,
      'accountLast4',p_account_last4,
      'madeDefault',v_make_default,
      'keyVersion',p_account_key_version
    )
  );

  return private.bank_account_masked_summary(v_result);
exception when check_violation then
  raise exception using
    errcode = '22023',
    message = 'AXSYS_BANK_ACCOUNT_INPUT_INVALID';
end;
$$;

create function private.internal_set_default_bank_account(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_bank_account_id uuid,
  p_expected_version bigint,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.company_bank_accounts%rowtype;
  v_result public.company_bank_accounts%rowtype;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_company_id is null
     or p_bank_account_id is null
     or p_expected_version is null
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'AXSYS_BANK_ACCOUNT_INPUT_INVALID';
  end if;

  perform private.assert_recent_platform_bank_actor(
    p_actor_user_id,
    p_session_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text, 2108)
  );
  perform 1 from public.companies company
  where company.id = p_company_id
    and company.status = 'active'::public.company_status
  for update;
  if not found then
    raise exception using errcode='P0001', message='AXSYS_COMPANY_NOT_FOUND';
  end if;

  select bank.* into v_target
  from public.company_bank_accounts bank
  where bank.id = p_bank_account_id
    and bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
  for update;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'AXSYS_BANK_ACCOUNT_NOT_FOUND';
  end if;
  if v_target.version is distinct from p_expected_version then
    raise exception using
      errcode = '40001', message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
  end if;

  update public.company_bank_accounts bank
  set is_default = false,
      version = bank.version + 1,
      updated_by = p_actor_user_id,
      updated_at = pg_catalog.clock_timestamp()
  where bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
    and bank.is_default
    and bank.id <> p_bank_account_id;

  update public.company_bank_accounts bank
  set is_default = true,
      version = bank.version + 1,
      updated_by = p_actor_user_id,
      updated_at = pg_catalog.clock_timestamp()
  where bank.id = p_bank_account_id
    and bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
    and bank.version = p_expected_version
  returning * into v_result;
  if not found then
    raise exception using
      errcode = '40001', message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
  end if;

  insert into public.audit_events (
    scope,company_id,actor_user_id,action,resource_type,resource_id,
    outcome,correlation_id,metadata
  ) values (
    'platform',null,p_actor_user_id,'bank_account.default_changed',
    'bank_account',p_bank_account_id,'success',p_correlation_id,
    pg_catalog.jsonb_build_object(
      'bankCode',v_result.bank_code,
      'accountLast4',v_result.account_last4,
      'madeDefault',true,
      'keyVersion',v_result.account_key_version
    )
  );

  return private.bank_account_masked_summary(v_result);
end;
$$;

create function private.internal_archive_bank_account(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_bank_account_id uuid,
  p_replacement_default_id uuid,
  p_request_reason_code text,
  p_expected_version bigint,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.company_bank_accounts%rowtype;
  v_replacement public.company_bank_accounts%rowtype;
  v_result public.company_bank_accounts%rowtype;
  v_other_active_count bigint;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_company_id is null
     or p_bank_account_id is null
     or p_expected_version is null
     or p_correlation_id is null then
    raise exception using
      errcode = '22023', message = 'AXSYS_BANK_ACCOUNT_INPUT_INVALID';
  end if;
  if p_request_reason_code is null or p_request_reason_code not in (
    'BANK_ARCHIVE_ACCOUNT_CLOSED','BANK_ARCHIVE_BANK_CHANGED',
    'BANK_ARCHIVE_DATA_CORRECTION','BANK_ARCHIVE_SECURITY_RESPONSE'
  ) then
    raise exception using
      errcode='22023',message='AXSYS_BANK_ARCHIVE_REASON_INVALID';
  end if;

  perform private.assert_recent_platform_bank_actor(
    p_actor_user_id,
    p_session_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text, 2108)
  );
  perform 1 from public.companies company
  where company.id = p_company_id
    and company.status = 'active'::public.company_status
  for update;
  if not found then
    raise exception using errcode='P0001', message='AXSYS_COMPANY_NOT_FOUND';
  end if;

  select bank.* into v_target
  from public.company_bank_accounts bank
  where bank.id = p_bank_account_id
    and bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
  for update;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'AXSYS_BANK_ACCOUNT_NOT_FOUND';
  end if;
  if v_target.version is distinct from p_expected_version then
    raise exception using
      errcode = '40001', message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
  end if;

  select pg_catalog.count(*) into v_other_active_count
  from public.company_bank_accounts bank
  where bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
    and bank.id <> p_bank_account_id;

  if v_target.is_default and v_other_active_count > 0 then
    if p_replacement_default_id is null then
      raise exception using
        errcode = '22023', message = 'AXSYS_REPLACEMENT_DEFAULT_REQUIRED';
    end if;
    select bank.* into v_replacement
    from public.company_bank_accounts bank
    where bank.id = p_replacement_default_id
      and bank.id <> p_bank_account_id
      and bank.company_id = p_company_id
      and bank.status = 'active'::public.bank_account_status
    for update;
    if not found then
      raise exception using
        errcode = 'P0001', message = 'AXSYS_BANK_ACCOUNT_NOT_FOUND';
    end if;

  elsif p_replacement_default_id is not null then
    raise exception using
      errcode = '22023', message = 'AXSYS_REPLACEMENT_DEFAULT_INVALID';
  end if;

  update public.company_bank_accounts bank
  set status = 'archived'::public.bank_account_status,
      is_default = false,
      version = bank.version + 1,
      updated_by = p_actor_user_id,
      updated_at = pg_catalog.clock_timestamp(),
      archived_at = pg_catalog.clock_timestamp()
  where bank.id = p_bank_account_id
    and bank.company_id = p_company_id
    and bank.status = 'active'::public.bank_account_status
    and bank.version = p_expected_version
  returning * into v_result;
  if not found then
    raise exception using
      errcode = '40001', message = 'AXSYS_BANK_ACCOUNT_VERSION_CONFLICT';
  end if;

  if v_replacement.id is not null then
    update public.company_bank_accounts bank
    set is_default = true,
        version = bank.version + 1,
        updated_by = p_actor_user_id,
        updated_at = pg_catalog.clock_timestamp()
    where bank.id = v_replacement.id
      and bank.company_id = p_company_id
      and bank.status = 'active'::public.bank_account_status;
  end if;

  insert into public.audit_events (
    scope,company_id,actor_user_id,action,resource_type,resource_id,
    outcome,reason_code,correlation_id,metadata
  ) values (
    'platform',null,p_actor_user_id,'bank_account.archived',
    'bank_account',p_bank_account_id,'success',p_request_reason_code,p_correlation_id,
    pg_catalog.jsonb_build_object(
      'bankCode',v_result.bank_code,
      'accountLast4',v_result.account_last4,
      'madeDefault',false,
      'keyVersion',v_result.account_key_version
    )
  );

  return private.bank_account_masked_summary(v_result);
end;
$$;

create function private.internal_list_company_bank_accounts(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_company_id is null then
    raise exception using
      errcode = '22023', message = 'AXSYS_BANK_ACCOUNT_INPUT_INVALID';
  end if;
  perform private.assert_platform_provisioning_actor(
    p_actor_user_id,
    p_session_id
  );
  if not exists (
    select 1 from public.companies company where company.id = p_company_id
  ) then
    raise exception using errcode='P0001', message='AXSYS_COMPANY_NOT_FOUND';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      private.bank_account_masked_summary(bank)
      order by bank.is_default desc, bank.created_at, bank.id
    ),
    '[]'::jsonb
  ) into v_result
  from public.company_bank_accounts bank
  where bank.company_id = p_company_id;

  return v_result;
end;
$$;

revoke execute on function private.bank_account_masked_summary(
  public.company_bank_accounts
) from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.assert_recent_platform_bank_actor(uuid,uuid)
from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.internal_upsert_bank_account(
  uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,
  integer,text,public.bank_account_type,text,text,text,text,integer,text,
  boolean,bigint,uuid
) from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.internal_set_default_bank_account(
  uuid,uuid,uuid,uuid,bigint,uuid
) from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.internal_archive_bank_account(
  uuid,uuid,uuid,uuid,uuid,text,bigint,uuid
) from public,anon,authenticated,service_role,axsys_bff;
revoke execute on function private.internal_list_company_bank_accounts(
  uuid,uuid,uuid
) from public,anon,authenticated,service_role,axsys_bff;

grant usage on type public.bank_account_type to axsys_bff;
grant execute on function private.internal_upsert_bank_account(
  uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,
  integer,text,public.bank_account_type,text,text,text,text,integer,text,
  boolean,bigint,uuid
) to axsys_bff;
grant execute on function private.internal_set_default_bank_account(
  uuid,uuid,uuid,uuid,bigint,uuid
) to axsys_bff;
grant execute on function private.internal_archive_bank_account(
  uuid,uuid,uuid,uuid,uuid,text,bigint,uuid
) to axsys_bff;
grant execute on function private.internal_list_company_bank_accounts(
  uuid,uuid,uuid
) to axsys_bff;
