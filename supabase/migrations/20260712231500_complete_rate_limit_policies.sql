do $$
begin
  if current_user <> 'postgres'
     or to_regclass('private.rate_limit_policies') is null
     or to_regprocedure('private.consume_rate_limit(text,text,integer,integer,integer)') is null then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_RATE_LIMIT_POLICY_DEPENDENCY_INVALID';
  end if;
end
$$;

insert into private.rate_limit_policies (
  bucket,
  attempt_limit,
  window_seconds,
  block_seconds,
  clear_on_success
) values
  ('administrative-password-reset', 10, 3600, 3600, false),
  ('bank-account-mutation', 30, 3600, 3600, false),
  ('platform-company-status', 20, 3600, 3600, false),
  ('platform-observability-read', 120, 60, 60, false),
  ('user-provisioning', 20, 3600, 3600, false);
