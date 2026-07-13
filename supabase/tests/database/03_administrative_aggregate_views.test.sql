begin;
select plan(8);

select has_view('public', 'proposal_client_aggregates', 'proposal aggregate view exists');
select has_view('public', 'contract_client_aggregates', 'contract aggregate view exists');
select ok(
  coalesce((select 'security_invoker=true' = any(reloptions)
            from pg_class where oid = 'public.proposal_client_aggregates'::regclass), false),
  'proposal aggregate executes as the authenticated invoker'
);
select ok(
  coalesce((select 'security_invoker=true' = any(reloptions)
            from pg_class where oid = 'public.contract_client_aggregates'::regclass), false),
  'contract aggregate executes as the authenticated invoker'
);
select table_privs_are(
  'public', 'proposal_client_aggregates', 'authenticated', array['SELECT'],
  'authenticated can only select proposal aggregates'
);
select table_privs_are(
  'public', 'contract_client_aggregates', 'authenticated', array['SELECT'],
  'authenticated can only select contract aggregates'
);
select table_privs_are(
  'public', 'proposal_client_aggregates', 'anon', array[]::text[],
  'anonymous cannot read proposal aggregates'
);
select table_privs_are(
  'public', 'contract_client_aggregates', 'service_role', array[]::text[],
  'service role has no aggregate bypass'
);

select * from finish();
rollback;
