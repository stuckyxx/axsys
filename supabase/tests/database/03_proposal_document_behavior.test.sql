begin;
\ir helpers/fixtures.inc
select no_plan();

create function test_helpers.activate_document_session(p_user uuid,p_session uuid,p_correlation uuid)
returns void language plpgsql as $$ begin
 perform test_helpers.create_auth_session(p_session,p_user,clock_timestamp()-interval '1 minute');
 perform private.register_auth_session(p_session,p_user,false);
 perform private.write_authenticated_audit_event(p_user,p_session,'auth.login','session',null,
  'success',null,p_correlation,null,null,'{"rememberMe":false}'::jsonb);
end $$;

select test_helpers.create_company_user('21000000-0000-4000-8000-000000000001','doc-a@example.test',
 '31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','member',array['administrative']::public.module_key[]);
select test_helpers.create_company_user('21000000-0000-4000-8000-000000000002','doc-b@example.test',
 '31000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','member',array['administrative']::public.module_key[]);
select test_helpers.activate_document_session('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
select test_helpers.activate_document_session('21000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002');

insert into public.clients(id,company_id,legal_name,cnpj_normalized,segment,municipality,state,created_by,updated_by) values
 ('51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','Cliente Documento A','10000000000001','Governo','Fortaleza','CE','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001'),
 ('51000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','Cliente Documento B','10000000000002','Governo','Recife','PE','21000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002');
insert into public.catalog_items(id,company_id,item_kind,segment,name,description,created_by,updated_by) values
 ('61000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','service','Governo','Serviço A','Descrição A','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001'),
 ('61000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','service','Governo','Serviço B','Descrição B','21000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002');

create temporary table document_results(label text primary key,result jsonb not null);
grant select,insert on document_results to axsys_bff;
grant axsys_bff to postgres;
set local role axsys_bff;
insert into document_results values
 ('proposal_a',private.create_proposal('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','Governo','2026-07-13','[{"catalogItemId":"61000000-0000-4000-8000-000000000001","kind":"service","description":"Descrição A","months":1,"monthlyAmount":"100.00"}]','81000000-0000-4000-8000-000000000011')),
 ('proposal_b',private.create_proposal('21000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','Governo','2026-07-13','[{"catalogItemId":"61000000-0000-4000-8000-000000000002","kind":"service","description":"Descrição B","months":1,"monthlyAmount":"100.00"}]','81000000-0000-4000-8000-000000000012'));
reset role;

create temporary table document_inputs(proposal_id uuid primary key,snapshot jsonb not null);
insert into document_inputs
select (result#>>'{record,proposal,id}')::uuid,jsonb_build_object(
 'templateVersion','proposal-v1','generatedAt','2026-07-13T12:00:00+00:00',
 'proposal',jsonb_build_object('number',1,'status','draft','issuedOn','2026-07-13','total','100.00'),
 'company',jsonb_build_object('legalName','Empresa 1','tradeName',null,'cnpj','10000000000049','consolidatedAddress',null,
  'representative',jsonb_build_object('name',null,'role',null),'branding',jsonb_build_object('letterheadSha256',null,'signatureSha256',null)),
 'client',jsonb_build_object('legalName','Cliente Documento A','tradeName',null,'cnpj','10000000000001','email',null,'phone',null,
  'address',jsonb_build_object('street',null,'number',null,'complement',null,'neighborhood',null,'municipality','Fortaleza','state','CE','postalCode',null)),
 'items',jsonb_build_array(jsonb_build_object('catalogItemId','61000000-0000-4000-8000-000000000001','itemKind','service','position',1,
  'description','Descrição A','months',1,'monthlyAmount','100.00','quantity',null,'unitAmount',null,'lineTotal','100.00')),
 'author',jsonb_build_object('displayName','doc-a','email','doc-a@example.test'))
from document_results where label='proposal_a';
grant select on document_inputs to axsys_bff;

set local role axsys_bff;
insert into document_results
select 'document_1',private.store_proposal_document('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',proposal_id,
 '31000000-0000-4000-8000-000000000001/generated-documents/11111111-1111-4111-8111-111111111111.pdf','application/pdf',100,repeat('a',64),snapshot,'proposal-v1','81000000-0000-4000-8000-000000000021') from document_inputs;
insert into document_results
select 'document_2',private.store_proposal_document('21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',proposal_id,
 '31000000-0000-4000-8000-000000000001/generated-documents/22222222-2222-4222-8222-222222222222.pdf','application/pdf',200,repeat('b',64),snapshot,'proposal-v1','81000000-0000-4000-8000-000000000022') from document_inputs;
reset role;

select results_eq($$select label,(result->>'version')::int from document_results where label like 'document_%' order by label$$,
 $$select * from (values('document_1',1),('document_2',2)) expected(label,version)$$,'documents receive locked monotonic versions');
select is((select used_bytes from private.company_storage_usage where company_id='31000000-0000-4000-8000-000000000001'),300::bigint,'quota usage increments by exact PDF bytes');
select is((select count(*) from public.generated_documents where company_id='31000000-0000-4000-8000-000000000001'),2::bigint,'two immutable document rows persist');
select throws_ok($$update public.generated_documents set template_version='proposal-v2' where id=(select (result->>'documentId')::uuid from document_results where label='document_1')$$,
 '23514','generated documents are immutable','generated document update is rejected');

select throws_ok(format($sql$select private.store_proposal_document(
 '21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',%L,
 '31000000-0000-4000-8000-000000000001/generated-documents/33333333-3333-4333-8333-333333333333.pdf','application/pdf',100,repeat('c',64),%L::jsonb,'proposal-v1','81000000-0000-4000-8000-000000000023')$sql$,
 (select result#>>'{record,proposal,id}' from document_results where label='proposal_b'),(select snapshot::text from document_inputs)),
 'P0002','AXSYS_PROPOSAL_DOCUMENT_NOT_FOUND','cross-tenant proposal remains neutral');
select is((select count(*) from public.file_objects where object_path like '%33333333-3333-4333-8333-333333333333.pdf'),0::bigint,'IDOR rejection creates no metadata');

update private.company_storage_usage set used_bytes=quota_bytes-10 where company_id='31000000-0000-4000-8000-000000000001';
select throws_ok(format($sql$select private.store_proposal_document(
 '21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',%L,
 '31000000-0000-4000-8000-000000000001/generated-documents/44444444-4444-4444-8444-444444444444.pdf','application/pdf',11,repeat('d',64),%L::jsonb,'proposal-v1','81000000-0000-4000-8000-000000000024')$sql$,
 (select proposal_id::text from document_inputs),(select snapshot::text from document_inputs)),
 '53100','AXSYS_STORAGE_QUOTA_EXCEEDED','quota overflow rolls back before metadata');
select is((select count(*) from public.file_objects where object_path like '%44444444-4444-4444-8444-444444444444.pdf'),0::bigint,'quota rejection leaves no metadata');

set local role axsys_bff;
insert into document_results select 'download',private.authorize_proposal_document_download(
 '21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',
 (select (result->>'documentId')::uuid from document_results where label='document_1'),'81000000-0000-4000-8000-000000000025');
reset role;
select results_eq($$select key from document_results,jsonb_object_keys(result) key where label='download' order by key$$,
 $$select * from (values('attemptId'),('bucket'),('byteSize'),('completionNonce'),('downloadName'),('mime'),('path'),('sha256')) expected(key)$$,
 'download return exposes exactly the allowlist');
set local role axsys_bff;
insert into document_results select 'orphan_1',private.record_generated_document_orphan_cleanup(
 '21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',proposal_id,
 '31000000-0000-4000-8000-000000000001/generated-documents/55555555-5555-4555-8555-555555555555.pdf',repeat('e',64),'81000000-0000-4000-8000-000000000026') from document_inputs;
insert into document_results select 'orphan_2',private.record_generated_document_orphan_cleanup(
 '21000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',proposal_id,
 '31000000-0000-4000-8000-000000000001/generated-documents/55555555-5555-4555-8555-555555555555.pdf',repeat('e',64),'81000000-0000-4000-8000-000000000027') from document_inputs;
reset role;
select is((select count(*) from private.generated_document_orphan_cleanup where status='pending'),1::bigint,'orphan cleanup recording is durable and idempotent');
select is((select result->>'cleanupId' from document_results where label='orphan_1'),(select result->>'cleanupId' from document_results where label='orphan_2'),'orphan replay returns the same cleanup identity');
select ok((select metadata ? 'pathHash' and not metadata ? 'path' from public.security_events where event_type='generated_document.orphan_cleanup_required'),'orphan security event redacts the storage path');
select * from finish();
rollback;
