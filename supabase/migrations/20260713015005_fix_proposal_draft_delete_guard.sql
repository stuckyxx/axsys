create or replace function private.guard_proposal_item_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_status public.proposal_status;
begin
 select proposal.status into v_status from public.proposals proposal
 where proposal.company_id=coalesce(new.company_id,old.company_id)
   and proposal.id=coalesce(new.proposal_id,old.proposal_id) for share;

 -- During an ON DELETE CASCADE, PostgreSQL has already made the parent row
 -- unavailable to the child trigger. Direct item deletes still see the parent
 -- and remain restricted to drafts; an absent parent is legal only for DELETE.
 if tg_op='DELETE' and v_status is null then
  return old;
 end if;
 if v_status is distinct from 'draft'::public.proposal_status then
  raise exception using errcode='23514',message='AXSYS_PROPOSAL_ITEMS_IMMUTABLE';
 end if;
 return coalesce(new,old);
end $$;

revoke execute on function private.guard_proposal_item_mutation()
 from public,anon,authenticated,service_role,axsys_bff;
