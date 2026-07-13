do $$
begin
  if current_user <> 'postgres'
     or to_regclass('public.contracts') is null
     or to_regclass('public.clients') is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_CONTRACT_SEARCH_DEPENDENCY_INVALID';
  end if;
end
$$;

create view public.contract_search_rows
with (security_invoker = true)
as
select
  contract.id,
  contract.company_id,
  contract.client_id,
  contract.number,
  contract.object,
  contract.starts_on,
  contract.ends_on,
  contract.amount,
  contract.closed_at,
  contract.close_reason,
  contract.version,
  contract.created_at,
  contract.updated_at,
  client.legal_name as client_legal_name,
  client.trade_name as client_trade_name,
  lower(contract.number) as number_prefix,
  lower(contract.object) as object_prefix,
  lower(client.legal_name) as client_legal_name_prefix,
  lower(client.trade_name) as client_trade_name_prefix
from public.contracts contract
join public.clients client
  on client.company_id = contract.company_id
 and client.id = contract.client_id;

revoke all on table public.contract_search_rows
from public, anon, authenticated, service_role;
grant select on table public.contract_search_rows to authenticated;
