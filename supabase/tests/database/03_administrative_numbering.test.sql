begin;
\ir helpers/fixtures.inc
select no_plan();

create function test_helpers.activate_admin_session(
  p_user_id uuid,p_session_id uuid,p_correlation_id uuid
) returns void language plpgsql as $$
begin
  perform test_helpers.create_auth_session(p_session_id,p_user_id,clock_timestamp()-interval '1 minute');
  perform private.register_auth_session(p_session_id,p_user_id,false);
  perform private.write_authenticated_audit_event(
    p_user_id,p_session_id,'auth.login','session',null,'success',null,
    p_correlation_id,null,null,'{"rememberMe":false}'::jsonb);
end $$;

select test_helpers.create_company_user(
  '2b000000-0000-4000-8000-000000000001','proposal-a@example.test',
  '3b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000001',
  'member',array['administrative']::public.module_key[]);
select test_helpers.create_company_user(
  '2b000000-0000-4000-8000-000000000002','proposal-b@example.test',
  '3b000000-0000-4000-8000-000000000002','4b000000-0000-4000-8000-000000000002',
  'member',array['administrative']::public.module_key[]);
select test_helpers.activate_admin_session(
  '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001');
select test_helpers.activate_admin_session(
  '2b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000002',
  '8b000000-0000-4000-8000-000000000002');

insert into public.clients(
  id,company_id,legal_name,cnpj_normalized,segment,municipality,state,created_by,updated_by
) values
  ('5b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001',
   'Cliente A','10000000000001','Governo','Fortaleza','CE',
   '2b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001'),
  ('5b000000-0000-4000-8000-000000000002','3b000000-0000-4000-8000-000000000002',
   'Cliente B','10000000000002','Governo','Recife','PE',
   '2b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000002');
insert into public.catalog_items(
  id,company_id,item_kind,segment,name,description,created_by,updated_by
) values
  ('6b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001',
   'service','Governo','Assessoria','Assessoria mensal',
   '2b000000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001'),
  ('6b000000-0000-4000-8000-000000000002','3b000000-0000-4000-8000-000000000002',
   'service','Governo','Consultoria','Consultoria mensal',
   '2b000000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000002');

create temporary table numbering_results(label text primary key,result jsonb not null);
grant select,insert on numbering_results to axsys_bff;
grant axsys_bff to postgres;
set local role axsys_bff;
insert into numbering_results values
('a1',private.create_proposal(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 '5b000000-0000-4000-8000-000000000001','Governo','2026-07-13',
 '[{"catalogItemId":"6b000000-0000-4000-8000-000000000001","kind":"service","description":"Assessoria mensal","months":3,"monthlyAmount":"1250.40"}]',
 '8b000000-0000-4000-8000-000000000011')),
('a2',private.create_proposal(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 '5b000000-0000-4000-8000-000000000001','Governo','2026-07-13',
 '[{"catalogItemId":"6b000000-0000-4000-8000-000000000001","kind":"service","description":"Assessoria mensal","months":3,"monthlyAmount":"1250.40"}]',
 '8b000000-0000-4000-8000-000000000012')),
('b1',private.create_proposal(
 '2b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000002',
 '5b000000-0000-4000-8000-000000000002','Governo','2026-07-13',
 '[{"catalogItemId":"6b000000-0000-4000-8000-000000000002","kind":"service","description":"Consultoria mensal","months":1,"monthlyAmount":"100.00"}]',
 '8b000000-0000-4000-8000-000000000013'));
reset role;

select results_eq(
 $$select label,(result#>>'{record,proposal,number}')::bigint
   from numbering_results order by label$$,
 $$values ('a1',1::bigint),('a2',2::bigint),('b1',1::bigint)$$,
 'proposal numbering is gap-free and tenant-local');

select throws_ok(
 $$select private.create_proposal(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 '5b000000-0000-4000-8000-000000000001','Governo','2026-07-13',
 '[{"catalogItemId":"6b000000-0000-4000-8000-000000000001","kind":"product","description":"Produto inválido","quantity":"0","unitAmount":"10.00"}]',
 '8b000000-0000-4000-8000-000000000014')$$,
 '22023','AXSYS_PROPOSAL_ITEMS_INVALID','invalid item rolls back its number');

set local role axsys_bff;
insert into numbering_results values ('a3',private.create_proposal(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 '5b000000-0000-4000-8000-000000000001','Governo','2026-07-13',
 '[{"catalogItemId":"6b000000-0000-4000-8000-000000000001","kind":"service","description":"Assessoria mensal","months":3,"monthlyAmount":"1250.40"}]',
 '8b000000-0000-4000-8000-000000000015'));
reset role;
select is((select (result#>>'{record,proposal,number}')::bigint from numbering_results where label='a3'),3::bigint,
 'rejected proposal consumes no number');
set local role axsys_bff;
insert into numbering_results values ('delete_a3',private.delete_draft_proposal(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 (select (result#>>'{record,proposal,id}')::uuid from numbering_results where label='a3'),
 (select (result#>>'{record,proposal,version}')::bigint from numbering_results where label='a3'),
 '8b000000-0000-4000-8000-000000000016'));
reset role;
select is((select result->'record' from numbering_results where label='delete_a3'),'null'::jsonb,
 'draft proposal deletion returns the canonical null record');
select is((select count(*) from public.proposals
 where company_id='3b000000-0000-4000-8000-000000000001' and number=3),0::bigint,
 'draft proposal deletion cascades its items without immutable-trigger failure');
set local role axsys_bff;
select private.write_proposal_total_mismatch_security_event(
 '2b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',
 (select (result#>>'{record,proposal,id}')::uuid from numbering_results where label='a1'),
 '8b000000-0000-4000-8000-000000000017');
reset role;
select is((select count(*) from public.security_events
 where correlation_id='8b000000-0000-4000-8000-000000000017'
   and event_type='administrative.proposal.total_mismatch'
   and reason_code='INTERNAL_TOTAL_MISMATCH'),1::bigint,
 'proposal total mismatch uses the dedicated actor/session-verified security writer');
select results_eq(
 $$select item.line_total,proposal.total from public.proposal_items item
   join public.proposals proposal on proposal.id=item.proposal_id
   where proposal.number=1 and proposal.company_id='3b000000-0000-4000-8000-000000000001'$$,
 $$values (3751.20::numeric(14,2),3751.20::numeric(14,2))$$,
 'database computes exact service line and proposal totals');
select * from finish();
rollback;
