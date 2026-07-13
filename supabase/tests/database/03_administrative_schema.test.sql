begin;
select plan(20);
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
select * from finish();
rollback;
