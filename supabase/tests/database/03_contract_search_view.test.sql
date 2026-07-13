begin;
select plan(8);

select has_view('public','contract_search_rows','contract search projection exists');

select ok(
  coalesce((select 'security_invoker=true' = any(coalesce(reloptions,array[]::text[]))
            from pg_class where oid='public.contract_search_rows'::regclass),false),
  'contract search projection is security invoker'
);

select ok(
  has_table_privilege('authenticated','public.contract_search_rows','select'),
  'authenticated requests may select through base-table RLS'
);
select ok(
  not has_table_privilege('anon','public.contract_search_rows','select'),
  'anonymous requests cannot select contract search rows'
);
select ok(
  not has_table_privilege('service_role','public.contract_search_rows','select'),
  'service role has no direct contract search grant'
);

select matches(
  pg_get_viewdef('public.contract_search_rows'::regclass,true),
  'lower\(contract\.number\)',
  'number prefix is the exact indexed lower expression'
);
select matches(
  pg_get_viewdef('public.contract_search_rows'::regclass,true),
  'lower\(contract\.object\)',
  'object prefix is the exact indexed lower expression'
);

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema='public' and table_name='contract_search_rows'
     and column_name in ('closed_by','created_by','updated_by')),
  0,
  'contract search projection excludes actor columns'
);

select * from finish();
rollback;
