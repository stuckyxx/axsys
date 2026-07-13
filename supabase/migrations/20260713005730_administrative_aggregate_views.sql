do $$
begin
  if current_user <> 'postgres'
    or to_regclass('public.proposals') is null
    or to_regclass('public.contracts') is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_ADMINISTRATIVE_AGGREGATE_DEPENDENCY_INVALID';
  end if;
end
$$;

create view public.proposal_client_aggregates
with (security_invoker = true)
as
select proposal.company_id,
       proposal.client_id,
       count(*)::bigint as record_count,
       coalesce(sum(proposal.total), 0)::numeric(14,2) as total
from public.proposals proposal
group by proposal.company_id, proposal.client_id;

create view public.contract_client_aggregates
with (security_invoker = true)
as
select contract.company_id,
       contract.client_id,
       count(*)::bigint as record_count,
       coalesce(sum(contract.amount), 0)::numeric(14,2) as total
from public.contracts contract
group by contract.company_id, contract.client_id;

revoke all on public.proposal_client_aggregates,
  public.contract_client_aggregates
from public, anon, authenticated, service_role, axsys_bff;

grant select on public.proposal_client_aggregates,
  public.contract_client_aggregates
to authenticated;

comment on view public.proposal_client_aggregates is
  'RLS-invoker aggregate used by bounded administrative client detail reads.';
comment on view public.contract_client_aggregates is
  'RLS-invoker aggregate used by bounded administrative client detail reads.';
