import { loadEnvFile } from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import postgres, { type Sql, type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may inject DATABASE_URL directly.
  }
}

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const WORKER_A_NAME = "axsys-recovery-race-a"
const WORKER_B_NAME = "axsys-recovery-race-b"
const COORDINATOR_NAME = "axsys-recovery-race-coordinator"
const LOCK_TIMEOUT_MS = 6_000
const STATEMENT_TIMEOUT_MS = 12_000
const IDLE_TRANSACTION_TIMEOUT_MS = 12_000
const WAIT_TIMEOUT_MS = 5_000
const EXPIRY_MARGIN_MS = 25
const IDENTITY_GLOBAL_LOCK_SEED = 1672
const IDENTITY_GLOBAL_LOCK_KEY = 0

const USERS = {
  issueRace: "81000000-0000-4000-8000-000000000001",
  issueExpiry: "81000000-0000-4000-8000-000000000002",
  beginRace: "81000000-0000-4000-8000-000000000003",
  beginExpiry: "81000000-0000-4000-8000-000000000004",
  completeOperationExpiry: "81000000-0000-4000-8000-000000000005",
  completeProfileExpiry: "81000000-0000-4000-8000-000000000006",
  beginAdvisoryExpiry: "81000000-0000-4000-8000-000000000007",
  beginProfileExpiry: "81000000-0000-4000-8000-000000000008",
  expiredTemporary: "81000000-0000-4000-8000-000000000009",
  expiredRecovery: "81000000-0000-4000-8000-000000000010",
  liveOperation: "81000000-0000-4000-8000-000000000011",
  sessionDelete: "81000000-0000-4000-8000-000000000012",
  beginAuditExpiry: "81000000-0000-4000-8000-000000000013",
  completeProfileDelete: "81000000-0000-4000-8000-000000000014",
  failProfileDelete: "81000000-0000-4000-8000-000000000015",
  beginCompanyDelete: "81000000-0000-4000-8000-000000000016",
  completeCompanyDelete: "81000000-0000-4000-8000-000000000017",
  failCompanyDelete: "81000000-0000-4000-8000-000000000018",
} as const

const SESSIONS = {
  issueRace: "82000000-0000-4000-8000-000000000001",
  issueExpiry: "82000000-0000-4000-8000-000000000002",
  beginRace: "82000000-0000-4000-8000-000000000003",
  beginExpiry: "82000000-0000-4000-8000-000000000004",
  completeOperationExpiry: "82000000-0000-4000-8000-000000000005",
  completeProfileExpiry: "82000000-0000-4000-8000-000000000006",
  beginAdvisoryExpiry: "82000000-0000-4000-8000-000000000007",
  beginProfileExpiry: "82000000-0000-4000-8000-000000000008",
  expiredTemporary: "82000000-0000-4000-8000-000000000009",
  expiredRecovery: "82000000-0000-4000-8000-000000000010",
  liveOperation: "82000000-0000-4000-8000-000000000011",
  sessionDelete: "82000000-0000-4000-8000-000000000012",
  beginAuditExpiry: "82000000-0000-4000-8000-000000000013",
  completeProfileDelete: "82000000-0000-4000-8000-000000000014",
  failProfileDelete: "82000000-0000-4000-8000-000000000015",
  beginCompanyDelete: "82000000-0000-4000-8000-000000000016",
  completeCompanyDelete: "82000000-0000-4000-8000-000000000017",
  failCompanyDelete: "82000000-0000-4000-8000-000000000018",
} as const

const OPERATIONS = {
  completeOperationExpiry: "84000000-0000-4000-8000-000000000001",
  completeProfileExpiry: "84000000-0000-4000-8000-000000000002",
  expiredTemporary: "84000000-0000-4000-8000-000000000003",
  expiredRecovery: "84000000-0000-4000-8000-000000000004",
  liveOperation: "84000000-0000-4000-8000-000000000005",
  completeProfileDelete: "84000000-0000-4000-8000-000000000006",
  failProfileDelete: "84000000-0000-4000-8000-000000000007",
  beginCompanyPrior: "84000000-0000-4000-8000-000000000008",
  completeCompanyDelete: "84000000-0000-4000-8000-000000000009",
  failCompanyDelete: "84000000-0000-4000-8000-000000000010",
} as const

const CORRELATIONS = {
  beginRaceA: "83000000-0000-4000-8000-000000000001",
  beginRaceB: "83000000-0000-4000-8000-000000000002",
  beginExpiry: "83000000-0000-4000-8000-000000000003",
  completeOperationExpiry: "83000000-0000-4000-8000-000000000004",
  completeProfileExpiry: "83000000-0000-4000-8000-000000000005",
  beginAdvisoryExpiry: "83000000-0000-4000-8000-000000000006",
  beginProfileExpiry: "83000000-0000-4000-8000-000000000007",
  expiredTemporaryPrior: "83000000-0000-4000-8000-000000000008",
  expiredTemporaryNext: "83000000-0000-4000-8000-000000000009",
  expiredRecoveryPrior: "83000000-0000-4000-8000-000000000010",
  expiredRecoveryNext: "83000000-0000-4000-8000-000000000011",
  liveOperationPrior: "83000000-0000-4000-8000-000000000012",
  liveOperationNext: "83000000-0000-4000-8000-000000000013",
  sessionDelete: "83000000-0000-4000-8000-000000000014",
  beginAuditExpiry: "83000000-0000-4000-8000-000000000015",
  completeProfileDelete: "83000000-0000-4000-8000-000000000016",
  failProfileDelete: "83000000-0000-4000-8000-000000000017",
  beginCompanyPrior: "83000000-0000-4000-8000-000000000018",
  beginCompanyNext: "83000000-0000-4000-8000-000000000019",
  completeCompanyDelete: "83000000-0000-4000-8000-000000000020",
  failCompanyDelete: "83000000-0000-4000-8000-000000000021",
} as const

const HASHES = {
  issueRaceA: "a".repeat(64),
  issueRaceB: "b".repeat(64),
  issueExpiryBlocker: "c".repeat(64),
  issueExpiryAttempt: "d".repeat(64),
  beginRace: "e".repeat(64),
  beginExpiry: "f".repeat(64),
  beginAdvisoryExpiry: "1".repeat(64),
  beginProfileExpiry: "2".repeat(64),
  expiredTemporary: "3".repeat(64),
  expiredRecovery: "4".repeat(64),
  liveOperation: "5".repeat(64),
  sessionDelete: "6".repeat(64),
  beginAuditExpiry: "7".repeat(64),
  beginCompanyDelete: "8".repeat(64),
} as const

const COMPANIES = {
  beginDelete: "85000000-0000-4000-8000-000000000001",
  completeDelete: "85000000-0000-4000-8000-000000000002",
  failDelete: "85000000-0000-4000-8000-000000000003",
} as const

const MEMBERSHIPS = {
  beginDelete: "86000000-0000-4000-8000-000000000001",
  completeDelete: "86000000-0000-4000-8000-000000000002",
  failDelete: "86000000-0000-4000-8000-000000000003",
} as const

const ALL_USERS = Object.values(USERS)
const ALL_SESSIONS = Object.values(SESSIONS)
const ALL_COMPANIES = Object.values(COMPANIES)
const ALL_MEMBERSHIPS = Object.values(MEMBERSHIPS)

type Outcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }

type RecoveryGrantRow = {
  expiresAt: Date
}

type RecoveryBeginRow = {
  operationId: string
  userId: string
  sessionId: string
}

function requireLocalAdminDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("Password-recovery concurrency database is unavailable")

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Password-recovery concurrency database is unavailable")
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "54322" ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Password-recovery concurrency database is unavailable")
  }

  return url.toString()
}

const databaseUrl = requireLocalAdminDatabaseUrl(process.env.DATABASE_URL)

function createWorker(applicationName: string): Sql {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 30,
    max_lifetime: null,
    connection: {
      application_name: applicationName,
      lock_timeout: LOCK_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_TRANSACTION_TIMEOUT_MS,
    },
  })
}

const workerA = createWorker(WORKER_A_NAME)
const workerB = createWorker(WORKER_B_NAME)
const coordinator = createWorker(COORDINATOR_NAME)

let recoveryAvailable = false
let workerAPid = 0
let workerBPid = 0
let coordinatorPid = 0

async function beginBoundedTransaction(sql: Sql): Promise<void> {
  await sql.unsafe("begin")
  try {
    await sql.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
    await sql.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await sql.unsafe(
      `set local idle_in_transaction_session_timeout = '${IDLE_TRANSACTION_TIMEOUT_MS}ms'`,
    )
  } catch (error) {
    await rollbackQuietly(sql)
    throw error
  }
}

async function rollbackQuietly(sql: Sql): Promise<void> {
  try {
    await sql.unsafe("rollback")
  } catch {
    // A bounded statement can already have ended its transaction.
  }
}

async function captureOutcome<T>(statement: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await statement() }
  } catch (error) {
    return { ok: false, error }
  }
}

function expectDatabaseFailure(
  outcome: Outcome,
  code: string,
  message: string,
): void {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) {
    const databaseError = outcome.error as Error & { code?: string }
    expect(databaseError.code).toBe(code)
    expect(databaseError.message).toBe(message)
    expect(databaseError.code).not.toBe("40P01")
    expect(databaseError.code).not.toBe("55P03")
    expect(databaseError.code).not.toBe("57014")
  }
}

function expectDatabaseCode(outcome: Outcome, code: string): void {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) {
    const databaseError = outcome.error as Error & { code?: string }
    expect(databaseError.code).toBe(code)
    expect(databaseError.code).not.toBe("40P01")
    expect(databaseError.code).not.toBe("55P03")
    expect(databaseError.code).not.toBe("57014")
  }
}

async function waitForLockWait(
  observer: Sql,
  backendPid: number,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await observer`select pg_stat_clear_snapshot()`
    const [activity] = await observer<[{ blocked: boolean }]>`
      select exists (
        select 1
        from pg_stat_activity
        where pid = ${backendPid}
          and application_name = ${applicationName}
          and state = 'active'
          and wait_event_type = 'Lock'
      ) as blocked
    `
    if (activity.blocked) return
    await delay(25)
  }
  throw new Error("Expected PostgreSQL recovery lock wait was not observed")
}

async function waitUntilExpired(observer: Sql, expiresAt: Date): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const [clock] = await observer<[{ expired: boolean }]>`
      select clock_timestamp() >= (
        ${expiresAt}::timestamptz
        + make_interval(secs => ${EXPIRY_MARGIN_MS / 1_000})
      ) as expired
    `
    if (clock.expired) return
    await delay(25)
  }
  throw new Error("Expected PostgreSQL recovery deadline was not reached")
}

async function setRecoveryClaims(
  sql: Sql | TransactionSql,
  userId: string,
  sessionId: string,
  amrAt: number,
): Promise<void> {
  await sql`
    select set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', ${userId}::uuid,
        'role', 'authenticated',
        'session_id', ${sessionId}::uuid,
        'aal', 'aal1',
        'is_anonymous', false,
        'amr', jsonb_build_array(
          jsonb_build_object('method', 'recovery', 'timestamp', ${amrAt}::bigint)
        )
      )::text,
      true
    ),
    set_config('request.jwt.claim.sub', ${userId}::uuid::text, true)
  `
}

async function recentAmrAt(sql: Sql): Promise<number> {
  const [clock] = await sql<[{ amrAt: number }]>`
    select floor(extract(epoch from clock_timestamp()) - 1)::integer as "amrAt"
  `
  return clock.amrAt
}

async function issueGrant(input: {
  sql: Sql
  userId: string
  sessionId: string
  grantHash: string
  amrAt: number
}): Promise<RecoveryGrantRow> {
  return input.sql.begin(async (transaction) => {
    await setRecoveryClaims(
      transaction,
      input.userId,
      input.sessionId,
      input.amrAt,
    )
    const [grant] = await transaction<[RecoveryGrantRow]>`
      select public.issue_password_recovery_grant(
        ${input.grantHash}
      ) as "expiresAt"
    `
    return grant
  })
}

async function beginRecovery(input: {
  sql: Sql
  grantHash: string
  correlationId: string
}): Promise<RecoveryBeginRow> {
  const [operation] = await input.sql<[RecoveryBeginRow]>`
    select
      operation_id as "operationId",
      user_id as "userId",
      session_id as "sessionId"
    from private.begin_password_recovery(
      ${input.grantHash},
      ${input.correlationId}::uuid
    )
  `
  return operation
}

async function completeRecovery(input: {
  sql: Sql
  operationId: string
  correlationId: string
}): Promise<void> {
  await input.sql`
    select private.complete_password_recovery(
      ${input.operationId}::uuid,
      ${input.correlationId}::uuid
    )
  `
}

async function failRecovery(input: {
  sql: Sql
  operationId: string
  correlationId: string
}): Promise<void> {
  await input.sql`
    select private.fail_password_recovery(
      ${input.operationId}::uuid,
      'AUTH_PROVIDER_FAILURE',
      ${input.correlationId}::uuid
    )
  `
}

async function createPlatformUser(input: {
  sql: Sql
  userId: string
  sessionId: string
  email: string
  withPlatformRole?: boolean
}): Promise<void> {
  await input.sql`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      ${input.userId}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      ${input.email},
      '',
      clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      clock_timestamp(),
      clock_timestamp()
    )
  `
  await input.sql`
    insert into public.profiles (user_id, email, display_name)
    values (${input.userId}::uuid, ${input.email}, ${input.email.split("@")[0]})
  `
  if (input.withPlatformRole !== false) {
    await input.sql`
      insert into public.platform_roles (user_id)
      values (${input.userId}::uuid)
    `
  }
  await input.sql`
    insert into auth.sessions (id, user_id, created_at, updated_at)
    values (
      ${input.sessionId}::uuid,
      ${input.userId}::uuid,
      clock_timestamp(),
      clock_timestamp()
    )
  `
}

async function createTenantUser(input: {
  sql: Sql
  userId: string
  sessionId: string
  email: string
  companyId: string
  membershipId: string
  cnpj: string
}): Promise<void> {
  await createPlatformUser({
    sql: input.sql,
    userId: input.userId,
    sessionId: input.sessionId,
    email: input.email,
    withPlatformRole: false,
  })
  await input.sql`
    insert into public.companies (
      id, legal_name, cnpj_normalized, contact_email
    ) values (
      ${input.companyId}::uuid,
      ${`Empresa ${input.companyId.at(-1)}`},
      ${input.cnpj},
      ${`company-${input.companyId.at(-1)}@example.test`}
    )
  `
  await input.sql`
    insert into public.company_memberships (
      id, company_id, user_id, role
    ) values (
      ${input.membershipId}::uuid,
      ${input.companyId}::uuid,
      ${input.userId}::uuid,
      'member'
    )
  `
}

async function deleteTenantCompany(input: {
  sql: Sql
  membershipId: string
  companyId: string
}): Promise<void> {
  await input.sql.begin(async (transaction) => {
    await transaction`
      delete from public.company_memberships
      where id = ${input.membershipId}::uuid
    `
    await transaction`
      delete from public.companies
      where id = ${input.companyId}::uuid
    `
  })
}

async function createGrant(input: {
  sql: Sql
  grantHash: string
  userId: string
  sessionId: string
  validForMilliseconds: number
}): Promise<Date> {
  const [grant] = await input.sql<[RecoveryGrantRow]>`
    insert into private.password_recovery_grants (
      grant_hash, user_id, session_id, expires_at,
      created_at, updated_at
    ) values (
      ${input.grantHash},
      ${input.userId}::uuid,
      ${input.sessionId}::uuid,
      clock_timestamp()
        + make_interval(secs => ${input.validForMilliseconds / 1_000}),
      clock_timestamp(),
      clock_timestamp()
    )
    returning expires_at as "expiresAt"
  `
  return grant.expiresAt
}

async function createReservedRecoveryOperation(input: {
  sql: Sql
  operationId: string
  correlationId: string
  userId: string
  validForMilliseconds: number
  kind?: "temporary_password_reset" | "password_recovery"
  companyId?: string
}): Promise<Date> {
  return input.sql.begin(async (transaction) => {
    const [clock] = await transaction<
      [{ reservedAt: Date; expiresAt: Date }]
    >`
      with captured as (
        select clock_timestamp() as now
      )
      select
        case
          when ${input.validForMilliseconds} >= 0 then now
          else now
            + make_interval(secs => ${input.validForMilliseconds / 1_000})
            - interval '1 minute'
        end as "reservedAt",
        now + make_interval(secs => ${input.validForMilliseconds / 1_000})
          as "expiresAt"
      from captured
    `
    await transaction`
      update public.profiles
      set must_change_password = true,
          temporary_password_expires_at = ${clock.expiresAt}::timestamptz
      where user_id = ${input.userId}::uuid
    `
    await transaction`
      insert into private.auth_password_operations (
        id, actor_user_id, target_user_id, scope, company_id,
        kind, status, correlation_id, expires_at, reserved_at,
        created_at, updated_at
      ) values (
        ${input.operationId}::uuid,
        ${input.userId}::uuid,
        ${input.userId}::uuid,
        ${input.companyId ? "tenant" : "platform"},
        ${input.companyId ?? null}::uuid,
        ${input.kind ?? "password_recovery"},
        'reserved',
        ${input.correlationId}::uuid,
        ${clock.expiresAt}::timestamptz,
        ${clock.reservedAt}::timestamptz,
        ${clock.reservedAt}::timestamptz,
        ${clock.reservedAt}::timestamptz
      )
    `
    return clock.expiresAt
  })
}

async function cleanupFixtures(sql: Sql): Promise<void> {
  const [catalog] = await sql<[{ available: boolean }]>`
    select to_regclass('private.password_recovery_grants') is not null
      and to_regclass('private.auth_password_operations') is not null
      and to_regclass('public.audit_events') is not null as available
  `
  if (!catalog.available) return

  await sql.begin(async (transaction) => {
    await transaction.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
    await transaction.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await transaction.unsafe(
      `set local idle_in_transaction_session_timeout = '${IDLE_TRANSACTION_TIMEOUT_MS}ms'`,
    )
    const [owner] = await transaction<[{ valid: boolean }]>`
      select current_user = 'postgres' as valid
    `
    if (!owner.valid) {
      throw new Error("Password-recovery cleanup requires the migration owner")
    }

    await transaction.unsafe("lock table public.audit_events in access exclusive mode")
    const [trigger] = await transaction<[{ enabled: string }]>`
      select tgenabled as enabled
      from pg_trigger
      where tgrelid = 'public.audit_events'::regclass
        and tgname = 'audit_events_append_only'
        and not tgisinternal
    `
    if (trigger?.enabled !== "O") {
      throw new Error("Password-recovery cleanup requires its audit trigger")
    }
    await transaction.unsafe(
      "alter table public.audit_events disable trigger audit_events_append_only",
    )
    await transaction`
      delete from public.audit_events
      where actor_user_id = any(${ALL_USERS}::uuid[])
        or correlation_id = any(${Object.values(CORRELATIONS)}::uuid[])
    `
    await transaction.unsafe(
      "alter table public.audit_events enable trigger audit_events_append_only",
    )
    const [restoredTrigger] = await transaction<[{ enabled: string }]>`
      select tgenabled as enabled
      from pg_trigger
      where tgrelid = 'public.audit_events'::regclass
        and tgname = 'audit_events_append_only'
        and not tgisinternal
    `
    if (restoredTrigger?.enabled !== "O") {
      throw new Error("Password-recovery cleanup did not restore its audit trigger")
    }

    await transaction`
      delete from private.auth_password_operations
      where target_user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from private.password_recovery_grants
      where user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from private.auth_session_controls
      where user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from private.auth_user_session_cutoffs
      where user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from auth.sessions
      where id = any(${ALL_SESSIONS}::uuid[])
    `
    await transaction`
      delete from public.platform_roles
      where user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from public.member_modules
      where membership_id = any(${ALL_MEMBERSHIPS}::uuid[])
    `
    await transaction`
      delete from public.company_memberships
      where id = any(${ALL_MEMBERSHIPS}::uuid[])
    `
    await transaction`
      delete from public.companies
      where id = any(${ALL_COMPANIES}::uuid[])
    `
    await transaction`
      delete from public.profiles
      where user_id = any(${ALL_USERS}::uuid[])
    `
    await transaction`
      delete from auth.users
      where id = any(${ALL_USERS}::uuid[])
    `

    const [residue] = await transaction<[{ count: number }]>`
      select (
        (select count(*) from public.audit_events
          where actor_user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from private.auth_password_operations
          where target_user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from private.password_recovery_grants
          where user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from private.auth_session_controls
          where user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from private.auth_user_session_cutoffs
          where user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from auth.sessions
          where id = any(${ALL_SESSIONS}::uuid[]))
        + (select count(*) from public.platform_roles
          where user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from public.member_modules
          where membership_id = any(${ALL_MEMBERSHIPS}::uuid[]))
        + (select count(*) from public.company_memberships
          where id = any(${ALL_MEMBERSHIPS}::uuid[]))
        + (select count(*) from public.companies
          where id = any(${ALL_COMPANIES}::uuid[]))
        + (select count(*) from public.profiles
          where user_id = any(${ALL_USERS}::uuid[]))
        + (select count(*) from auth.users
          where id = any(${ALL_USERS}::uuid[]))
      )::integer as count
    `
    if (residue.count !== 0) {
      throw new Error("Password-recovery cleanup left fixture rows")
    }
  })
}

beforeAll(async () => {
  const [[identityA], [identityB], [identityCoordinator]] = await Promise.all([
    workerA<
      [{ owner: boolean; pid: number; applicationName: string; available: boolean }]
    >`
      select
        current_user = 'postgres' as owner,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName",
        to_regclass('private.password_recovery_grants') is not null
          and to_regprocedure(
            'public.issue_password_recovery_grant(text)'
          ) is not null
          and to_regprocedure(
            'private.begin_password_recovery(text,uuid)'
          ) is not null
          and to_regprocedure(
            'private.complete_password_recovery(uuid,uuid)'
          ) is not null as available
    `,
    workerB<[{ owner: boolean; pid: number; applicationName: string }]>`
      select current_user = 'postgres' as owner,
             pg_backend_pid() as pid,
             current_setting('application_name') as "applicationName"
    `,
    coordinator<[{ owner: boolean; pid: number; applicationName: string }]>`
      select current_user = 'postgres' as owner,
             pg_backend_pid() as pid,
             current_setting('application_name') as "applicationName"
    `,
  ])

  if (
    !identityA.owner ||
    !identityB.owner ||
    !identityCoordinator.owner ||
    identityA.applicationName !== WORKER_A_NAME ||
    identityB.applicationName !== WORKER_B_NAME ||
    identityCoordinator.applicationName !== COORDINATOR_NAME ||
    new Set([identityA.pid, identityB.pid, identityCoordinator.pid]).size !== 3
  ) {
    throw new Error("Password-recovery concurrency database is unavailable")
  }

  recoveryAvailable = identityA.available
  workerAPid = identityA.pid
  workerBPid = identityB.pid
  coordinatorPid = identityCoordinator.pid
  if (!recoveryAvailable) return

  await cleanupFixtures(workerA)
  await createPlatformUser({
    sql: workerA,
    userId: USERS.issueRace,
    sessionId: SESSIONS.issueRace,
    email: "recovery-race@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.issueExpiry,
    sessionId: SESSIONS.issueExpiry,
    email: "recovery-issue-expiry@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.beginRace,
    sessionId: SESSIONS.beginRace,
    email: "recovery-begin-race@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.beginExpiry,
    sessionId: SESSIONS.beginExpiry,
    email: "recovery-begin-expiry@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.completeOperationExpiry,
    sessionId: SESSIONS.completeOperationExpiry,
    email: "recovery-complete-operation@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.completeProfileExpiry,
    sessionId: SESSIONS.completeProfileExpiry,
    email: "recovery-complete-profile@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.beginAdvisoryExpiry,
    sessionId: SESSIONS.beginAdvisoryExpiry,
    email: "recovery-begin-advisory@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.beginProfileExpiry,
    sessionId: SESSIONS.beginProfileExpiry,
    email: "recovery-begin-profile@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.expiredTemporary,
    sessionId: SESSIONS.expiredTemporary,
    email: "recovery-after-temporary@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.expiredRecovery,
    sessionId: SESSIONS.expiredRecovery,
    email: "recovery-after-recovery@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.liveOperation,
    sessionId: SESSIONS.liveOperation,
    email: "recovery-live-operation@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.sessionDelete,
    sessionId: SESSIONS.sessionDelete,
    email: "recovery-session-delete@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.beginAuditExpiry,
    sessionId: SESSIONS.beginAuditExpiry,
    email: "recovery-begin-audit-expiry@example.test",
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.completeProfileDelete,
    sessionId: SESSIONS.completeProfileDelete,
    email: "recovery-complete-profile-delete@example.test",
    withPlatformRole: false,
  })
  await createPlatformUser({
    sql: workerA,
    userId: USERS.failProfileDelete,
    sessionId: SESSIONS.failProfileDelete,
    email: "recovery-fail-profile-delete@example.test",
    withPlatformRole: false,
  })
  await createTenantUser({
    sql: workerA,
    userId: USERS.beginCompanyDelete,
    sessionId: SESSIONS.beginCompanyDelete,
    email: "recovery-begin-company-delete@example.test",
    companyId: COMPANIES.beginDelete,
    membershipId: MEMBERSHIPS.beginDelete,
    cnpj: "81000000000001",
  })
  await createTenantUser({
    sql: workerA,
    userId: USERS.completeCompanyDelete,
    sessionId: SESSIONS.completeCompanyDelete,
    email: "recovery-complete-company-delete@example.test",
    companyId: COMPANIES.completeDelete,
    membershipId: MEMBERSHIPS.completeDelete,
    cnpj: "81000000000002",
  })
  await createTenantUser({
    sql: workerA,
    userId: USERS.failCompanyDelete,
    sessionId: SESSIONS.failCompanyDelete,
    email: "recovery-fail-company-delete@example.test",
    companyId: COMPANIES.failDelete,
    membershipId: MEMBERSHIPS.failDelete,
    cnpj: "81000000000003",
  })
})

afterAll(async () => {
  const teardownErrors: unknown[] = []
  try {
    const unlockResults = await Promise.allSettled([
      workerA`select pg_advisory_unlock_all()`,
      workerB`select pg_advisory_unlock_all()`,
      coordinator`select pg_advisory_unlock_all()`,
    ])
    for (const result of unlockResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }

    if (recoveryAvailable) {
      try {
        await cleanupFixtures(workerA)
      } catch (error) {
        teardownErrors.push(error)
      }
      try {
        const [locks] = await workerA<[{ count: number }]>`
          select count(*)::integer as count
          from pg_locks
          where pid in (${workerAPid}, ${workerBPid}, ${coordinatorPid})
            and locktype = 'advisory'
        `
        expect(locks.count).toBe(0)
        const states = await workerA<
          Array<{ applicationName: string; state: string; transactionOpen: boolean }>
        >`
          select application_name as "applicationName",
                 state,
                 xact_start is not null as "transactionOpen"
          from pg_stat_activity
          where pid in (${workerBPid}, ${coordinatorPid})
          order by application_name
        `
        expect(states).toEqual([
          {
            applicationName: WORKER_B_NAME,
            state: "idle",
            transactionOpen: false,
          },
          {
            applicationName: COORDINATOR_NAME,
            state: "idle",
            transactionOpen: false,
          },
        ])
      } catch (error) {
        teardownErrors.push(error)
      }
    }
  } finally {
    const closeResults = await Promise.allSettled([
      workerA.end({ timeout: 2 }),
      workerB.end({ timeout: 2 }),
      coordinator.end({ timeout: 2 }),
    ])
    for (const result of closeResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }
  }

  if (teardownErrors.length > 0) {
    throw new AggregateError(
      teardownErrors,
      "Password-recovery concurrency teardown failed",
    )
  }
})

describe.sequential("password recovery under concurrent locks", () => {
  it("requires the recovery migration before running destructive races", () => {
    expect(recoveryAvailable).toBe(true)
  })

  it("allows exactly one grant for two concurrent hashes on the same recovery session", async () => {
    if (!recoveryAvailable) return
    const amrAt = await recentAmrAt(coordinator)
    let gateOpen = false
    let attemptA: Promise<Outcome<RecoveryGrantRow>> | undefined
    let attemptB: Promise<Outcome<RecoveryGrantRow>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      gateOpen = true
      await coordinator.unsafe("lock table private.password_recovery_grants in share mode")
      attemptA = captureOutcome(() =>
        issueGrant({
          sql: workerA,
          userId: USERS.issueRace,
          sessionId: SESSIONS.issueRace,
          grantHash: HASHES.issueRaceA,
          amrAt,
        }),
      )
      attemptB = captureOutcome(() =>
        issueGrant({
          sql: workerB,
          userId: USERS.issueRace,
          sessionId: SESSIONS.issueRace,
          grantHash: HASHES.issueRaceB,
          amrAt,
        }),
      )
      await waitForLockWait(coordinator, workerAPid, WORKER_A_NAME)
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await coordinator.unsafe("commit")
      gateOpen = false

      const outcomes = await Promise.all([attemptA, attemptB])
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
      const failure = outcomes.find((outcome) => !outcome.ok)
      expect(failure).toBeDefined()
      if (failure) {
        expectDatabaseFailure(
          failure,
          "23505",
          "password_recovery_grant_already_issued",
        )
      }
      const [persisted] = await coordinator<[{ count: number }]>`
        select count(*)::integer as count
        from private.password_recovery_grants
        where session_id = ${SESSIONS.issueRace}::uuid
      `
      expect(persisted.count).toBe(1)
    } finally {
      if (gateOpen) await rollbackQuietly(coordinator)
      if (attemptA) await attemptA.catch(() => undefined)
      if (attemptB) await attemptB.catch(() => undefined)
    }
  })

  it("rejects issue when a unique-index wait crosses the recovery deadline", async () => {
    if (!recoveryAvailable) return
    const [clock] = await coordinator<[{ amrAt: number; expiresAt: Date }]>`
      select
        floor(extract(epoch from clock_timestamp()) - 597)::integer as "amrAt",
        to_timestamp(floor(extract(epoch from clock_timestamp()) - 597))
          + interval '10 minutes' as "expiresAt"
    `
    let blockerOpen = false
    let attempt: Promise<Outcome<RecoveryGrantRow>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator`
        insert into private.password_recovery_grants (
          grant_hash, user_id, session_id, expires_at,
          created_at, updated_at
        ) values (
          ${HASHES.issueExpiryBlocker},
          ${USERS.issueExpiry}::uuid,
          ${SESSIONS.issueExpiry}::uuid,
          clock_timestamp() + interval '5 minutes',
          clock_timestamp(),
          clock_timestamp()
        )
      `
      attempt = captureOutcome(() =>
        issueGrant({
          sql: workerA,
          userId: USERS.issueExpiry,
          sessionId: SESSIONS.issueExpiry,
          grantHash: HASHES.issueExpiryAttempt,
          amrAt: clock.amrAt,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, clock.expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_context_invalid")
      const [persisted] = await coordinator<[{ count: number }]>`
        select count(*)::integer as count
        from private.password_recovery_grants
        where session_id = ${SESSIONS.issueExpiry}::uuid
      `
      expect(persisted.count).toBe(0)
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("allows one concurrent begin and rejects the replay with one operation", async () => {
    if (!recoveryAvailable) return
    await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginRace,
      userId: USERS.beginRace,
      sessionId: SESSIONS.beginRace,
      validForMilliseconds: 300_000,
    })
    let gateHeld = false
    let attemptA: Promise<Outcome<RecoveryBeginRow>> | undefined
    let attemptB: Promise<Outcome<RecoveryBeginRow>> | undefined

    try {
      await coordinator`
        select pg_advisory_lock(
          ${IDENTITY_GLOBAL_LOCK_SEED},
          ${IDENTITY_GLOBAL_LOCK_KEY}
        )
      `
      gateHeld = true
      attemptA = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginRace,
          correlationId: CORRELATIONS.beginRaceA,
        }),
      )
      attemptB = captureOutcome(() =>
        beginRecovery({
          sql: workerB,
          grantHash: HASHES.beginRace,
          correlationId: CORRELATIONS.beginRaceB,
        }),
      )
      await waitForLockWait(coordinator, workerAPid, WORKER_A_NAME)
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      const [release] = await coordinator<[{ unlocked: boolean }]>`
        select pg_advisory_unlock(
          ${IDENTITY_GLOBAL_LOCK_SEED},
          ${IDENTITY_GLOBAL_LOCK_KEY}
        ) as unlocked
      `
      expect(release.unlocked).toBe(true)
      gateHeld = false

      const outcomes = await Promise.all([attemptA, attemptB])
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
      const failure = outcomes.find((outcome) => !outcome.ok)
      expect(failure).toBeDefined()
      if (failure) {
        expectDatabaseFailure(
          failure,
          "28000",
          "password_recovery_grant_invalid",
        )
      }
      const [persisted] = await coordinator<[{ count: number }]>`
        select count(*)::integer as count
        from private.auth_password_operations
        where target_user_id = ${USERS.beginRace}::uuid
          and kind = 'password_recovery'
      `
      expect(persisted.count).toBe(1)
    } finally {
      if (gateHeld) {
        await coordinator`select pg_advisory_unlock_all()`
      }
      if (attemptA) await attemptA.catch(() => undefined)
      if (attemptB) await attemptB.catch(() => undefined)
    }
  })

  it("rejects begin when its grant-row lock crosses expiry without residue", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginExpiry,
      userId: USERS.beginExpiry,
      sessionId: SESSIONS.beginExpiry,
      validForMilliseconds: 1_500,
    })
    let blockerOpen = false
    let attempt: Promise<Outcome<RecoveryBeginRow>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator`
        select 1
        from private.password_recovery_grants
        where grant_hash = ${HASHES.beginExpiry}
        for update
      `
      attempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginExpiry,
          correlationId: CORRELATIONS.beginExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_grant_invalid")
      const [state] = await coordinator<
        [{ consumed: boolean; forced: boolean; operations: number; audits: number }]
      >`
        select
          grant_row.consumed_at is not null as consumed,
          profile.must_change_password as forced,
          (select count(*)::integer
             from private.auth_password_operations operation
            where operation.target_user_id = grant_row.user_id) as operations,
          (select count(*)::integer
             from public.audit_events audit
            where audit.correlation_id = ${CORRELATIONS.beginExpiry}::uuid) as audits
        from private.password_recovery_grants grant_row
        join public.profiles profile on profile.user_id = grant_row.user_id
        where grant_row.grant_hash = ${HASHES.beginExpiry}
      `
      expect(state).toEqual({
        consumed: false,
        forced: false,
        operations: 0,
        audits: 0,
      })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("rejects begin when its user advisory-lock wait crosses expiry", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginAdvisoryExpiry,
      userId: USERS.beginAdvisoryExpiry,
      sessionId: SESSIONS.beginAdvisoryExpiry,
      validForMilliseconds: 1_500,
    })
    let gateHeld = false
    let attempt: Promise<Outcome<RecoveryBeginRow>> | undefined

    try {
      await coordinator`
        select pg_advisory_lock(
          hashtextextended(${USERS.beginAdvisoryExpiry}::uuid::text, 1673)
        )
      `
      gateHeld = true
      attempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginAdvisoryExpiry,
          correlationId: CORRELATIONS.beginAdvisoryExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      const [release] = await coordinator<[{ unlocked: boolean }]>`
        select pg_advisory_unlock(
          hashtextextended(${USERS.beginAdvisoryExpiry}::uuid::text, 1673)
        ) as unlocked
      `
      expect(release.unlocked).toBe(true)
      gateHeld = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_grant_invalid")
      const [state] = await coordinator<
        [{ consumed: boolean; forced: boolean; operations: number }]
      >`
        select grant_row.consumed_at is not null as consumed,
               profile.must_change_password as forced,
               (select count(*)::integer
                  from private.auth_password_operations operation
                 where operation.target_user_id = grant_row.user_id) as operations
        from private.password_recovery_grants grant_row
        join public.profiles profile on profile.user_id = grant_row.user_id
        where grant_row.grant_hash = ${HASHES.beginAdvisoryExpiry}
      `
      expect(state).toEqual({ consumed: false, forced: false, operations: 0 })
    } finally {
      if (gateHeld) await coordinator`select pg_advisory_unlock_all()`
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("rejects begin when its profile-row lock crosses expiry", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginProfileExpiry,
      userId: USERS.beginProfileExpiry,
      sessionId: SESSIONS.beginProfileExpiry,
      validForMilliseconds: 1_500,
    })
    let blockerOpen = false
    let attempt: Promise<Outcome<RecoveryBeginRow>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator`
        select 1
        from public.profiles
        where user_id = ${USERS.beginProfileExpiry}::uuid
        for update
      `
      attempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginProfileExpiry,
          correlationId: CORRELATIONS.beginProfileExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_grant_invalid")
      const [state] = await coordinator<
        [{ consumed: boolean; forced: boolean; operations: number }]
      >`
        select grant_row.consumed_at is not null as consumed,
               profile.must_change_password as forced,
               (select count(*)::integer
                  from private.auth_password_operations operation
                 where operation.target_user_id = grant_row.user_id) as operations
        from private.password_recovery_grants grant_row
        join public.profiles profile on profile.user_id = grant_row.user_id
        where grant_row.grant_hash = ${HASHES.beginProfileExpiry}
      `
      expect(state).toEqual({ consumed: false, forced: false, operations: 0 })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("rolls begin back when its final audit insert crosses expiry", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginAuditExpiry,
      userId: USERS.beginAuditExpiry,
      sessionId: SESSIONS.beginAuditExpiry,
      validForMilliseconds: 1_500,
    })
    let blockerOpen = false
    let attempt: Promise<Outcome<RecoveryBeginRow>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator.unsafe("lock table public.audit_events in access exclusive mode")
      attempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginAuditExpiry,
          correlationId: CORRELATIONS.beginAuditExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_grant_invalid")
      const [state] = await coordinator<
        [{ consumed: boolean; forced: boolean; operations: number; audits: number }]
      >`
        select grant_row.consumed_at is not null as consumed,
               profile.must_change_password as forced,
               (select count(*)::integer
                  from private.auth_password_operations operation
                 where operation.target_user_id = grant_row.user_id) as operations,
               (select count(*)::integer
                  from public.audit_events audit
                 where audit.correlation_id = ${CORRELATIONS.beginAuditExpiry}::uuid)
                 as audits
        from private.password_recovery_grants grant_row
        join public.profiles profile on profile.user_id = grant_row.user_id
        where grant_row.grant_hash = ${HASHES.beginAuditExpiry}
      `
      expect(state).toEqual({
        consumed: false,
        forced: false,
        operations: 0,
        audits: 0,
      })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("orders the session parent before the grant child during session deletion", async () => {
    if (!recoveryAvailable) return
    await createGrant({
      sql: coordinator,
      grantHash: HASHES.sessionDelete,
      userId: USERS.sessionDelete,
      sessionId: SESSIONS.sessionDelete,
      validForMilliseconds: 300_000,
    })
    let gateHeld = false
    let attempt: Promise<Outcome<RecoveryBeginRow>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await coordinator`
        select pg_advisory_lock(
          hashtextextended(${USERS.sessionDelete}::uuid::text, 1673)
        )
      `
      gateHeld = true
      attempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.sessionDelete,
          correlationId: CORRELATIONS.sessionDelete,
        }),
      )
      await waitForLockWait(coordinator, workerAPid, WORKER_A_NAME)

      deletion = captureOutcome(async () => {
        await workerB`
          delete from auth.sessions
          where id = ${SESSIONS.sessionDelete}::uuid
        `
      })
      const deletionCompletedBeforeRelease = await Promise.race([
        deletion.then(() => true),
        delay(750).then(() => false),
      ])
      expect(deletionCompletedBeforeRelease).toBe(true)
      const deletionOutcome = await deletion
      expect(deletionOutcome.ok).toBe(true)

      const [release] = await coordinator<[{ unlocked: boolean }]>`
        select pg_advisory_unlock(
          hashtextextended(${USERS.sessionDelete}::uuid::text, 1673)
        ) as unlocked
      `
      expect(release.unlocked).toBe(true)
      gateHeld = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "28000", "password_recovery_grant_invalid")
      const [state] = await coordinator<
        [{ grants: number; forced: boolean; operations: number }]
      >`
        select
          (select count(*)::integer
             from private.password_recovery_grants grant_row
            where grant_row.user_id = profile.user_id) as grants,
          profile.must_change_password as forced,
          (select count(*)::integer
             from private.auth_password_operations operation
            where operation.target_user_id = profile.user_id) as operations
        from public.profiles profile
        where profile.user_id = ${USERS.sessionDelete}::uuid
      `
      expect(state).toEqual({ grants: 0, forced: false, operations: 0 })
    } finally {
      if (gateHeld) await coordinator`select pg_advisory_unlock_all()`
      if (deletion) await deletion.catch(() => undefined)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it.each([
    {
      label: "temporary reset",
      kind: "temporary_password_reset" as const,
      userId: USERS.expiredTemporary,
      sessionId: SESSIONS.expiredTemporary,
      grantHash: HASHES.expiredTemporary,
      operationId: OPERATIONS.expiredTemporary,
      priorCorrelation: CORRELATIONS.expiredTemporaryPrior,
      nextCorrelation: CORRELATIONS.expiredTemporaryNext,
    },
    {
      label: "recovery",
      kind: "password_recovery" as const,
      userId: USERS.expiredRecovery,
      sessionId: SESSIONS.expiredRecovery,
      grantHash: HASHES.expiredRecovery,
      operationId: OPERATIONS.expiredRecovery,
      priorCorrelation: CORRELATIONS.expiredRecoveryPrior,
      nextCorrelation: CORRELATIONS.expiredRecoveryNext,
    },
  ])(
    "reconciles an expired $label operation before reserving recovery",
    async (fixture) => {
      if (!recoveryAvailable) return
      await createGrant({
        sql: coordinator,
        grantHash: fixture.grantHash,
        userId: fixture.userId,
        sessionId: fixture.sessionId,
        validForMilliseconds: 300_000,
      })
      await createReservedRecoveryOperation({
        sql: coordinator,
        operationId: fixture.operationId,
        correlationId: fixture.priorCorrelation,
        userId: fixture.userId,
        validForMilliseconds: -1_000,
        kind: fixture.kind,
      })

      const operation = await beginRecovery({
        sql: workerA,
        grantHash: fixture.grantHash,
        correlationId: fixture.nextCorrelation,
      })
      expect(operation).toMatchObject({
        userId: fixture.userId,
        sessionId: fixture.sessionId,
      })
      const operations = await coordinator<
        Array<{
          id: string
          status: string
          reasonCode: string | null
          correlationId: string
        }>
      >`
        select id::text,
               status::text,
               reason_code as "reasonCode",
               correlation_id::text as "correlationId"
        from private.auth_password_operations
        where target_user_id = ${fixture.userId}::uuid
        order by reserved_at, id
      `
      expect(operations).toEqual([
        {
          id: fixture.operationId,
          status: "failed",
          reasonCode: "OPERATION_EXPIRED",
          correlationId: fixture.priorCorrelation,
        },
        {
          id: operation.operationId,
          status: "reserved",
          reasonCode: null,
          correlationId: fixture.nextCorrelation,
        },
      ])
      const [state] = await coordinator<
        [{ nonterminal: number; reconciled: number; reserved: number }]
      >`
        select
          count(*) filter (
            where operation.status in ('reserved','auth_updated')
          )::integer as nonterminal,
          (select count(*)::integer
             from public.audit_events audit
            where audit.correlation_id = ${fixture.priorCorrelation}::uuid
              and audit.action = 'auth.password_recovery_reconciled'
              and audit.reason_code = 'OPERATION_EXPIRED') as reconciled,
          (select count(*)::integer
             from public.audit_events audit
            where audit.correlation_id = ${fixture.nextCorrelation}::uuid
              and audit.action = 'auth.password_recovery_reserved') as reserved
        from private.auth_password_operations operation
        where operation.target_user_id = ${fixture.userId}::uuid
      `
      expect(state).toEqual({ nonterminal: 1, reconciled: 1, reserved: 1 })
    },
  )

  it("rejects a live password operation without consuming the recovery grant", async () => {
    if (!recoveryAvailable) return
    await createGrant({
      sql: coordinator,
      grantHash: HASHES.liveOperation,
      userId: USERS.liveOperation,
      sessionId: SESSIONS.liveOperation,
      validForMilliseconds: 300_000,
    })
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.liveOperation,
      correlationId: CORRELATIONS.liveOperationPrior,
      userId: USERS.liveOperation,
      validForMilliseconds: 300_000,
      kind: "temporary_password_reset",
    })

    const outcome = await captureOutcome(() =>
      beginRecovery({
        sql: workerA,
        grantHash: HASHES.liveOperation,
        correlationId: CORRELATIONS.liveOperationNext,
      }),
    )
    expectDatabaseFailure(
      outcome,
      "23505",
      "auth_password_operation_in_progress",
    )
    const [state] = await coordinator<
      [{ consumed: boolean; nonterminal: number; nextAudits: number }]
    >`
      select grant_row.consumed_at is not null as consumed,
             (select count(*)::integer
                from private.auth_password_operations operation
               where operation.target_user_id = grant_row.user_id
                 and operation.status in ('reserved','auth_updated')) as nonterminal,
             (select count(*)::integer
                from public.audit_events audit
               where audit.correlation_id = ${CORRELATIONS.liveOperationNext}::uuid)
               as "nextAudits"
      from private.password_recovery_grants grant_row
      where grant_row.grant_hash = ${HASHES.liveOperation}
    `
    expect(state).toEqual({ consumed: false, nonterminal: 1, nextAudits: 0 })
  })

  it("rejects complete when its operation-row lock crosses expiry", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.completeOperationExpiry,
      correlationId: CORRELATIONS.completeOperationExpiry,
      userId: USERS.completeOperationExpiry,
      validForMilliseconds: 1_500,
    })
    let blockerOpen = false
    let attempt: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator`
        select 1
        from private.auth_password_operations
        where id = ${OPERATIONS.completeOperationExpiry}::uuid
        for update
      `
      attempt = captureOutcome(() =>
        completeRecovery({
          sql: workerA,
          operationId: OPERATIONS.completeOperationExpiry,
          correlationId: CORRELATIONS.completeOperationExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "23514", "password_recovery_operation_invalid")
      const [state] = await coordinator<
        [{ status: string; forced: boolean; audits: number }]
      >`
        select operation.status::text as status,
               profile.must_change_password as forced,
               (select count(*)::integer
                  from public.audit_events audit
                 where audit.correlation_id = operation.correlation_id) as audits
        from private.auth_password_operations operation
        join public.profiles profile on profile.user_id = operation.target_user_id
        where operation.id = ${OPERATIONS.completeOperationExpiry}::uuid
      `
      expect(state).toEqual({ status: "reserved", forced: true, audits: 0 })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("rejects complete when its profile-row lock crosses expiry", async () => {
    if (!recoveryAvailable) return
    const expiresAt = await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.completeProfileExpiry,
      correlationId: CORRELATIONS.completeProfileExpiry,
      userId: USERS.completeProfileExpiry,
      validForMilliseconds: 1_500,
    })
    let blockerOpen = false
    let attempt: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator`
        select 1
        from public.profiles
        where user_id = ${USERS.completeProfileExpiry}::uuid
        for update
      `
      attempt = captureOutcome(() =>
        completeRecovery({
          sql: workerA,
          operationId: OPERATIONS.completeProfileExpiry,
          correlationId: CORRELATIONS.completeProfileExpiry,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      await waitUntilExpired(workerB, expiresAt)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const outcome = await attempt
      expectDatabaseFailure(outcome, "23514", "password_recovery_operation_invalid")
      const [state] = await coordinator<
        [{ status: string; forced: boolean; audits: number }]
      >`
        select operation.status::text as status,
               profile.must_change_password as forced,
               (select count(*)::integer
                  from public.audit_events audit
                 where audit.correlation_id = operation.correlation_id) as audits
        from private.auth_password_operations operation
        join public.profiles profile on profile.user_id = operation.target_user_id
        where operation.id = ${OPERATIONS.completeProfileExpiry}::uuid
      `
      expect(state).toEqual({ status: "reserved", forced: true, audits: 0 })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (attempt) await attempt.catch(() => undefined)
    }
  })

  it("serializes begin reconciliation against tenant-company deletion", async () => {
    if (!recoveryAvailable) return
    await createGrant({
      sql: coordinator,
      grantHash: HASHES.beginCompanyDelete,
      userId: USERS.beginCompanyDelete,
      sessionId: SESSIONS.beginCompanyDelete,
      validForMilliseconds: 300_000,
    })
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.beginCompanyPrior,
      correlationId: CORRELATIONS.beginCompanyPrior,
      userId: USERS.beginCompanyDelete,
      validForMilliseconds: -1_000,
      kind: "temporary_password_reset",
      companyId: COMPANIES.beginDelete,
    })
    let blockerOpen = false
    let beginAttempt: Promise<Outcome<RecoveryBeginRow>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator.unsafe("lock table public.audit_events in access exclusive mode")
      beginAttempt = captureOutcome(() =>
        beginRecovery({
          sql: workerA,
          grantHash: HASHES.beginCompanyDelete,
          correlationId: CORRELATIONS.beginCompanyNext,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      deletion = captureOutcome(() =>
        deleteTenantCompany({
          sql: workerB,
          membershipId: MEMBERSHIPS.beginDelete,
          companyId: COMPANIES.beginDelete,
        }),
      )
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const [beginOutcome, deletionOutcome] = await Promise.all([
        beginAttempt,
        deletion,
      ])
      expect(beginOutcome.ok).toBe(true)
      expectDatabaseCode(deletionOutcome, "23503")
      const [state] = await coordinator<
        [{ company: boolean; membership: boolean; nonterminal: number }]
      >`
        select
          exists (
            select 1 from public.companies
            where id = ${COMPANIES.beginDelete}::uuid
          ) as company,
          exists (
            select 1 from public.company_memberships
            where id = ${MEMBERSHIPS.beginDelete}::uuid
          ) as membership,
          (select count(*)::integer
             from private.auth_password_operations operation
            where operation.target_user_id = ${USERS.beginCompanyDelete}::uuid
              and operation.status in ('reserved','auth_updated')) as nonterminal
      `
      expect(state).toEqual({ company: true, membership: true, nonterminal: 1 })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (deletion) await deletion.catch(() => undefined)
      if (beginAttempt) await beginAttempt.catch(() => undefined)
    }
  })

  it("serializes complete against tenant-company deletion", async () => {
    if (!recoveryAvailable) return
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.completeCompanyDelete,
      correlationId: CORRELATIONS.completeCompanyDelete,
      userId: USERS.completeCompanyDelete,
      validForMilliseconds: 300_000,
      companyId: COMPANIES.completeDelete,
    })
    let blockerOpen = false
    let completion: Promise<Outcome<void>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator.unsafe("lock table public.audit_events in access exclusive mode")
      completion = captureOutcome(() =>
        completeRecovery({
          sql: workerA,
          operationId: OPERATIONS.completeCompanyDelete,
          correlationId: CORRELATIONS.completeCompanyDelete,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      deletion = captureOutcome(() =>
        deleteTenantCompany({
          sql: workerB,
          membershipId: MEMBERSHIPS.completeDelete,
          companyId: COMPANIES.completeDelete,
        }),
      )
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const [completionOutcome, deletionOutcome] = await Promise.all([
        completion,
        deletion,
      ])
      expect(completionOutcome.ok).toBe(true)
      expectDatabaseCode(deletionOutcome, "23503")
      const [state] = await coordinator<
        [{ company: boolean; membership: boolean; status: string }]
      >`
        select
          exists (
            select 1 from public.companies
            where id = ${COMPANIES.completeDelete}::uuid
          ) as company,
          exists (
            select 1 from public.company_memberships
            where id = ${MEMBERSHIPS.completeDelete}::uuid
          ) as membership,
          operation.status::text as status
        from private.auth_password_operations operation
        where operation.id = ${OPERATIONS.completeCompanyDelete}::uuid
      `
      expect(state).toEqual({ company: true, membership: true, status: "completed" })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (deletion) await deletion.catch(() => undefined)
      if (completion) await completion.catch(() => undefined)
    }
  })

  it("serializes fail against tenant-company deletion", async () => {
    if (!recoveryAvailable) return
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.failCompanyDelete,
      correlationId: CORRELATIONS.failCompanyDelete,
      userId: USERS.failCompanyDelete,
      validForMilliseconds: 300_000,
      companyId: COMPANIES.failDelete,
    })
    let blockerOpen = false
    let failure: Promise<Outcome<void>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator.unsafe("lock table public.audit_events in access exclusive mode")
      failure = captureOutcome(() =>
        failRecovery({
          sql: workerA,
          operationId: OPERATIONS.failCompanyDelete,
          correlationId: CORRELATIONS.failCompanyDelete,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      deletion = captureOutcome(() =>
        deleteTenantCompany({
          sql: workerB,
          membershipId: MEMBERSHIPS.failDelete,
          companyId: COMPANIES.failDelete,
        }),
      )
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const [failureOutcome, deletionOutcome] = await Promise.all([
        failure,
        deletion,
      ])
      expect(failureOutcome.ok).toBe(true)
      expectDatabaseCode(deletionOutcome, "23503")
      const [state] = await coordinator<
        [{ company: boolean; membership: boolean; status: string }]
      >`
        select
          exists (
            select 1 from public.companies
            where id = ${COMPANIES.failDelete}::uuid
          ) as company,
          exists (
            select 1 from public.company_memberships
            where id = ${MEMBERSHIPS.failDelete}::uuid
          ) as membership,
          operation.status::text as status
        from private.auth_password_operations operation
        where operation.id = ${OPERATIONS.failCompanyDelete}::uuid
      `
      expect(state).toEqual({ company: true, membership: true, status: "failed" })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (deletion) await deletion.catch(() => undefined)
      if (failure) await failure.catch(() => undefined)
    }
  })

  it("keeps complete parent-first against concurrent profile deletion", async () => {
    if (!recoveryAvailable) return
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.completeProfileDelete,
      correlationId: CORRELATIONS.completeProfileDelete,
      userId: USERS.completeProfileDelete,
      validForMilliseconds: 300_000,
    })
    let gateHeld = false
    let completion: Promise<Outcome<void>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await coordinator`
        select pg_advisory_lock(
          hashtextextended(${USERS.completeProfileDelete}::uuid::text, 1673)
        )
      `
      gateHeld = true
      completion = captureOutcome(() =>
        completeRecovery({
          sql: workerA,
          operationId: OPERATIONS.completeProfileDelete,
          correlationId: CORRELATIONS.completeProfileDelete,
        }),
      )
      await waitForLockWait(coordinator, workerAPid, WORKER_A_NAME)

      deletion = captureOutcome(async () => {
        await workerB`
          delete from public.profiles
          where user_id = ${USERS.completeProfileDelete}::uuid
        `
      })
      const deletionCompletedBeforeRelease = await Promise.race([
        deletion.then(() => true),
        delay(750).then(() => false),
      ])
      expect(deletionCompletedBeforeRelease).toBe(true)
      const deletionOutcome = await deletion
      expectDatabaseCode(deletionOutcome, "23503")

      const [release] = await coordinator<[{ unlocked: boolean }]>`
        select pg_advisory_unlock(
          hashtextextended(${USERS.completeProfileDelete}::uuid::text, 1673)
        ) as unlocked
      `
      expect(release.unlocked).toBe(true)
      gateHeld = false

      const completionOutcome = await completion
      expectDatabaseFailure(
        completionOutcome,
        "23514",
        "password_recovery_operation_invalid",
      )
      const [state] = await coordinator<[{ status: string; forced: boolean }]>`
        select operation.status::text as status,
               profile.must_change_password as forced
        from private.auth_password_operations operation
        join public.profiles profile on profile.user_id = operation.target_user_id
        where operation.id = ${OPERATIONS.completeProfileDelete}::uuid
      `
      expect(state).toEqual({ status: "reserved", forced: true })
    } finally {
      if (gateHeld) await coordinator`select pg_advisory_unlock_all()`
      if (deletion) await deletion.catch(() => undefined)
      if (completion) await completion.catch(() => undefined)
    }
  })

  it("keeps fail parent-first against concurrent profile deletion", async () => {
    if (!recoveryAvailable) return
    await createReservedRecoveryOperation({
      sql: coordinator,
      operationId: OPERATIONS.failProfileDelete,
      correlationId: CORRELATIONS.failProfileDelete,
      userId: USERS.failProfileDelete,
      validForMilliseconds: 300_000,
    })
    let blockerOpen = false
    let failure: Promise<Outcome<void>> | undefined
    let deletion: Promise<Outcome<void>> | undefined

    try {
      await beginBoundedTransaction(coordinator)
      blockerOpen = true
      await coordinator.unsafe("lock table public.audit_events in access exclusive mode")
      failure = captureOutcome(() =>
        failRecovery({
          sql: workerA,
          operationId: OPERATIONS.failProfileDelete,
          correlationId: CORRELATIONS.failProfileDelete,
        }),
      )
      await waitForLockWait(workerB, workerAPid, WORKER_A_NAME)
      deletion = captureOutcome(async () => {
        await workerB`
          delete from public.profiles
          where user_id = ${USERS.failProfileDelete}::uuid
        `
      })
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await coordinator.unsafe("rollback")
      blockerOpen = false

      const [failureOutcome, deletionOutcome] = await Promise.all([
        failure,
        deletion,
      ])
      expect(failureOutcome.ok).toBe(true)
      expectDatabaseCode(deletionOutcome, "23503")
      const [state] = await coordinator<[{ status: string; forced: boolean }]>`
        select operation.status::text as status,
               profile.must_change_password as forced
        from private.auth_password_operations operation
        join public.profiles profile on profile.user_id = operation.target_user_id
        where operation.id = ${OPERATIONS.failProfileDelete}::uuid
      `
      expect(state).toEqual({ status: "failed", forced: true })
    } finally {
      if (blockerOpen) await rollbackQuietly(coordinator)
      if (deletion) await deletion.catch(() => undefined)
      if (failure) await failure.catch(() => undefined)
    }
  })
})
