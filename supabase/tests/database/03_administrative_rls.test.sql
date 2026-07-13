begin;
select plan(47);

select ok(c.relrowsecurity and c.relforcerowsecurity,'clients uses forced RLS') from pg_class c where c.oid='public.clients'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'catalog uses forced RLS') from pg_class c where c.oid='public.catalog_items'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'proposals uses forced RLS') from pg_class c where c.oid='public.proposals'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'proposal items uses forced RLS') from pg_class c where c.oid='public.proposal_items'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'contracts uses forced RLS') from pg_class c where c.oid='public.contracts'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'attachments uses forced RLS') from pg_class c where c.oid='public.contract_attachments'::regclass;
select ok(c.relrowsecurity and c.relforcerowsecurity,'generated documents uses forced RLS') from pg_class c where c.oid='public.generated_documents'::regclass;

select ok(has_table_privilege('authenticated','public.clients','select'),'authenticated can select clients');
select ok(has_table_privilege('authenticated','public.catalog_items','select'),'authenticated can select catalog');
select ok(has_table_privilege('authenticated','public.proposals','select'),'authenticated can select proposals');
select ok(has_table_privilege('authenticated','public.proposal_items','select'),'authenticated can select proposal items');
select ok(has_table_privilege('authenticated','public.contracts','select'),'authenticated can select contracts');
select ok(has_table_privilege('authenticated','public.contract_attachments','select'),'authenticated can select attachments');
select ok(not has_table_privilege('authenticated','public.clients','insert,update,delete'),'authenticated cannot mutate clients');
select ok(not has_table_privilege('authenticated','public.generated_documents','insert,update,delete'),'authenticated cannot mutate documents');

select policies_are('public','clients',array['clients_select_administrative'],'clients has SELECT-only policy');
select policies_are('public','catalog_items',array['catalog_items_select_administrative'],'catalog has SELECT-only policy');
select policies_are('public','proposals',array['proposals_select_administrative'],'proposals has SELECT-only policy');
select policies_are('public','proposal_items',array['proposal_items_select_administrative'],'proposal items has SELECT-only policy');
select policies_are('public','contracts',array['contracts_select_administrative'],'contracts has SELECT-only policy');
select policies_are('public','contract_attachments',array['contract_attachments_select_administrative'],'attachments has SELECT-only policy');
select policies_are('public','generated_documents',array['generated_documents_select_proposal_administrative'],'documents expose only proposal metadata');

select has_function('private','create_client',array['uuid','uuid','jsonb','uuid'],'create_client exact signature');
select has_function('private','update_client',array['uuid','uuid','uuid','bigint','jsonb','uuid'],'update_client exact signature');
select has_function('private','archive_client',array['uuid','uuid','uuid','bigint','uuid'],'archive_client exact signature');
select has_function('private','restore_client',array['uuid','uuid','uuid','bigint','uuid'],'restore_client exact signature');
select has_function('private','delete_client',array['uuid','uuid','uuid','bigint','uuid'],'delete_client exact signature');
select has_function('private','create_catalog_item',array['uuid','uuid','jsonb','uuid'],'create_catalog_item exact signature');
select has_function('private','update_catalog_item',array['uuid','uuid','uuid','bigint','jsonb','uuid'],'update_catalog_item exact signature');
select has_function('private','archive_catalog_item',array['uuid','uuid','uuid','bigint','uuid'],'archive_catalog_item exact signature');
select has_function('private','restore_catalog_item',array['uuid','uuid','uuid','bigint','uuid'],'restore_catalog_item exact signature');
select has_function('private','delete_catalog_item',array['uuid','uuid','uuid','bigint','uuid'],'delete_catalog_item exact signature');
select has_function('private','update_draft_proposal',array['uuid','uuid','uuid','bigint','jsonb','uuid'],'update proposal exact signature');
select has_function('private','save_proposal_items',array['uuid','uuid','uuid','bigint','jsonb','uuid'],'save proposal items exact signature');
select has_function('private','transition_proposal_status',array['uuid','uuid','uuid','bigint','proposal_status','uuid'],'transition proposal exact signature');
select has_function('private','delete_draft_proposal',array['uuid','uuid','uuid','bigint','uuid'],'delete proposal exact signature');
select has_function('private','create_contract',array['uuid','uuid','jsonb','uuid'],'create contract exact signature');
select has_function('private','update_contract',array['uuid','uuid','uuid','bigint','jsonb','uuid'],'update contract exact signature');
select has_function('private','close_contract',array['uuid','uuid','uuid','bigint','text','uuid'],'close contract exact signature');
select has_function('private','delete_contract',array['uuid','uuid','uuid','bigint','uuid'],'delete contract exact signature');
select has_function('private','version_contract_attachment',array['uuid','uuid','uuid','uuid','uuid','uuid'],'attachment writer exact signature');
select ok(to_regprocedure('public.create_proposal(uuid,uuid,uuid,text,date,jsonb,uuid)') is null,'no public proposal writer exists');
select ok(not has_column_privilege('authenticated','public.generated_documents','immutable_snapshot','select'),'document snapshot is BFF-only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('create_client','update_client','archive_client','restore_client','delete_client','create_catalog_item','update_catalog_item','archive_catalog_item','restore_catalog_item','delete_catalog_item','create_proposal','update_draft_proposal','save_proposal_items','transition_proposal_status','delete_draft_proposal','create_contract','update_contract','close_contract','delete_contract','version_contract_attachment')
 and p.prosecdef and p.proconfig @> array['search_path=""']),20,'all administrative writers are fixed-search-path definers');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('create_client','update_client','archive_client','restore_client','delete_client','create_catalog_item','update_catalog_item','archive_catalog_item','restore_catalog_item','delete_catalog_item','create_proposal','update_draft_proposal','save_proposal_items','transition_proposal_status','delete_draft_proposal','create_contract','update_contract','close_contract','delete_contract','version_contract_attachment')
 and has_function_privilege('axsys_bff',p.oid,'execute')),20,'axsys_bff executes every administrative writer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('create_client','update_client','archive_client','restore_client','delete_client','create_catalog_item','update_catalog_item','archive_catalog_item','restore_catalog_item','delete_catalog_item','create_proposal','update_draft_proposal','save_proposal_items','transition_proposal_status','delete_draft_proposal','create_contract','update_contract','close_contract','delete_contract','version_contract_attachment')
 and has_function_privilege('authenticated',p.oid,'execute')),0,'authenticated executes no administrative writer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('create_client','update_client','archive_client','restore_client','delete_client','create_catalog_item','update_catalog_item','archive_catalog_item','restore_catalog_item','delete_catalog_item','create_proposal','update_draft_proposal','save_proposal_items','transition_proposal_status','delete_draft_proposal','create_contract','update_contract','close_contract','delete_contract','version_contract_attachment')
 and has_function_privilege('service_role',p.oid,'execute')),0,'service role executes no administrative writer');

select * from finish();
rollback;
