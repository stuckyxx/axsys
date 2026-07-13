create function private.write_proposal_total_mismatch_security_event(
 p_actor_id uuid,
 p_session_id uuid,
 p_proposal_id uuid,
 p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare co uuid;
begin
 co:=private.assert_administrative_actor(p_actor_id,p_session_id);
 if p_correlation_id is null then
  raise exception using errcode='22023',message='AXSYS_CORRELATION_ID_REQUIRED';
 end if;
 if p_proposal_id is not null and not exists(
  select 1 from public.proposals proposal
  where proposal.company_id=co and proposal.id=p_proposal_id
 ) then
  raise exception using errcode='P0001',message='AXSYS_PROPOSAL_NOT_FOUND';
 end if;
 insert into public.security_events(
  event_type,user_id,outcome,reason_code,correlation_id,metadata
 ) values(
  'administrative.proposal.total_mismatch',p_actor_id,'failure',
  'INTERNAL_TOTAL_MISMATCH',p_correlation_id,
  case when p_proposal_id is null then '{}'::jsonb
       else jsonb_build_object('resourceId',p_proposal_id) end
 );
end $$;

revoke all on function private.write_proposal_total_mismatch_security_event(
 uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role,axsys_bff;
grant execute on function private.write_proposal_total_mismatch_security_event(
 uuid,uuid,uuid,uuid
) to axsys_bff;
