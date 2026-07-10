begin;
select plan(1);
select pass('pgTAP executa dentro do Supabase local');
select * from finish();
rollback;
