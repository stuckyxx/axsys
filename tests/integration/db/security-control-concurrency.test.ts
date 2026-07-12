import { loadEnvFile } from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may inject DATABASE_URL directly.
  }
}

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const WORKER_A_NAME = "axsys-security-control-race-a"
const WORKER_B_NAME = "axsys-security-control-race-b"
const COORDINATOR_NAME = "axsys-security-control-race-coordinator"
const LOCK_TIMEOUT_MS = 6_000
const STATEMENT_TIMEOUT_MS = 10_000
const IDLE_TRANSACTION_TIMEOUT_MS = 10_000
const WAIT_TIMEOUT_MS = 3_000
const INSERT_RACE_KEY = "a".repeat(64)
const LIMIT_RACE_KEY = "b".repeat(64)
const WAITED_ROW_KEY = "c".repeat(64)

const USERS = {
  registerLogout: "71000000-0000-4000-8000-000000000001",
  rotateRotate: "71000000-0000-4000-8000-000000000002",
  rotateLogout: "71000000-0000-4000-8000-000000000003",
  cutoffRegister: "71000000-0000-4000-8000-000000000004",
  activation: "71000000-0000-4000-8000-000000000005",
  authNotAfter: "71000000-0000-4000-8000-000000000006",
  profileDeactivate: "71000000-0000-4000-8000-000000000007",
  companyArchive: "71000000-0000-4000-8000-000000000008",
  platformRoleDeactivate: "71000000-0000-4000-8000-000000000009",
  temporaryPasswordExpiry: "71000000-0000-4000-8000-000000000010",
} as const

const SESSIONS = {
  registerLogoutActive: "72000000-0000-4000-8000-000000000001",
  registerLogoutCandidate: "72000000-0000-4000-8000-000000000002",
  rotateRotateOld: "72000000-0000-4000-8000-000000000003",
  rotateRotateNewA: "72000000-0000-4000-8000-000000000004",
  rotateRotateNewB: "72000000-0000-4000-8000-000000000005",
  rotateLogoutOld: "72000000-0000-4000-8000-000000000006",
  rotateLogoutNew: "72000000-0000-4000-8000-000000000007",
  cutoffRegisterCandidate: "72000000-0000-4000-8000-000000000008",
  activationPending: "72000000-0000-4000-8000-000000000009",
  authNotAfterPending: "72000000-0000-4000-8000-000000000010",
  profileDeactivatePending: "72000000-0000-4000-8000-000000000011",
  companyArchiveOld: "72000000-0000-4000-8000-000000000012",
  companyArchiveNew: "72000000-0000-4000-8000-000000000013",
  platformRoleDeactivatePending: "72000000-0000-4000-8000-000000000014",
  temporaryPasswordExpiryPending: "72000000-0000-4000-8000-000000000015",
} as const

const CORRELATIONS = {
  registerLogoutLogin: "73000000-0000-4000-8000-000000000001",
  registerLogoutRace: "73000000-0000-4000-8000-000000000002",
  rotateRotateLogin: "73000000-0000-4000-8000-000000000003",
  rotateRotateRaceA: "73000000-0000-4000-8000-000000000004",
  rotateRotateRaceB: "73000000-0000-4000-8000-000000000005",
  rotateLogoutLogin: "73000000-0000-4000-8000-000000000006",
  rotateLogoutRace: "73000000-0000-4000-8000-000000000007",
  activationA: "73000000-0000-4000-8000-000000000008",
  activationB: "73000000-0000-4000-8000-000000000009",
  profileDeactivateLogin: "73000000-0000-4000-8000-000000000010",
  companyArchiveLogin: "73000000-0000-4000-8000-000000000011",
  companyArchiveRotate: "73000000-0000-4000-8000-000000000012",
  platformRoleDeactivateLogin: "73000000-0000-4000-8000-000000000013",
  temporaryPasswordExpiryFailClosed: "73000000-0000-4000-8000-000000000014",
} as const

const COMPANIES = {
  archive: "74000000-0000-4000-8000-000000000001",
} as const

const MEMBERSHIPS = {
  archive: "75000000-0000-4000-8000-000000000001",
} as const

const ALL_USERS = Object.values(USERS)
const ALL_SESSIONS = Object.values(SESSIONS)
const ALL_COMPANIES = Object.values(COMPANIES)
const ALL_MEMBERSHIPS = Object.values(MEMBERSHIPS)
const ALL_RATE_KEYS = [INSERT_RACE_KEY, LIMIT_RACE_KEY, WAITED_ROW_KEY]

type RateLimitDecisionRow = {
  allowed: boolean
  attempts: number
  retry_after_seconds: number
}

type Outcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }

function requireLocalAdminDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("Security-control concurrency database is unavailable")

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Security-control concurrency database is unavailable")
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
    throw new Error("Security-control concurrency database is unavailable")
  }

  return url.toString()
}

const databaseUrl = requireLocalAdminDatabaseUrl(process.env.DATABASE_URL)
const workerA = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 30,
  max_lifetime: null,
  connection: {
    application_name: WORKER_A_NAME,
    lock_timeout: LOCK_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_TRANSACTION_TIMEOUT_MS,
  },
})
const workerB = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 30,
  max_lifetime: null,
  connection: {
    application_name: WORKER_B_NAME,
    lock_timeout: LOCK_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_TRANSACTION_TIMEOUT_MS,
  },
})
const coordinator = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 30,
  max_lifetime: null,
  connection: {
    application_name: COORDINATOR_NAME,
    lock_timeout: LOCK_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_TRANSACTION_TIMEOUT_MS,
  },
})

let securityControlAvailable = false
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
  throw new Error("Expected PostgreSQL lock wait was not observed")
}

async function deleteRateBucket(keyHash: string): Promise<void> {
  await workerA`
    delete from private.rate_limit_buckets
    where key_hash = ${keyHash}
  `
}

async function captureOutcome<T>(statement: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await statement() }
  } catch (error) {
    return { ok: false, error }
  }
}

function expectConstraintFailure(outcome: Outcome, message: string): void {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) {
    const databaseError = outcome.error as Error & { code?: string }
    expect(databaseError.code).toBe("23514")
    expect(databaseError.message).toBe(message)
    expect(databaseError.code).not.toBe("40P01")
    expect(databaseError.code).not.toBe("55P03")
    expect(databaseError.code).not.toBe("57014")
  }
}

async function createProfileUser(
  sql: Sql,
  userId: string,
  email: string,
): Promise<void> {
  await sql`
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      ${userId}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      ${email},
      '',
      clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      clock_timestamp(),
      clock_timestamp()
    )
  `
  await sql`
    insert into public.profiles (user_id, email, display_name)
    values (${userId}::uuid, ${email}, ${email.split("@")[0]})
  `
}

async function createPlatformUser(
  sql: Sql,
  userId: string,
  email: string,
): Promise<void> {
  await createProfileUser(sql, userId, email)
  await sql`
    insert into public.platform_roles (user_id)
    values (${userId}::uuid)
  `
}

async function createTenantUser(input: {
  sql: Sql
  userId: string
  email: string
  companyId: string
  membershipId: string
}): Promise<void> {
  await createProfileUser(input.sql, input.userId, input.email)
  await input.sql`
    insert into public.companies (
      id, legal_name, cnpj_normalized, contact_email
    ) values (
      ${input.companyId}::uuid,
      'Empresa Archive Race',
      '71000000000001',
      'archive-race-company@example.test'
    )
  `
  await input.sql`
    insert into public.company_memberships (id, company_id, user_id, role)
    values (
      ${input.membershipId}::uuid,
      ${input.companyId}::uuid,
      ${input.userId}::uuid,
      'company_admin'
    )
  `
}

async function createAuthSession(
  sql: Sql,
  sessionId: string,
  userId: string,
  ageSeconds: number,
): Promise<void> {
  await sql`
    insert into auth.sessions (id, user_id, created_at, updated_at)
    values (
      ${sessionId}::uuid,
      ${userId}::uuid,
      clock_timestamp() - make_interval(secs => ${ageSeconds}),
      clock_timestamp() - make_interval(secs => ${ageSeconds})
    )
  `
}

async function registerSession(
  sql: Sql,
  sessionId: string,
  userId: string,
): Promise<void> {
  await sql`
    select private.register_auth_session(
      ${sessionId}::uuid,
      ${userId}::uuid,
      false
    )
  `
}

async function writeLoginAudit(
  sql: Sql,
  sessionId: string,
  userId: string,
  correlationId: string,
): Promise<void> {
  await sql`
    select private.write_authenticated_audit_event(
      ${userId}::uuid,
      ${sessionId}::uuid,
      'auth.login',
      'session',
      null::uuid,
      'success'::public.audit_outcome,
      null::text,
      ${correlationId}::uuid,
      null::text,
      null::text,
      '{"rememberMe":false}'::jsonb
    )
  `
}

async function classifyExpiredTemporaryPassword(
  sql: Sql,
  sessionId: string,
  userId: string,
  correlationId: string,
): Promise<void> {
  await sql`
    select private.fail_closed_login_session(
      ${userId}::uuid,
      ${sessionId}::uuid,
      'TEMPORARY_PASSWORD_EXPIRED',
      ${correlationId}::uuid
    )
  `
}

async function createActiveSession(input: {
  sql: Sql
  sessionId: string
  userId: string
  correlationId: string
  ageSeconds: number
}): Promise<void> {
  await createAuthSession(
    input.sql,
    input.sessionId,
    input.userId,
    input.ageSeconds,
  )
  await registerSession(input.sql, input.sessionId, input.userId)
  await writeLoginAudit(
    input.sql,
    input.sessionId,
    input.userId,
    input.correlationId,
  )
}

async function cleanupSecurityFixtures(sql: Sql): Promise<void> {
  const [catalog] = await sql<[{ available: boolean }]>`
    select to_regclass('public.audit_events') is not null
      and to_regclass('private.auth_session_controls') is not null as available
  `
  if (!catalog.available) return

  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
      await transaction.unsafe(
        `set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`,
      )
      await transaction.unsafe(
        `set local idle_in_transaction_session_timeout = '${IDLE_TRANSACTION_TIMEOUT_MS}ms'`,
      )
      const [owner] = await transaction<[{ valid: boolean }]>`
        select current_user = 'postgres' as valid
      `
      if (!owner.valid) {
        throw new Error("Security-control cleanup requires the migration owner")
      }

      await transaction.unsafe(
        "lock table public.audit_events in access exclusive mode",
      )
      const [trigger] = await transaction<[{ enabled: string }]>`
        select tgenabled as enabled
        from pg_trigger
        where tgrelid = 'public.audit_events'::regclass
          and tgname = 'audit_events_append_only'
          and not tgisinternal
      `
      if (trigger?.enabled !== "O") {
        throw new Error("Audit append-only trigger must be enabled before cleanup")
      }
      await transaction.unsafe(
        "alter table public.audit_events disable trigger audit_events_append_only",
      )
      await transaction`
        delete from public.audit_events
        where actor_user_id = any(${ALL_USERS}::uuid[])
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
        throw new Error("Audit append-only trigger was not restored")
      }

      await transaction.unsafe(
        "lock table public.company_memberships in access exclusive mode",
      )
      const [adminTrigger] = await transaction<[{ enabled: string }]>`
        select tgenabled as enabled
        from pg_trigger
        where tgrelid = 'public.company_memberships'::regclass
          and tgname = 'protect_last_company_admin'
          and not tgisinternal
      `
      if (adminTrigger?.enabled !== "O") {
        throw new Error("Last-company-admin trigger must be enabled before cleanup")
      }
      await transaction.unsafe(
        "alter table public.company_memberships disable trigger protect_last_company_admin",
      )
      await transaction`
        delete from public.member_modules
        where membership_id = any(${ALL_MEMBERSHIPS}::uuid[])
      `
      await transaction`
        delete from public.company_memberships
        where id = any(${ALL_MEMBERSHIPS}::uuid[])
      `
      await transaction.unsafe(
        "alter table public.company_memberships enable trigger protect_last_company_admin",
      )
      const [restoredAdminTrigger] = await transaction<[{ enabled: string }]>`
        select tgenabled as enabled
        from pg_trigger
        where tgrelid = 'public.company_memberships'::regclass
          and tgname = 'protect_last_company_admin'
          and not tgisinternal
      `
      if (restoredAdminTrigger?.enabled !== "O") {
        throw new Error("Last-company-admin trigger was not restored")
      }

      await transaction`
        delete from private.rate_limit_buckets
        where key_hash = any(${ALL_RATE_KEYS}::text[])
      `
      await transaction`
        delete from auth.sessions
        where id = any(${ALL_SESSIONS}::uuid[])
      `
      await transaction`
        delete from private.auth_user_session_cutoffs
        where user_id = any(${ALL_USERS}::uuid[])
      `
      await transaction`
        delete from public.platform_roles
        where user_id = any(${ALL_USERS}::uuid[])
      `
      await transaction`
        delete from private.company_storage_usage
        where company_id = any(${ALL_COMPANIES}::uuid[])
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
          + (select count(*) from private.rate_limit_buckets
            where key_hash = any(${ALL_RATE_KEYS}::text[]))
          + (select count(*) from private.auth_session_controls
            where user_id = any(${ALL_USERS}::uuid[]))
          + (select count(*) from private.auth_user_session_cutoffs
            where user_id = any(${ALL_USERS}::uuid[]))
          + (select count(*) from auth.sessions
            where id = any(${ALL_SESSIONS}::uuid[]))
          + (select count(*) from public.platform_roles
            where user_id = any(${ALL_USERS}::uuid[]))
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
        throw new Error("Security-control cleanup left fixture rows")
      }
    })
  } catch (error) {
    const triggerStates = await sql<Array<{ name: string; enabled: string }>>`
      select tgname as name, tgenabled as enabled
      from pg_trigger
      where (tgrelid, tgname) in (
        ('public.audit_events'::regclass, 'audit_events_append_only'),
        ('public.company_memberships'::regclass, 'protect_last_company_admin')
      )
        and not tgisinternal
      order by tgname
    `
    if (
      triggerStates.length !== 2 ||
      triggerStates.some((trigger) => trigger.enabled !== "O")
    ) {
      throw new AggregateError(
        [error],
        "Security-control cleanup rollback did not preserve its trigger",
      )
    }
    throw error
  }
}

beforeAll(async () => {
  const [[identityA], [identityB], [identityCoordinator]] = await Promise.all([
    workerA<
      [{
        owner: boolean
        available: boolean
        pid: number
        applicationName: string
        serverVersion: number
      }]
    >`
      select
        current_user = 'postgres' as owner,
        to_regclass('public.audit_events') is not null
          and to_regclass('public.security_events') is not null
          and to_regclass('public.idempotency_keys') is not null
          and to_regclass('private.rate_limit_policies') is not null
          and to_regclass('private.rate_limit_buckets') is not null
          and to_regclass('private.auth_user_session_cutoffs') is not null
          and to_regclass('private.auth_session_controls') is not null
          and to_regprocedure(
            'private.consume_rate_limit(text,text,integer,integer,integer)'
          ) is not null
          and to_regprocedure(
            'private.register_auth_session(uuid,uuid,boolean)'
          ) is not null
          and to_regprocedure(
            'private.write_authenticated_audit_event(uuid,uuid,text,text,uuid,public.audit_outcome,text,uuid,text,text,jsonb)'
          ) is not null
          and to_regprocedure(
            'private.revoke_sessions_and_write_logout(uuid,uuid,uuid,text,text)'
          ) is not null
          and to_regprocedure(
            'private.rotate_app_session_after_reauthentication(uuid,uuid,uuid,uuid)'
          ) is not null as available,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName",
        current_setting('server_version_num')::integer as "serverVersion"
    `,
    workerB<[{ owner: boolean; pid: number; applicationName: string }]>`
      select
        current_user = 'postgres' as owner,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName"
    `,
    coordinator<[{ owner: boolean; pid: number; applicationName: string }]>`
      select
        current_user = 'postgres' as owner,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName"
    `,
  ])

  if (
    !identityA.owner ||
    !identityB.owner ||
    !identityCoordinator.owner ||
    identityA.pid === identityB.pid ||
    identityA.pid === identityCoordinator.pid ||
    identityB.pid === identityCoordinator.pid ||
    identityA.applicationName !== WORKER_A_NAME ||
    identityB.applicationName !== WORKER_B_NAME ||
    identityCoordinator.applicationName !== COORDINATOR_NAME ||
    identityA.serverVersion < 170000 ||
    identityA.serverVersion >= 180000
  ) {
    throw new Error("Security-control concurrency database is unavailable")
  }

  securityControlAvailable = identityA.available
  workerAPid = identityA.pid
  workerBPid = identityB.pid
  coordinatorPid = identityCoordinator.pid
  if (securityControlAvailable) await cleanupSecurityFixtures(workerA)
})

afterAll(async () => {
  const teardownErrors: unknown[] = []
  try {
    const rollbackResults = await Promise.allSettled([
      rollbackQuietly(workerA),
      rollbackQuietly(workerB),
      rollbackQuietly(coordinator),
    ])
    for (const result of rollbackResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }

    const unlockResults = await Promise.allSettled([
      workerA`select pg_advisory_unlock_all()`,
      workerB`select pg_advisory_unlock_all()`,
      coordinator`select pg_advisory_unlock_all()`,
    ])
    for (const result of unlockResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }

    if (securityControlAvailable) {
      try {
        await cleanupSecurityFixtures(workerA)
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
        const connectionStates = await workerA<
          Array<{ applicationName: string; state: string; transactionOpen: boolean }>
        >`
          select
            application_name as "applicationName",
            state,
            xact_start is not null as "transactionOpen"
          from pg_stat_activity
          where pid in (${workerBPid}, ${coordinatorPid})
          order by application_name
        `
        expect(connectionStates).toEqual([
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
      "Security-control concurrency teardown failed",
    )
  }
})

describe.sequential("security controls under concurrent writes", () => {
  it("requires the committed security-control migration before running races", () => {
    expect(securityControlAvailable).toBe(true)
  })

  it("serializes two first attempts that race to insert the same rate bucket", async () => {
    if (!securityControlAvailable) return
    let gateTransactionOpen = false
    let attemptA: Promise<RateLimitDecisionRow[]> | undefined
    let attemptB: Promise<RateLimitDecisionRow[]> | undefined
    await deleteRateBucket(INSERT_RACE_KEY)

    try {
      await beginBoundedTransaction(coordinator)
      gateTransactionOpen = true
      await coordinator.unsafe(
        "lock table private.rate_limit_buckets in share mode",
      )
      attemptA = workerA<RateLimitDecisionRow[]>`
        select allowed, attempts, retry_after_seconds
        from private.consume_rate_limit(
          'login-account-failure',
          ${INSERT_RACE_KEY},
          5,
          900,
          900
        )
      `.then((rows) => rows)
      attemptB = workerB<RateLimitDecisionRow[]>`
        select allowed, attempts, retry_after_seconds
        from private.consume_rate_limit(
          'login-account-failure',
          ${INSERT_RACE_KEY},
          5,
          900,
          900
        )
      `.then((rows) => rows)
      await Promise.all([
        waitForLockWait(coordinator, workerAPid, WORKER_A_NAME),
        waitForLockWait(coordinator, workerBPid, WORKER_B_NAME),
      ])
      await coordinator.unsafe("commit")
      gateTransactionOpen = false

      const [decisionA, decisionB] = await Promise.all([attemptA, attemptB])

      expect([...decisionA, ...decisionB].sort((left, right) =>
        left.attempts - right.attempts,
      )).toEqual([
        { allowed: true, attempts: 1, retry_after_seconds: 0 },
        { allowed: true, attempts: 2, retry_after_seconds: 0 },
      ])

      const [persisted] = await workerA<[{ attempts: number }]>`
        select attempts
        from private.rate_limit_buckets
        where bucket = 'login-account-failure'
          and key_hash = ${INSERT_RACE_KEY}
      `
      expect(persisted.attempts).toBe(2)
    } finally {
      if (gateTransactionOpen) await rollbackQuietly(coordinator)
      if (attemptA) await attemptA.catch(() => undefined)
      if (attemptB) await attemptB.catch(() => undefined)
      await deleteRateBucket(INSERT_RACE_KEY)
    }

    const [residue] = await workerA<[{ count: number }]>`
      select count(*)::integer as count
      from private.rate_limit_buckets
      where bucket = 'login-account-failure'
        and key_hash = ${INSERT_RACE_KEY}
    `
    expect(residue.count).toBe(0)
  }, 20_000)

  it("allows exactly N concurrent attempts and blocks N plus one", async () => {
    if (!securityControlAvailable) return
    await deleteRateBucket(LIMIT_RACE_KEY)

    try {
      const decisions = await Promise.all(
        Array.from({ length: 6 }, (_, index) => {
          const sql = index % 2 === 0 ? workerA : workerB
          return sql<RateLimitDecisionRow[]>`
            select allowed, attempts, retry_after_seconds
            from private.consume_rate_limit(
              'login-account-failure',
              ${LIMIT_RACE_KEY},
              5,
              900,
              900
            )
          `.then(([decision]) => decision)
        }),
      )

      expect(decisions.sort((left, right) => left.attempts - right.attempts)).toEqual([
        { allowed: true, attempts: 1, retry_after_seconds: 0 },
        { allowed: true, attempts: 2, retry_after_seconds: 0 },
        { allowed: true, attempts: 3, retry_after_seconds: 0 },
        { allowed: true, attempts: 4, retry_after_seconds: 0 },
        { allowed: true, attempts: 5, retry_after_seconds: 0 },
        { allowed: false, attempts: 6, retry_after_seconds: 900 },
      ])

      const [persisted] = await workerA<
        [{ attempts: number; blocked: boolean }]
      >`
        select attempts, blocked_until > clock_timestamp() as blocked
        from private.rate_limit_buckets
        where bucket = 'login-account-failure'
          and key_hash = ${LIMIT_RACE_KEY}
      `
      expect(persisted).toEqual({ attempts: 6, blocked: true })
    } finally {
      await deleteRateBucket(LIMIT_RACE_KEY)
    }
  }, 20_000)

  it("captures the rate timestamp only after a waited row lock", async () => {
    if (!securityControlAvailable) return
    let holderTransactionOpen = false
    let waiter: Promise<RateLimitDecisionRow[]> | undefined
    await deleteRateBucket(WAITED_ROW_KEY)

    try {
      await workerA`
        insert into private.rate_limit_buckets (
          bucket,
          key_hash,
          attempts,
          window_started_at,
          blocked_until,
          updated_at
        ) values (
          'login-account-failure',
          ${WAITED_ROW_KEY},
          1,
          clock_timestamp(),
          null,
          clock_timestamp()
        )
      `
      await beginBoundedTransaction(workerA)
      holderTransactionOpen = true
      await workerA`
        select 1
        from private.rate_limit_buckets
        where bucket = 'login-account-failure'
          and key_hash = ${WAITED_ROW_KEY}
        for update
      `

      waiter = workerB<RateLimitDecisionRow[]>`
        select allowed, attempts, retry_after_seconds
        from private.consume_rate_limit(
          'login-account-failure',
          ${WAITED_ROW_KEY},
          5,
          900,
          900
        )
      `.then((rows) => rows)
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await delay(1_250)
      const [release] = await workerA<[{ releasedAt: Date }]>`
        update private.rate_limit_buckets
        set window_started_at = clock_timestamp() - interval '900.5 seconds',
            updated_at = clock_timestamp()
        where bucket = 'login-account-failure'
          and key_hash = ${WAITED_ROW_KEY}
        returning clock_timestamp() as "releasedAt"
      `
      await workerA.unsafe("commit")
      holderTransactionOpen = false

      const [decision] = await waiter
      expect(decision).toEqual({
        allowed: true,
        attempts: 1,
        retry_after_seconds: 0,
      })
      const [persisted] = await workerA<
        [{ attempts: number; windowStartedAt: Date }]
      >`
        select attempts, window_started_at as "windowStartedAt"
        from private.rate_limit_buckets
        where bucket = 'login-account-failure'
          and key_hash = ${WAITED_ROW_KEY}
      `
      expect(persisted.attempts).toBe(1)
      expect(persisted.windowStartedAt.getTime()).toBeGreaterThanOrEqual(
        release.releasedAt.getTime(),
      )
    } finally {
      if (holderTransactionOpen) await rollbackQuietly(workerA)
      if (waiter) await waiter.catch(() => undefined)
      await deleteRateBucket(WAITED_ROW_KEY)
    }
  }, 20_000)

  it("holds FOR SHARE so a concurrent Auth not_after update must wait", async () => {
    if (!securityControlAvailable) return
    let registrationTransactionOpen = false
    let notAfterUpdate: Promise<Outcome<Array<{ notAfter: Date }>>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.authNotAfter,
        "auth-not-after-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.authNotAfterPending,
        USERS.authNotAfter,
        30,
      )

      await beginBoundedTransaction(workerA)
      registrationTransactionOpen = true
      await registerSession(
        workerA,
        SESSIONS.authNotAfterPending,
        USERS.authNotAfter,
      )
      notAfterUpdate = captureOutcome(() => workerB<Array<{ notAfter: Date }>>`
        update auth.sessions
        set not_after = clock_timestamp() + interval '5 minutes'
        where id = ${SESSIONS.authNotAfterPending}::uuid
        returning not_after as "notAfter"
      `)
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      registrationTransactionOpen = false

      const updateOutcome = await notAfterUpdate
      expect(updateOutcome.ok).toBe(true)
      if (updateOutcome.ok) {
        expect(updateOutcome.value).toHaveLength(1)
        expect(updateOutcome.value[0]?.notAfter).toBeInstanceOf(Date)
      }
      const [control] = await workerA<[{ state: string }]>`
        select state::text
        from private.auth_session_controls
        where session_id = ${SESSIONS.authNotAfterPending}::uuid
      `
      expect(control.state).toBe("pending")
    } finally {
      if (registrationTransactionOpen) await rollbackQuietly(workerA)
      if (notAfterUpdate) await notAfterUpdate
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("linearizes profile deactivation before login with no false success audit", async () => {
    if (!securityControlAvailable) return
    let profileTransactionOpen = false
    let loginAttempt: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.profileDeactivate,
        "profile-deactivate-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.profileDeactivatePending,
        USERS.profileDeactivate,
        30,
      )
      await registerSession(
        workerA,
        SESSIONS.profileDeactivatePending,
        USERS.profileDeactivate,
      )

      await beginBoundedTransaction(workerA)
      profileTransactionOpen = true
      await workerA`
        update public.profiles
        set is_active = false
        where user_id = ${USERS.profileDeactivate}::uuid
      `
      loginAttempt = captureOutcome(() => writeLoginAudit(
        workerB,
        SESSIONS.profileDeactivatePending,
        USERS.profileDeactivate,
        CORRELATIONS.profileDeactivateLogin,
      ))
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      profileTransactionOpen = false

      expectConstraintFailure(await loginAttempt, "auth_profile_inactive")
      const [state] = await workerA<
        [{ profileActive: boolean; sessionState: string; loginAudits: number }]
      >`
        select
          (select is_active from public.profiles
           where user_id = ${USERS.profileDeactivate}::uuid) as "profileActive",
          (select state::text from private.auth_session_controls
           where session_id = ${SESSIONS.profileDeactivatePending}::uuid)
            as "sessionState",
          (select count(*)::integer from public.audit_events
           where actor_user_id = ${USERS.profileDeactivate}::uuid
             and action = 'auth.login') as "loginAudits"
      `
      expect(state).toEqual({
        profileActive: false,
        sessionState: "pending",
        loginAudits: 0,
      })
    } finally {
      if (profileTransactionOpen) await rollbackQuietly(workerA)
      if (loginAttempt) await loginAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("linearizes temporary-password expiry classification with profile updates", async () => {
    if (!securityControlAvailable) return
    let profileTransactionOpen = false
    let classificationAttempt: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.temporaryPasswordExpiry,
        "temporary-password-expiry-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.temporaryPasswordExpiryPending,
        USERS.temporaryPasswordExpiry,
        30,
      )
      await registerSession(
        workerA,
        SESSIONS.temporaryPasswordExpiryPending,
        USERS.temporaryPasswordExpiry,
      )

      await beginBoundedTransaction(workerA)
      profileTransactionOpen = true
      await workerA`
        update public.profiles
        set must_change_password = true,
            temporary_password_expires_at = clock_timestamp() - interval '1 second'
        where user_id = ${USERS.temporaryPasswordExpiry}::uuid
      `
      classificationAttempt = captureOutcome(() =>
        classifyExpiredTemporaryPassword(
          workerB,
          SESSIONS.temporaryPasswordExpiryPending,
          USERS.temporaryPasswordExpiry,
          CORRELATIONS.temporaryPasswordExpiryFailClosed,
        ),
      )
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      profileTransactionOpen = false

      expect(await classificationAttempt).toEqual({ ok: true, value: undefined })
      const [state] = await workerA<
        [{ mustChangePassword: boolean; sessionState: string }]
      >`
        select
          (select must_change_password from public.profiles
           where user_id = ${USERS.temporaryPasswordExpiry}::uuid)
            as "mustChangePassword",
          (select state::text from private.auth_session_controls
           where session_id = ${SESSIONS.temporaryPasswordExpiryPending}::uuid)
            as "sessionState"
      `
      expect(state).toEqual({
        mustChangePassword: true,
        sessionState: "revoked",
      })
    } finally {
      if (profileTransactionOpen) await rollbackQuietly(workerA)
      if (classificationAttempt) await classificationAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("linearizes platform-role deactivation before login with no false success audit", async () => {
    if (!securityControlAvailable) return
    let roleTransactionOpen = false
    let loginAttempt: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.platformRoleDeactivate,
        "platform-role-deactivate-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.platformRoleDeactivatePending,
        USERS.platformRoleDeactivate,
        30,
      )
      await registerSession(
        workerA,
        SESSIONS.platformRoleDeactivatePending,
        USERS.platformRoleDeactivate,
      )

      await beginBoundedTransaction(workerA)
      roleTransactionOpen = true
      await workerA`
        update public.platform_roles
        set is_active = false
        where user_id = ${USERS.platformRoleDeactivate}::uuid
      `
      loginAttempt = captureOutcome(() => writeLoginAudit(
        workerB,
        SESSIONS.platformRoleDeactivatePending,
        USERS.platformRoleDeactivate,
        CORRELATIONS.platformRoleDeactivateLogin,
      ))
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      roleTransactionOpen = false

      expectConstraintFailure(await loginAttempt, "auth_identity_invalid")
      const [state] = await workerA<
        [{ roleActive: boolean; sessionState: string; loginAudits: number }]
      >`
        select
          (select is_active from public.platform_roles
           where user_id = ${USERS.platformRoleDeactivate}::uuid) as "roleActive",
          (select state::text from private.auth_session_controls
           where session_id = ${SESSIONS.platformRoleDeactivatePending}::uuid)
            as "sessionState",
          (select count(*)::integer from public.audit_events
           where actor_user_id = ${USERS.platformRoleDeactivate}::uuid
             and action = 'auth.login') as "loginAudits"
      `
      expect(state).toEqual({
        roleActive: false,
        sessionState: "pending",
        loginAudits: 0,
      })
    } finally {
      if (roleTransactionOpen) await rollbackQuietly(workerA)
      if (loginAttempt) await loginAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("linearizes company archive before rotation with no false reauthentication audit", async () => {
    if (!securityControlAvailable) return
    let companyTransactionOpen = false
    let rotationAttempt: Promise<Outcome<unknown>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createTenantUser({
        sql: workerA,
        userId: USERS.companyArchive,
        email: "company-archive-race@example.test",
        companyId: COMPANIES.archive,
        membershipId: MEMBERSHIPS.archive,
      })
      await createActiveSession({
        sql: workerA,
        sessionId: SESSIONS.companyArchiveOld,
        userId: USERS.companyArchive,
        correlationId: CORRELATIONS.companyArchiveLogin,
        ageSeconds: 120,
      })
      await createAuthSession(
        workerA,
        SESSIONS.companyArchiveNew,
        USERS.companyArchive,
        20,
      )

      await beginBoundedTransaction(workerA)
      companyTransactionOpen = true
      await workerA`
        update public.companies
        set status = 'archived', archived_at = clock_timestamp()
        where id = ${COMPANIES.archive}::uuid
      `
      rotationAttempt = captureOutcome(() => workerB`
        select private.rotate_app_session_after_reauthentication(
          ${USERS.companyArchive}::uuid,
          ${SESSIONS.companyArchiveOld}::uuid,
          ${SESSIONS.companyArchiveNew}::uuid,
          ${CORRELATIONS.companyArchiveRotate}::uuid
        )
      `)
      await waitForLockWait(coordinator, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      companyTransactionOpen = false

      expectConstraintFailure(await rotationAttempt, "auth_identity_invalid")
      const [state] = await workerA<
        [{ companyStatus: string; oldState: string; newControls: number; audits: number }]
      >`
        select
          (select status::text from public.companies
           where id = ${COMPANIES.archive}::uuid) as "companyStatus",
          (select state::text from private.auth_session_controls
           where session_id = ${SESSIONS.companyArchiveOld}::uuid) as "oldState",
          (select count(*)::integer from private.auth_session_controls
           where session_id = ${SESSIONS.companyArchiveNew}::uuid) as "newControls",
          (select count(*)::integer from public.audit_events
           where actor_user_id = ${USERS.companyArchive}::uuid
             and action = 'auth.reauthenticated') as audits
      `
      expect(state).toEqual({
        companyStatus: "archived",
        oldState: "active",
        newControls: 0,
        audits: 0,
      })
    } finally {
      if (companyTransactionOpen) await rollbackQuietly(workerA)
      if (rotationAttempt) await rotationAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("makes logout win a concurrent late registration without resurrection", async () => {
    if (!securityControlAvailable) return
    let logoutTransactionOpen = false
    let registrationAttempt: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.registerLogout,
        "register-logout-race@example.test",
      )
      await createActiveSession({
        sql: workerA,
        sessionId: SESSIONS.registerLogoutActive,
        userId: USERS.registerLogout,
        correlationId: CORRELATIONS.registerLogoutLogin,
        ageSeconds: 120,
      })
      await createAuthSession(
        workerA,
        SESSIONS.registerLogoutCandidate,
        USERS.registerLogout,
        30,
      )

      await beginBoundedTransaction(workerA)
      logoutTransactionOpen = true
      await workerA`
        select private.revoke_sessions_and_write_logout(
          ${USERS.registerLogout}::uuid,
          ${SESSIONS.registerLogoutActive}::uuid,
          ${CORRELATIONS.registerLogoutRace}::uuid,
          null::text,
          null::text
        )
      `
      registrationAttempt = captureOutcome(() => registerSession(
        workerB,
        SESSIONS.registerLogoutCandidate,
        USERS.registerLogout,
      ))
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      logoutTransactionOpen = false

      expectConstraintFailure(await registrationAttempt, "auth_session_cutoff")
      const [state] = await workerA<
        [{ oldState: string; candidateControls: number; cutoffCoversCandidate: boolean }]
      >`
        select
          (select state::text
           from private.auth_session_controls
           where session_id = ${SESSIONS.registerLogoutActive}::uuid) as "oldState",
          (select count(*)::integer
           from private.auth_session_controls
           where session_id = ${SESSIONS.registerLogoutCandidate}::uuid)
            as "candidateControls",
          (select cutoff.revoked_before >= auth_session.created_at
           from private.auth_user_session_cutoffs cutoff
           join auth.sessions auth_session
             on auth_session.user_id = cutoff.user_id
           where cutoff.user_id = ${USERS.registerLogout}::uuid
             and auth_session.id = ${SESSIONS.registerLogoutCandidate}::uuid)
            as "cutoffCoversCandidate"
      `
      expect(state).toEqual({
        oldState: "revoked",
        candidateControls: 0,
        cutoffCoversCandidate: true,
      })
      const [audit] = await workerA<[{ count: number }]>`
        select count(*)::integer as count
        from public.audit_events
        where actor_user_id = ${USERS.registerLogout}::uuid
          and action = 'auth.logout'
          and correlation_id = ${CORRELATIONS.registerLogoutRace}::uuid
      `
      expect(audit.count).toBe(1)
    } finally {
      if (logoutTransactionOpen) await rollbackQuietly(workerA)
      if (registrationAttempt) await registrationAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("allows one rotate winner and rejects a concurrent second rotation", async () => {
    if (!securityControlAvailable) return
    let rotationTransactionOpen = false
    let secondRotation: Promise<Outcome<unknown>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.rotateRotate,
        "rotate-rotate-race@example.test",
      )
      await createActiveSession({
        sql: workerA,
        sessionId: SESSIONS.rotateRotateOld,
        userId: USERS.rotateRotate,
        correlationId: CORRELATIONS.rotateRotateLogin,
        ageSeconds: 120,
      })
      await createAuthSession(
        workerA,
        SESSIONS.rotateRotateNewA,
        USERS.rotateRotate,
        30,
      )
      await createAuthSession(
        workerA,
        SESSIONS.rotateRotateNewB,
        USERS.rotateRotate,
        20,
      )

      await beginBoundedTransaction(workerA)
      rotationTransactionOpen = true
      await workerA`
        select private.rotate_app_session_after_reauthentication(
          ${USERS.rotateRotate}::uuid,
          ${SESSIONS.rotateRotateOld}::uuid,
          ${SESSIONS.rotateRotateNewA}::uuid,
          ${CORRELATIONS.rotateRotateRaceA}::uuid
        )
      `
      secondRotation = captureOutcome(() => workerB`
        select private.rotate_app_session_after_reauthentication(
          ${USERS.rotateRotate}::uuid,
          ${SESSIONS.rotateRotateOld}::uuid,
          ${SESSIONS.rotateRotateNewB}::uuid,
          ${CORRELATIONS.rotateRotateRaceB}::uuid
        )
      `)
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      rotationTransactionOpen = false

      expectConstraintFailure(
        await secondRotation,
        "auth_reauthentication_session_invalid",
      )
      const [state] = await workerA<
        [{ oldRevoked: number; winnerActive: number; loserControls: number }]
      >`
        select
          count(*) filter (
            where session_id = ${SESSIONS.rotateRotateOld}::uuid
              and state = 'revoked'
          )::integer as "oldRevoked",
          count(*) filter (
            where session_id = ${SESSIONS.rotateRotateNewA}::uuid
              and state = 'active'
          )::integer as "winnerActive",
          count(*) filter (
            where session_id = ${SESSIONS.rotateRotateNewB}::uuid
          )::integer as "loserControls"
        from private.auth_session_controls
        where user_id = ${USERS.rotateRotate}::uuid
      `
      expect(state).toEqual({ oldRevoked: 1, winnerActive: 1, loserControls: 0 })
      const [audit] = await workerA<[{ count: number }]>`
        select count(*)::integer as count
        from public.audit_events
        where actor_user_id = ${USERS.rotateRotate}::uuid
          and action = 'auth.reauthenticated'
      `
      expect(audit.count).toBe(1)
    } finally {
      if (rotationTransactionOpen) await rollbackQuietly(workerA)
      if (secondRotation) await secondRotation
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("makes logout win a concurrent rotation and leaves no new active control", async () => {
    if (!securityControlAvailable) return
    let logoutTransactionOpen = false
    let rotationAttempt: Promise<Outcome<unknown>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.rotateLogout,
        "rotate-logout-race@example.test",
      )
      await createActiveSession({
        sql: workerA,
        sessionId: SESSIONS.rotateLogoutOld,
        userId: USERS.rotateLogout,
        correlationId: CORRELATIONS.rotateLogoutLogin,
        ageSeconds: 120,
      })
      await createAuthSession(
        workerA,
        SESSIONS.rotateLogoutNew,
        USERS.rotateLogout,
        20,
      )

      await beginBoundedTransaction(workerA)
      logoutTransactionOpen = true
      await workerA`
        select private.revoke_sessions_and_write_logout(
          ${USERS.rotateLogout}::uuid,
          ${SESSIONS.rotateLogoutOld}::uuid,
          ${CORRELATIONS.rotateLogoutRace}::uuid,
          null::text,
          null::text
        )
      `
      rotationAttempt = captureOutcome(() => workerB`
        select private.rotate_app_session_after_reauthentication(
          ${USERS.rotateLogout}::uuid,
          ${SESSIONS.rotateLogoutOld}::uuid,
          ${SESSIONS.rotateLogoutNew}::uuid,
          ${CORRELATIONS.rotateLogoutRace}::uuid
        )
      `)
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      logoutTransactionOpen = false

      expectConstraintFailure(
        await rotationAttempt,
        "auth_reauthentication_session_invalid",
      )
      const [state] = await workerA<
        [{ oldRevoked: number; newControls: number; activeControls: number }]
      >`
        select
          count(*) filter (
            where session_id = ${SESSIONS.rotateLogoutOld}::uuid
              and state = 'revoked'
          )::integer as "oldRevoked",
          count(*) filter (
            where session_id = ${SESSIONS.rotateLogoutNew}::uuid
          )::integer as "newControls",
          count(*) filter (where state = 'active')::integer as "activeControls"
        from private.auth_session_controls
        where user_id = ${USERS.rotateLogout}::uuid
      `
      expect(state).toEqual({ oldRevoked: 1, newControls: 0, activeControls: 0 })
      const [audit] = await workerA<
        [{ logout: number; reauthenticated: number }]
      >`
        select
          count(*) filter (where action = 'auth.logout')::integer as logout,
          count(*) filter (where action = 'auth.reauthenticated')::integer
            as reauthenticated
        from public.audit_events
        where actor_user_id = ${USERS.rotateLogout}::uuid
      `
      expect(audit).toEqual({ logout: 1, reauthenticated: 0 })
    } finally {
      if (logoutTransactionOpen) await rollbackQuietly(workerA)
      if (rotationAttempt) await rotationAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("makes a committed cutoff reject a registration already waiting on its user lock", async () => {
    if (!securityControlAvailable) return
    let cutoffTransactionOpen = false
    let registrationAttempt: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.cutoffRegister,
        "cutoff-register-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.cutoffRegisterCandidate,
        USERS.cutoffRegister,
        30,
      )

      await beginBoundedTransaction(workerA)
      cutoffTransactionOpen = true
      await workerA`
        select private.revoke_auth_sessions(
          ${USERS.cutoffRegister}::uuid,
          null::uuid
        )
      `
      registrationAttempt = captureOutcome(() => registerSession(
        workerB,
        SESSIONS.cutoffRegisterCandidate,
        USERS.cutoffRegister,
      ))
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      cutoffTransactionOpen = false

      expectConstraintFailure(await registrationAttempt, "auth_session_cutoff")
      const [state] = await workerA<
        [{ controls: number; cutoffCoversCandidate: boolean }]
      >`
        select
          (select count(*)::integer
           from private.auth_session_controls
           where session_id = ${SESSIONS.cutoffRegisterCandidate}::uuid)
            as controls,
          (select cutoff.revoked_before >= auth_session.created_at
           from private.auth_user_session_cutoffs cutoff
           join auth.sessions auth_session
             on auth_session.user_id = cutoff.user_id
           where cutoff.user_id = ${USERS.cutoffRegister}::uuid
             and auth_session.id = ${SESSIONS.cutoffRegisterCandidate}::uuid)
            as "cutoffCoversCandidate"
      `
      expect(state).toEqual({ controls: 0, cutoffCoversCandidate: true })
    } finally {
      if (cutoffTransactionOpen) await rollbackQuietly(workerA)
      if (registrationAttempt) await registrationAttempt
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)

  it("allows exactly one audit and activation for concurrent login writers", async () => {
    if (!securityControlAvailable) return
    let activationTransactionOpen = false
    let secondActivation: Promise<Outcome<void>> | undefined
    try {
      await cleanupSecurityFixtures(workerA)
      await createPlatformUser(
        workerA,
        USERS.activation,
        "activation-race@example.test",
      )
      await createAuthSession(
        workerA,
        SESSIONS.activationPending,
        USERS.activation,
        60,
      )
      await registerSession(
        workerA,
        SESSIONS.activationPending,
        USERS.activation,
      )

      await beginBoundedTransaction(workerA)
      activationTransactionOpen = true
      await writeLoginAudit(
        workerA,
        SESSIONS.activationPending,
        USERS.activation,
        CORRELATIONS.activationA,
      )
      secondActivation = captureOutcome(() => writeLoginAudit(
        workerB,
        SESSIONS.activationPending,
        USERS.activation,
        CORRELATIONS.activationB,
      ))
      await waitForLockWait(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      activationTransactionOpen = false

      expectConstraintFailure(await secondActivation, "auth_login_session_invalid")
      const [control] = await workerA<
        [{ state: string; activated: boolean; snapshot: string }]
      >`
        select
          state::text,
          activated_at is not null as activated,
          audit_scope::text as snapshot
        from private.auth_session_controls
        where session_id = ${SESSIONS.activationPending}::uuid
      `
      expect(control).toEqual({ state: "active", activated: true, snapshot: "platform" })
      const [audit] = await workerA<
        [{ count: number; winningCorrelation: string }]
      >`
        select
          count(*)::integer as count,
          min(correlation_id::text) as "winningCorrelation"
        from public.audit_events
        where actor_user_id = ${USERS.activation}::uuid
          and action = 'auth.login'
      `
      expect(audit).toEqual({
        count: 1,
        winningCorrelation: CORRELATIONS.activationA,
      })
    } finally {
      if (activationTransactionOpen) await rollbackQuietly(workerA)
      if (secondActivation) await secondActivation
      await cleanupSecurityFixtures(workerA)
    }
  }, 20_000)
})
