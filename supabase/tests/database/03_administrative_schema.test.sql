begin;
select plan(56);
select has_table('public','clients','clients exists');
select has_table('public','catalog_items','catalog_items exists');
select has_column('public','clients','company_id','clients carries tenant');
select has_column('public','clients','cnpj_normalized','client CNPJ is normalized');
select has_column('public','clients','segment','client segment exists');
select has_column('public','clients','archived_at','clients can be archived');
select has_column('public','clients','version','clients use optimistic version');
select has_column('public','catalog_items','item_kind','catalog kind exists');
select has_column('public','catalog_items','segment','catalog segment exists');
select has_column('public','catalog_items','archived_at','catalog can be archived');
select col_type_is('public','clients','company_id','uuid','client company is uuid');
select col_type_is('public','clients','version','bigint','client version is bigint');
select col_type_is('public','catalog_items','version','bigint','catalog version is bigint');
select ok(exists(select 1 from pg_constraint where conname='clients_company_cnpj_key'
  and conrelid='public.clients'::regclass),'CNPJ is unique inside a company');
select ok(exists(select 1 from pg_constraint where conname='clients_company_id_id_key'
  and conrelid='public.clients'::regclass),'client exposes composite tenant key');
select ok(exists(select 1 from pg_constraint where conname='catalog_items_company_id_id_key'
  and conrelid='public.catalog_items'::regclass),'catalog exposes composite tenant key');
select has_index('public','clients','clients_company_search_idx','client search is indexed');
select has_index('public','clients','clients_company_active_idx','active clients are indexed');
select has_index('public','catalog_items','catalog_items_company_filter_idx','catalog filters are indexed');
select has_index('public','catalog_items','catalog_items_active_name_uidx','active catalog names are unique');
select has_table('public','proposals','proposals exists');
select has_table('public','proposal_items','proposal_items exists');
select has_column('public','proposals','client_id','proposal carries client');
select has_column('public','proposal_items','catalog_item_id','proposal item carries catalog item');
select col_type_is('public','proposals','total','numeric(14,2)','proposal total is exact');
select col_type_is('public','proposal_items','line_total','numeric(14,2)','line total is exact');
select ok(exists(select 1 from pg_constraint where conname='proposals_company_number_key'
 and conrelid='public.proposals'::regclass),'proposal number is tenant unique');
select ok(exists(select 1 from pg_constraint where conname='proposals_client_segment_fk'
 and conrelid='public.proposals'::regclass),'proposal client and segment are tenant bound');
select ok(exists(select 1 from pg_constraint where conname='proposal_items_proposal_segment_fk'
 and conrelid='public.proposal_items'::regclass),'proposal item is tenant bound to proposal');
select ok(exists(select 1 from pg_constraint where conname='proposal_items_catalog_segment_kind_fk'
 and conrelid='public.proposal_items'::regclass),'proposal item catalog snapshot is tenant bound');
select has_index('public','proposals','proposals_company_status_idx','proposal status cursor is indexed');
select has_index('public','proposal_items','proposal_items_proposal_idx','proposal items are indexed');
select has_table('public','contracts','contracts exists');
select has_table('public','contract_attachments','contract attachments exist');
select has_table('public','generated_documents','generated documents exist');
select col_type_is('public','contracts','amount','numeric(14,2)','contract amount is exact');
select col_type_is('public','contracts','version','bigint','contracts use optimistic version');
select has_column('public','contract_attachments','attachment_group_id','attachment history has a stable group');
select col_type_is('public','contract_attachments','version','integer','attachment version is positive integer');
select has_column('public','generated_documents','payment_request_id','shared documents support payment parents');
select has_column('public','generated_documents','checksum_sha256','generated document checksum exists');
select has_column('public','generated_documents','immutable_snapshot','generated document snapshot exists');
select has_column('public','generated_documents','template_version','generated document template version exists');
select ok(exists(select 1 from pg_constraint where conname='contracts_company_id_id_client_key'
 and conrelid='public.contracts'::regclass),'contract exposes tenant/client composite key');
select ok(exists(select 1 from pg_constraint where conname='contracts_client_fk'
 and conrelid='public.contracts'::regclass),'contract client is tenant bound');
select ok(exists(select 1 from pg_constraint where conname='contracts_dates_check'
 and conrelid='public.contracts'::regclass),'contract dates are coherent');
select ok(exists(select 1 from pg_constraint where conname='contracts_closure_check'
 and conrelid='public.contracts'::regclass),'contract closure actor and reason are coherent');
select ok(exists(select 1 from pg_constraint where conname='contract_attachments_contract_fk'
 and conrelid='public.contract_attachments'::regclass),'attachment contract is tenant bound');
select ok(exists(select 1 from pg_constraint where conname='contract_attachments_file_fk'
 and conrelid='public.contract_attachments'::regclass),'attachment file is tenant bound without cascade');
select has_index('public','contract_attachments','contract_attachments_one_current_uidx','one current attachment version is enforced');
select ok((select array_agg(e.enumlabel::text order by e.enumsortorder)
  from pg_type t join pg_enum e on e.enumtypid=t.oid
  join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and t.typname='document_kind')
 = array['proposal','payment_letter','payment_process'],'shared document kinds are stable');
select ok(exists(select 1 from pg_constraint where conname='generated_documents_exact_parent_check'
 and conrelid='public.generated_documents'::regclass),'generated documents have exactly one kind-appropriate parent');
select ok(exists(select 1 from pg_constraint where conname='generated_documents_proposal_fk'
 and conrelid='public.generated_documents'::regclass),'proposal documents are tenant bound');
select ok(exists(select 1 from pg_constraint where conname='generated_documents_parent_version_key'
 and conrelid='public.generated_documents'::regclass),'generated document parent versions are unique');
select ok(exists(select 1 from pg_trigger where tgname='generated_documents_immutable'
 and tgrelid='public.generated_documents'::regclass and not tgisinternal),'generated document mutation is rejected');
select has_index('public','generated_documents','generated_documents_proposal_idx','proposal document history is indexed');
select * from finish();
rollback;
