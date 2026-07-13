begin;
select plan(32);
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
select * from finish();
rollback;
