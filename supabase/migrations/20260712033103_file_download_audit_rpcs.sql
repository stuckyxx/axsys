do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'AXSYS_FILE_DOWNLOAD_AUDIT_MIGRATION_OWNER_INVALID';
  end if;

  if to_regclass('public.file_objects') is null
     or to_regclass('public.audit_events') is null
     or to_regclass('public.security_events') is null
     or to_regclass('private.auth_session_controls') is null
     or to_regprocedure('private.assert_auth_session(uuid,uuid)') is null
     or to_regprocedure(
       'extensions.digest(text,text)'
     ) is null
     or to_regprocedure(
       'extensions.gen_random_bytes(integer)'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_extension extension
       join pg_catalog.pg_namespace namespace
         on namespace.oid = extension.extnamespace
       where extension.extname = 'pg_cron'
         and namespace.nspname = 'pg_catalog'
     ) then
    raise exception using
      errcode = '55000',
      message = 'AXSYS_FILE_DOWNLOAD_AUDIT_DEPENDENCY_INVALID';
  end if;
end
$$;

insert into private.rate_limit_policies (
  bucket,
  attempt_limit,
  window_seconds,
  block_seconds,
  clear_on_success
) values ('file-download-user', 60, 60, 60, false);

alter table public.audit_events
  alter column actor_user_id drop not null;

alter table public.audit_events
  add constraint audit_events_actor_presence check (
    actor_user_id is not null
    or (
      action = 'file.download'
      and metadata ->> 'accessKind' = 'public'
    )
  );

create table private.download_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  nonce_hash text,
  nonce_consumed_at timestamptz,
  actor_user_id uuid,
  session_id uuid,
  company_id uuid not null
    references public.companies(id) on delete restrict,
  resource_kind text not null,
  resource_id uuid not null,
  correlation_id uuid not null,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  outcome text,
  byte_class text,
  constraint download_attempts_actor_session_pair check (
    (actor_user_id is null) = (session_id is null)
  ),
  constraint download_attempts_nonce_hash_format check (
    nonce_hash is null or nonce_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint download_attempts_resource_kind_vocabulary check (
    resource_kind in (
      'file',
      'contract',
      'certificate',
      'payment',
      'proposal',
      'generated_document'
    )
  ),
  constraint download_attempts_outcome_vocabulary check (
    outcome is null
    or outcome in (
      'completed',
      'aborted',
      'integrity_failed',
      'stream_failed',
      'abandoned'
    )
  ),
  constraint download_attempts_byte_class_vocabulary check (
    byte_class is null
    or byte_class in (
      'empty',
      'under_1_mib',
      'under_10_mib',
      'at_least_10_mib',
      'unknown'
    )
  ),
  constraint download_attempts_lifecycle check (
    (
      outcome is null
      and completed_at is null
      and nonce_consumed_at is null
      and nonce_hash is not null
      and byte_class is null
    )
    or (
      outcome is not null
      and completed_at is not null
      and nonce_consumed_at is not null
      and nonce_hash is null
      and byte_class is not null
      and completed_at >= started_at
    )
  )
);

create unique index download_attempts_nonce_hash_key
  on private.download_attempts(nonce_hash)
  where nonce_hash is not null;

create index download_attempts_pending_idx
  on private.download_attempts(started_at, id)
  where completed_at is null;

create index download_attempts_retention_idx
  on private.download_attempts(completed_at, id)
  where completed_at is not null;

create table private.download_execution_context (
  transaction_id bigint not null,
  backend_pid integer not null,
  operation_kind text not null,
  attempt_id uuid not null
    references private.download_attempts(id) on delete cascade,
  constraint download_execution_context_operation_kind_vocabulary check (
    operation_kind in ('download_completion', 'download_stale')
  ),
  primary key (transaction_id, backend_pid, operation_kind, attempt_id)
);

alter table private.download_attempts enable row level security;
alter table private.download_attempts force row level security;
alter table private.download_execution_context enable row level security;
alter table private.download_execution_context force row level security;

revoke all on private.download_attempts,
  private.download_execution_context
from public, anon, authenticated, service_role, axsys_bff;

create function private.begin_download_audit_core(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_company_id uuid,
  p_resource_kind text,
  p_resource_id uuid,
  p_correlation_id uuid
) returns table (
  attempt_id uuid,
  completion_nonce text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_completion_nonce text;
  v_nonce_hash text;
begin
  if p_company_id is null
     or p_resource_kind is null
     or p_resource_id is null
     or p_correlation_id is null
     or (p_actor_user_id is null) <> (p_session_id is null)
     or p_resource_kind not in (
       'file',
       'contract',
       'certificate',
       'payment',
       'proposal',
       'generated_document'
     ) then
    raise exception using
      errcode = '22023',
      message = 'download_audit_begin_invalid';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'download_audit_company_invalid';
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  v_completion_nonce := pg_catalog.rtrim(
    pg_catalog.translate(
      pg_catalog.replace(
        pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
        E'\n',
        ''
      ),
      '+/',
      '-_'
    ),
    '='
  );
  v_nonce_hash := pg_catalog.encode(
    extensions.digest(v_completion_nonce, 'sha256'),
    'hex'
  );

  insert into private.download_attempts (
    id,
    nonce_hash,
    actor_user_id,
    session_id,
    company_id,
    resource_kind,
    resource_id,
    correlation_id
  ) values (
    v_attempt_id,
    v_nonce_hash,
    p_actor_user_id,
    p_session_id,
    p_company_id,
    p_resource_kind,
    p_resource_id,
    p_correlation_id
  );

  return query select v_attempt_id, v_completion_nonce;
end;
$$;

create function private.guard_download_audit_event_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_matches integer;
begin
  if new.action <> 'file.download' then
    return new;
  end if;

  select pg_catalog.count(*)::integer
  into v_matches
  from private.download_execution_context execution_context
  join private.download_attempts attempt
    on attempt.id = execution_context.attempt_id
  where execution_context.transaction_id = pg_catalog.txid_current()
    and execution_context.backend_pid = pg_catalog.pg_backend_pid()
    and execution_context.operation_kind in (
      'download_completion',
      'download_stale'
    )
    and attempt.completed_at is not null
    and attempt.nonce_consumed_at is not null
    and attempt.nonce_hash is null
    and attempt.outcome is not null
    and attempt.byte_class is not null
    and (
      (
        execution_context.operation_kind = 'download_completion'
        and attempt.outcome in (
          'completed',
          'aborted',
          'integrity_failed',
          'stream_failed'
        )
      )
      or (
        execution_context.operation_kind = 'download_stale'
        and attempt.outcome = 'abandoned'
      )
    )
    and new.scope = 'tenant'::public.audit_scope
    and new.company_id = attempt.company_id
    and new.actor_user_id is not distinct from attempt.actor_user_id
    and new.resource_type = attempt.resource_kind
    and new.resource_id = attempt.resource_id
    and new.outcome = case
      when attempt.outcome = 'completed'
        then 'success'::public.audit_outcome
      else 'failure'::public.audit_outcome
    end
    and new.reason_code is not distinct from case attempt.outcome
      when 'completed' then null
      when 'aborted' then 'DOWNLOAD_ABORTED'
      when 'integrity_failed' then 'DOWNLOAD_INTEGRITY_FAILED'
      when 'stream_failed' then 'DOWNLOAD_STREAM_FAILED'
      when 'abandoned' then 'DOWNLOAD_ABANDONED'
    end
    and new.correlation_id = attempt.correlation_id
    and new.ip_hash is null
    and new.user_agent_hash is null
    and new.metadata = pg_catalog.jsonb_build_object(
      'accessKind',
      case
        when attempt.actor_user_id is null then 'public'
        else 'authenticated'
      end,
      'byteClass',
      attempt.byte_class,
      'downloadOutcome',
      attempt.outcome
    );

  if v_matches <> 1 then
    raise exception using
      errcode = '42501',
      message = 'download_audit_context_invalid';
  end if;

  return new;
end;
$$;

create trigger audit_events_guard_download_insert
before insert on public.audit_events
for each row execute function private.guard_download_audit_event_insert();

create function private.emit_download_audit_event_core(
  p_attempt_id uuid,
  p_operation_kind text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.download_attempts%rowtype;
  v_audit_outcome public.audit_outcome;
  v_reason_code text;
begin
  if p_attempt_id is null
     or p_operation_kind not in ('download_completion', 'download_stale') then
    raise exception using
      errcode = '42501',
      message = 'download_audit_context_invalid';
  end if;

  select attempt.*
  into v_attempt
  from private.download_attempts attempt
  join private.download_execution_context execution_context
    on execution_context.attempt_id = attempt.id
  where attempt.id = p_attempt_id
    and execution_context.transaction_id = pg_catalog.txid_current()
    and execution_context.backend_pid = pg_catalog.pg_backend_pid()
    and execution_context.operation_kind = p_operation_kind;

  if not found
     or v_attempt.completed_at is null
     or v_attempt.nonce_consumed_at is null
     or v_attempt.nonce_hash is not null
     or v_attempt.outcome is null
     or v_attempt.byte_class is null
     or (
       p_operation_kind = 'download_completion'
       and v_attempt.outcome not in (
         'completed',
         'aborted',
         'integrity_failed',
         'stream_failed'
       )
     )
     or (
       p_operation_kind = 'download_stale'
       and v_attempt.outcome <> 'abandoned'
     ) then
    raise exception using
      errcode = '42501',
      message = 'download_audit_context_invalid';
  end if;

  v_audit_outcome := case
    when v_attempt.outcome = 'completed'
      then 'success'::public.audit_outcome
    else 'failure'::public.audit_outcome
  end;
  v_reason_code := case v_attempt.outcome
    when 'completed' then null
    when 'aborted' then 'DOWNLOAD_ABORTED'
    when 'integrity_failed' then 'DOWNLOAD_INTEGRITY_FAILED'
    when 'stream_failed' then 'DOWNLOAD_STREAM_FAILED'
    when 'abandoned' then 'DOWNLOAD_ABANDONED'
  end;

  insert into public.audit_events (
    scope,
    company_id,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    outcome,
    reason_code,
    correlation_id,
    ip_hash,
    user_agent_hash,
    metadata,
    occurred_at
  ) values (
    'tenant'::public.audit_scope,
    v_attempt.company_id,
    v_attempt.actor_user_id,
    'file.download',
    v_attempt.resource_kind,
    v_attempt.resource_id,
    v_audit_outcome,
    v_reason_code,
    v_attempt.correlation_id,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'accessKind',
      case
        when v_attempt.actor_user_id is null then 'public'
        else 'authenticated'
      end,
      'byteClass',
      v_attempt.byte_class,
      'downloadOutcome',
      v_attempt.outcome
    ),
    pg_catalog.clock_timestamp()
  );
end;
$$;

create function private.complete_download_audit(
  p_attempt_id uuid,
  p_completion_nonce text,
  p_outcome text,
  p_byte_class text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.download_attempts%rowtype;
  v_nonce_hash text;
  v_now timestamptz;
begin
  if p_attempt_id is null
     or p_completion_nonce is null
     or p_outcome not in (
       'completed',
       'aborted',
       'integrity_failed',
       'stream_failed'
     )
     or p_byte_class not in (
       'empty',
       'under_1_mib',
       'under_10_mib',
       'at_least_10_mib',
       'unknown'
     ) then
    raise exception using
      errcode = '22023',
      message = 'download_audit_result_invalid';
  end if;

  v_nonce_hash := pg_catalog.encode(
    extensions.digest(p_completion_nonce, 'sha256'),
    'hex'
  );
  v_now := pg_catalog.clock_timestamp();

  update private.download_attempts attempt
  set nonce_hash = null,
      nonce_consumed_at = v_now,
      completed_at = v_now,
      outcome = p_outcome,
      byte_class = p_byte_class
  where attempt.id = p_attempt_id
    and attempt.outcome is null
    and attempt.completed_at is null
    and attempt.nonce_consumed_at is null
    and attempt.nonce_hash = v_nonce_hash
  returning attempt.* into v_attempt;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'download_audit_completion_invalid';
  end if;

  insert into private.download_execution_context (
    transaction_id,
    backend_pid,
    operation_kind,
    attempt_id
  ) values (
    pg_catalog.txid_current(),
    pg_catalog.pg_backend_pid(),
    'download_completion',
    v_attempt.id
  );

  perform private.emit_download_audit_event_core(
    v_attempt.id,
    'download_completion'
  );

  delete from private.download_execution_context execution_context
  where execution_context.transaction_id = pg_catalog.txid_current()
    and execution_context.backend_pid = pg_catalog.pg_backend_pid()
    and execution_context.operation_kind = 'download_completion'
    and execution_context.attempt_id = v_attempt.id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'download_audit_context_invalid';
  end if;
end;
$$;

create function private.authorize_image_file_download(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_file_id uuid,
  p_correlation_id uuid
) returns table (
  file_id uuid,
  company_id uuid,
  purpose text,
  owner_user_id uuid,
  bucket text,
  object_path text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  original_name text,
  attempt_id uuid,
  completion_nonce text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.file_objects%rowtype;
  v_attempt_id uuid;
  v_completion_nonce text;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_file_id is null
     or p_correlation_id is null then
    raise exception using
      errcode = '22023',
      message = 'file_download_input_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1672, 0);

  if private.assert_auth_session(p_session_id, p_actor_user_id) then
    select file_object.*
    into v_file
    from public.company_memberships membership
    join public.companies company
      on company.id = membership.company_id
    join public.profiles profile
      on profile.user_id = membership.user_id
    join private.auth_session_controls control
      on control.session_id = p_session_id
     and control.user_id = membership.user_id
    join public.file_objects file_object
      on file_object.company_id = membership.company_id
     and file_object.id = p_file_id
    where membership.user_id = p_actor_user_id
      and membership.status = 'active'::public.membership_status
      and company.status = 'active'::public.company_status
      and profile.is_active
      and not profile.must_change_password
      and control.state = 'active'::private.auth_session_state
      and control.audit_scope = 'tenant'::public.audit_scope
      and control.audit_company_id = membership.company_id
      and control.revoked_at is null
      and control.absolute_expires_at > pg_catalog.clock_timestamp()
      and file_object.purpose in (
        'profile_avatar'::public.file_purpose,
        'company_letterhead'::public.file_purpose,
        'company_signature'::public.file_purpose
      )
      and file_object.status = 'ready'::public.file_status
      and file_object.scan_status = 'clean'::public.file_scan_status
      and file_object.storage_deleted_at is null
      and file_object.retirement_claim_id is null
      and file_object.retirement_claimed_at is null
      and file_object.bucket = 'axsys-private'
      and file_object.detected_mime = 'image/webp'
      and file_object.byte_size between 1 and 5242880
      and file_object.object_path =
        file_object.company_id::text
        || '/'
        || file_object.purpose::text
        || '/'
        || file_object.id::text
        || '.webp'
      and (
        (
          file_object.purpose = 'profile_avatar'::public.file_purpose
          and (
            file_object.owner_user_id = p_actor_user_id
            or membership.role = 'company_admin'::public.membership_role
          )
        )
        or file_object.purpose in (
          'company_letterhead'::public.file_purpose,
          'company_signature'::public.file_purpose
        )
      )
    for share of file_object;
  end if;

  if v_file.id is null then
    insert into public.security_events (
      event_type,
      user_id,
      email_hash,
      ip_hash,
      outcome,
      reason_code,
      correlation_id,
      metadata,
      occurred_at
    ) values (
      'file.download.denied',
      null,
      null,
      null,
      'denied'::public.audit_outcome,
      'FILE_NOT_FOUND',
      p_correlation_id,
      '{}'::jsonb,
      pg_catalog.clock_timestamp()
    );
    return;
  end if;

  select audit_attempt.attempt_id, audit_attempt.completion_nonce
  into v_attempt_id, v_completion_nonce
  from private.begin_download_audit_core(
    p_actor_user_id,
    p_session_id,
    v_file.company_id,
    'file',
    v_file.id,
    p_correlation_id
  ) audit_attempt;

  return query
  select v_file.id,
         v_file.company_id,
         v_file.purpose::text,
         v_file.owner_user_id,
         v_file.bucket,
         v_file.object_path,
         v_file.detected_mime,
         v_file.byte_size,
         v_file.sha256,
         v_file.original_name,
         v_attempt_id,
         v_completion_nonce;
end;
$$;

create function private.finalize_stale_download_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.download_attempts%rowtype;
  v_now timestamptz;
  v_finalized integer := 0;
begin
  for v_attempt in
    select attempt.*
    from private.download_attempts attempt
    where attempt.completed_at is null
      and attempt.outcome is null
      and attempt.started_at
        < pg_catalog.clock_timestamp() - interval '15 minutes'
    order by attempt.started_at, attempt.id
    limit 100
    for update skip locked
  loop
    v_now := pg_catalog.clock_timestamp();

    update private.download_attempts attempt
    set nonce_hash = null,
        nonce_consumed_at = v_now,
        completed_at = v_now,
        outcome = 'abandoned',
        byte_class = 'unknown'
    where attempt.id = v_attempt.id
      and attempt.outcome is null
      and attempt.completed_at is null
    returning attempt.* into v_attempt;

    if found then
      insert into private.download_execution_context (
        transaction_id,
        backend_pid,
        operation_kind,
        attempt_id
      ) values (
        pg_catalog.txid_current(),
        pg_catalog.pg_backend_pid(),
        'download_stale',
        v_attempt.id
      );

      perform private.emit_download_audit_event_core(
        v_attempt.id,
        'download_stale'
      );

      delete from private.download_execution_context execution_context
      where execution_context.transaction_id = pg_catalog.txid_current()
        and execution_context.backend_pid = pg_catalog.pg_backend_pid()
        and execution_context.operation_kind = 'download_stale'
        and execution_context.attempt_id = v_attempt.id;

      if not found then
        raise exception using
          errcode = '42501',
          message = 'download_audit_context_invalid';
      end if;

      v_finalized := v_finalized + 1;
    end if;
  end loop;

  return v_finalized;
end;
$$;

create function private.purge_expired_download_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_purged integer := 0;
begin
  for v_attempt_id in
    select attempt.id
    from private.download_attempts attempt
    where attempt.completed_at is not null
      and attempt.completed_at
        < pg_catalog.clock_timestamp() - interval '30 days'
    order by attempt.completed_at, attempt.id
    limit 1000
    for update skip locked
  loop
    delete from private.download_attempts attempt
    where attempt.id = v_attempt_id
      and attempt.completed_at is not null
      and attempt.completed_at
        < pg_catalog.clock_timestamp() - interval '30 days';

    if found then
      v_purged := v_purged + 1;
    end if;
  end loop;

  return v_purged;
end;
$$;

revoke execute on function private.begin_download_audit_core(
  uuid,uuid,uuid,text,uuid,uuid
), private.emit_download_audit_event_core(uuid,text),
  private.finalize_stale_download_attempts(),
  private.guard_download_audit_event_insert(),
  private.purge_expired_download_attempts()
from public, anon, authenticated, service_role, axsys_bff;

revoke execute on function private.authorize_image_file_download(
  uuid,uuid,uuid,uuid
), private.complete_download_audit(uuid,text,text,text)
from public, anon, authenticated, service_role, axsys_bff;

grant execute on function private.authorize_image_file_download(
  uuid,uuid,uuid,uuid
), private.complete_download_audit(uuid,text,text,text)
to axsys_bff;

select cron.schedule(
  'axsys-download-attempt-stale-finalizer',
  '*/5 * * * *',
  'select private.finalize_stale_download_attempts();'
);

select cron.schedule(
  'axsys-download-attempt-retention',
  '17 3 * * *',
  'select private.purge_expired_download_attempts();'
);
