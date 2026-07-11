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
const WORKER_A_NAME = "axsys-identity-race-a"
const WORKER_B_NAME = "axsys-identity-race-b"
const IDENTITY_LOCK_SEED = 1672
const COMPANY_ADMIN_LOCK_SEED = 2102
const WAIT_TIMEOUT_MS = 3_000
const LOCK_TIMEOUT_MS = 6_000
const STATEMENT_TIMEOUT_MS = 10_000
const IDLE_TRANSACTION_TIMEOUT_MS = 10_000

const USERS = {
  insert: "51000000-0000-4000-8000-000000000001",
  swapPlatform: "51000000-0000-4000-8000-000000000002",
  swapMember: "51000000-0000-4000-8000-000000000003",
  adminA: "51000000-0000-4000-8000-000000000004",
  adminB: "51000000-0000-4000-8000-000000000005",
} as const

const COMPANIES = {
  insert: "53000000-0000-4000-8000-000000000001",
  swap: "53000000-0000-4000-8000-000000000002",
  admins: "53000000-0000-4000-8000-000000000003",
} as const

const MEMBERSHIPS = {
  insert: "54000000-0000-4000-8000-000000000001",
  swap: "54000000-0000-4000-8000-000000000002",
  adminA: "54000000-0000-4000-8000-000000000003",
  adminB: "54000000-0000-4000-8000-000000000004",
} as const

type Outcome =
  | { ok: true }
  | { ok: false; error: unknown }

function requireLocalAdminDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("Identity concurrency database is unavailable")

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Identity concurrency database is unavailable")
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
    throw new Error("Identity concurrency database is unavailable")
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

let foundationAvailable = false
let workerBPid = 0

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
    // The connection can already be outside a transaction after a failed setup.
  }
}

async function runTransaction(
  sql: Sql,
  statement: () => Promise<unknown>,
): Promise<Outcome> {
  try {
    await beginBoundedTransaction(sql)
    await statement()
    await sql.unsafe("commit")
    return { ok: true }
  } catch (error) {
    await rollbackQuietly(sql)
    return { ok: false, error }
  }
}

async function waitForAdvisoryBlock(
  observer: Sql,
  backendPid: number,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await observer`select pg_stat_clear_snapshot()`
    const [state] = await observer<[{ blocked: boolean }]>`
      select exists (
        select 1
        from pg_stat_activity
        where pid = ${backendPid}
          and application_name = ${applicationName}
          and state = 'active'
          and wait_event_type = 'Lock'
          and wait_event = 'advisory'
      ) as blocked
    `
    if (state.blocked) return
    await delay(25)
  }
  throw new Error("Expected advisory lock wait was not observed")
}

function expectConflict(outcome: Outcome, message: string): void {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) {
    expect(outcome.error).toMatchObject({ code: "23514" })
    expect((outcome.error as Error).message).toBe(message)
    expect((outcome.error as { code?: string }).code).not.toBe("40P01")
  }
}

async function releaseSessionGate(
  sql: Sql,
  resourceId: string,
  seed: number,
): Promise<void> {
  const [release] = await sql<[{ unlocked: boolean }]>`
    select pg_advisory_unlock(
      hashtextextended(${resourceId}::text, ${seed})
    ) as unlocked
  `
  if (!release.unlocked) {
    throw new Error("Expected session advisory lock was not held")
  }
}

async function finalizeGateRace(input: {
  workerATransactionOpen: boolean
  sessionGateHeld: boolean
  resourceId: string
  seed: number
  concurrentAttempts?: readonly Promise<Outcome>[]
}): Promise<void> {
  const errors: unknown[] = []
  if (input.workerATransactionOpen) await rollbackQuietly(workerA)
  if (input.sessionGateHeld) {
    try {
      await releaseSessionGate(workerA, input.resourceId, input.seed)
    } catch (error) {
      errors.push(error)
    }
  }
  for (const attempt of input.concurrentAttempts ?? []) {
    try {
      await attempt
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    await cleanupFixtures(workerA)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Identity concurrency race cleanup failed")
  }
}

async function createUser(sql: Sql, userId: string, email: string): Promise<void> {
  await sql`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
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

async function createCompany(
  sql: Sql,
  companyId: string,
  cnpj: string,
): Promise<void> {
  await sql`
    insert into public.companies (
      id, legal_name, cnpj_normalized, contact_email
    ) values (
      ${companyId}::uuid,
      ${`Empresa ${companyId.at(-1)}`},
      ${cnpj},
      ${`empresa-${companyId.at(-1)}@example.test`}
    )
  `
}

async function cleanupFixtures(sql: Sql): Promise<void> {
  const [catalog] = await sql<[{ available: boolean }]>`
    select to_regclass('public.company_memberships') is not null as available
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
      const [identity] = await transaction<[{ owner: boolean }]>`
        select current_user = 'postgres' as owner
      `
      if (!identity.owner) {
        throw new Error("Concurrency fixture cleanup requires the migration owner")
      }

      await transaction.unsafe(
        "lock table public.company_memberships in access exclusive mode",
      )
      const [trigger] = await transaction<[{ enabled: string }]>`
        select tgenabled as enabled
        from pg_trigger
        where tgrelid = 'public.company_memberships'::regclass
          and tgname = 'protect_last_company_admin'
          and not tgisinternal
      `
      if (trigger?.enabled !== "O") {
        throw new Error("Concurrency fixture cleanup requires its enabled trigger")
      }

      await transaction.unsafe(
        "alter table public.company_memberships disable trigger protect_last_company_admin",
      )

      await transaction`
        delete from public.member_modules
        where membership_id = any(${[...Object.values(MEMBERSHIPS)]}::uuid[])
      `
      await transaction`
        delete from public.platform_roles
        where user_id = any(${[...Object.values(USERS)]}::uuid[])
      `
      await transaction`
        delete from public.company_memberships
        where id = any(${[...Object.values(MEMBERSHIPS)]}::uuid[])
      `

      await transaction.unsafe(
        "alter table public.company_memberships enable trigger protect_last_company_admin",
      )
      const [triggerState] = await transaction<[{ enabled: string }]>`
        select tgenabled as enabled
        from pg_trigger
        where tgrelid = 'public.company_memberships'::regclass
          and tgname = 'protect_last_company_admin'
          and not tgisinternal
      `
      if (triggerState?.enabled !== "O") {
        throw new Error("Concurrency fixture cleanup did not restore its trigger")
      }

      await transaction`
        delete from public.companies
        where id = any(${[...Object.values(COMPANIES)]}::uuid[])
      `
      await transaction`
        delete from public.profiles
        where user_id = any(${[...Object.values(USERS)]}::uuid[])
      `
      await transaction`
        delete from auth.users
        where id = any(${[...Object.values(USERS)]}::uuid[])
      `

      const [residue] = await transaction<[{ count: number }]>`
        select (
          (select count(*) from public.member_modules
            where membership_id = any(${[...Object.values(MEMBERSHIPS)]}::uuid[]))
          + (select count(*) from public.platform_roles
            where user_id = any(${[...Object.values(USERS)]}::uuid[]))
          + (select count(*) from public.company_memberships
            where id = any(${[...Object.values(MEMBERSHIPS)]}::uuid[]))
          + (select count(*) from public.companies
            where id = any(${[...Object.values(COMPANIES)]}::uuid[]))
          + (select count(*) from public.profiles
            where user_id = any(${[...Object.values(USERS)]}::uuid[]))
          + (select count(*) from auth.users
            where id = any(${[...Object.values(USERS)]}::uuid[]))
        )::integer as count
      `
      if (residue.count !== 0) {
        throw new Error("Concurrency fixture cleanup left fixture rows")
      }
    })
  } catch (error) {
    const [triggerState] = await sql<[{ enabled: string }]>`
      select tgenabled as enabled
      from pg_trigger
      where tgrelid = 'public.company_memberships'::regclass
        and tgname = 'protect_last_company_admin'
        and not tgisinternal
    `
    if (triggerState?.enabled !== "O") {
      throw new AggregateError(
        [error],
        "Concurrency fixture cleanup rollback did not preserve its trigger",
      )
    }
    throw error
  }
}

beforeAll(async () => {
  const [[identityA], [identityB]] = await Promise.all([
    workerA<
      [{ owner: boolean; available: boolean; pid: number; applicationName: string }]
    >`
      select
        current_user = 'postgres' as owner,
        to_regclass('public.profiles') is not null
          and to_regclass('public.platform_roles') is not null
          and to_regclass('public.companies') is not null
          and to_regclass('public.company_memberships') is not null
          and to_regclass('public.member_modules') is not null as available,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName"
    `,
    workerB<[{ owner: boolean; pid: number; applicationName: string }]>`
      select
        current_user = 'postgres' as owner,
        pg_backend_pid() as pid,
        current_setting('application_name') as "applicationName"
    `,
  ])
  if (
    !identityA.owner ||
    !identityB.owner ||
    identityA.pid === identityB.pid ||
    identityA.applicationName !== WORKER_A_NAME ||
    identityB.applicationName !== WORKER_B_NAME
  ) {
    throw new Error("Identity concurrency database is unavailable")
  }
  workerBPid = identityB.pid
  foundationAvailable = identityA.available
  if (foundationAvailable) await cleanupFixtures(workerA)
})

afterAll(async () => {
  const teardownErrors: unknown[] = []
  try {
    const unlockResults = await Promise.allSettled([
      workerA`select pg_advisory_unlock_all()`,
      workerB`select pg_advisory_unlock_all()`,
    ])
    for (const result of unlockResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }
    if (foundationAvailable) {
      try {
        await cleanupFixtures(workerA)
      } catch (error) {
        teardownErrors.push(error)
      }
    }
  } finally {
    const closeResults = await Promise.allSettled([
      workerA.end({ timeout: 2 }),
      workerB.end({ timeout: 2 }),
    ])
    for (const result of closeResults) {
      if (result.status === "rejected") teardownErrors.push(result.reason)
    }
  }
  if (teardownErrors.length > 0) {
    throw new AggregateError(teardownErrors, "Identity concurrency teardown failed")
  }
})

describe.sequential("identity invariants under concurrent writes", () => {
  it("requires the committed identity migration before running races", () => {
    expect(foundationAvailable).toBe(true)
  })

  it("serializes a platform-role and membership insert for the same user", async () => {
    if (!foundationAvailable) return
    let workerATransactionOpen = false
    let sessionGateHeld = false
    let membershipAttempt: Promise<Outcome> | undefined
    try {
      await cleanupFixtures(workerA)
      await createUser(workerA, USERS.insert, "identity-insert@example.test")
      await createCompany(workerA, COMPANIES.insert, "51000000000001")

      await workerA`
        select pg_advisory_lock(
          hashtextextended(${USERS.insert}::text, ${IDENTITY_LOCK_SEED})
        )
      `
      sessionGateHeld = true
      await beginBoundedTransaction(workerA)
      workerATransactionOpen = true
      await workerA`
        insert into public.platform_roles (user_id)
        values (${USERS.insert}::uuid)
      `

      membershipAttempt = runTransaction(workerB, () => workerB`
        insert into public.company_memberships (id, company_id, user_id, role)
        values (
          ${MEMBERSHIPS.insert}::uuid,
          ${COMPANIES.insert}::uuid,
          ${USERS.insert}::uuid,
          'company_admin'
        )
      `)

      await waitForAdvisoryBlock(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      workerATransactionOpen = false
      await releaseSessionGate(workerA, USERS.insert, IDENTITY_LOCK_SEED)
      sessionGateHeld = false

      expectConflict(await membershipAttempt, "identity_scope_conflict")
      const [scope] = await workerA<[{ count: number }]>`
        select (
          (select count(*) from public.platform_roles
            where user_id = ${USERS.insert}::uuid)
          + (select count(*) from public.company_memberships
            where user_id = ${USERS.insert}::uuid)
        )::integer as count
      `
      expect(scope.count).toBe(1)
    } finally {
      await finalizeGateRace({
        workerATransactionOpen,
        sessionGateHeld,
        resourceId: USERS.insert,
        seed: IDENTITY_LOCK_SEED,
        concurrentAttempts: membershipAttempt ? [membershipAttempt] : [],
      })
    }
  }, 20_000)

  it("orders opposite user-id updates without a deadlock", async () => {
    if (!foundationAvailable) return
    let sessionGateHeld = false
    let platformAttempt: Promise<Outcome> | undefined
    let membershipAttempt: Promise<Outcome> | undefined
    let readyCount = 0
    let reportBothReady: (() => void) | undefined
    let releaseStart: (() => void) | undefined
    let startReleased = false
    const bothReady = new Promise<void>((resolve) => {
      reportBothReady = resolve
    })
    const start = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    const waitAtStart = async (): Promise<void> => {
      readyCount += 1
      if (readyCount === 2) reportBothReady?.()
      await start
    }
    const releaseBarrier = (): void => {
      if (startReleased) return
      startReleased = true
      releaseStart?.()
    }
    try {
      await cleanupFixtures(workerA)
      await createUser(workerA, USERS.swapPlatform, "swap-platform@example.test")
      await createUser(workerA, USERS.swapMember, "swap-member@example.test")
      await createCompany(workerA, COMPANIES.swap, "51000000000002")
      await workerA`
        insert into public.platform_roles (user_id)
        values (${USERS.swapPlatform}::uuid)
      `
      await workerA`
        insert into public.company_memberships (id, company_id, user_id, role)
        values (
          ${MEMBERSHIPS.swap}::uuid,
          ${COMPANIES.swap}::uuid,
          ${USERS.swapMember}::uuid,
          'company_admin'
        )
      `

      await workerA`
        select pg_advisory_lock(
          hashtextextended(${USERS.swapPlatform}::text, ${IDENTITY_LOCK_SEED})
        )
      `
      sessionGateHeld = true

      platformAttempt = runTransaction(workerA, async () => {
        await waitAtStart()
        return workerA`
          update public.platform_roles
          set user_id = ${USERS.swapMember}::uuid
          where user_id = ${USERS.swapPlatform}::uuid
        `
      })
      membershipAttempt = runTransaction(workerB, async () => {
        await waitAtStart()
        return workerB`
          update public.company_memberships
          set user_id = ${USERS.swapPlatform}::uuid
          where id = ${MEMBERSHIPS.swap}::uuid
        `
      })
      expect(platformAttempt).toBeDefined()
      expect(membershipAttempt).toBeDefined()

      const readinessTimeout = new AbortController()
      try {
        await Promise.race([
          bothReady,
          delay(WAIT_TIMEOUT_MS, undefined, {
            signal: readinessTimeout.signal,
            ref: false,
          }).then(() => {
            throw new Error("Both identity updates did not reach the start barrier")
          }),
        ])
      } finally {
        readinessTimeout.abort()
      }
      releaseBarrier()

      const platformOutcome = await platformAttempt
      expectConflict(platformOutcome, "identity_scope_conflict")

      await waitForAdvisoryBlock(workerA, workerBPid, WORKER_B_NAME)
      const [membershipLocks] = await workerA<
        [{ granted: number; waiting: number }]
      >`
        select
          count(*) filter (where granted)::integer as granted,
          count(*) filter (where not granted)::integer as waiting
        from pg_locks
        where pid = ${workerBPid}
          and locktype = 'advisory'
      `
      expect(membershipLocks).toEqual({ granted: 0, waiting: 1 })

      await releaseSessionGate(workerA, USERS.swapPlatform, IDENTITY_LOCK_SEED)
      sessionGateHeld = false
      const membershipOutcome = await membershipAttempt
      expectConflict(membershipOutcome, "identity_scope_conflict")

      const [unchanged] = await workerA<
        [{ platformUser: string; membershipUser: string }]
      >`
        select
          (select user_id::text from public.platform_roles
            where user_id = ${USERS.swapPlatform}::uuid) as "platformUser",
          (select user_id::text from public.company_memberships
            where id = ${MEMBERSHIPS.swap}::uuid) as "membershipUser"
      `
      expect(unchanged).toEqual({
        platformUser: USERS.swapPlatform,
        membershipUser: USERS.swapMember,
      })
    } finally {
      releaseBarrier()
      await finalizeGateRace({
        workerATransactionOpen: false,
        sessionGateHeld,
        resourceId: USERS.swapPlatform,
        seed: IDENTITY_LOCK_SEED,
        concurrentAttempts: [platformAttempt, membershipAttempt].filter(
          (attempt): attempt is Promise<Outcome> => attempt !== undefined,
        ),
      })
    }
  }, 20_000)

  it("allows exactly one concurrent suspension of the final two admins", async () => {
    if (!foundationAvailable) return
    let workerATransactionOpen = false
    let sessionGateHeld = false
    let secondAttempt: Promise<Outcome> | undefined
    try {
      await cleanupFixtures(workerA)
      await createUser(workerA, USERS.adminA, "admin-a-race@example.test")
      await createUser(workerA, USERS.adminB, "admin-b-race@example.test")
      await createCompany(workerA, COMPANIES.admins, "51000000000003")
      await workerA`
        insert into public.company_memberships (id, company_id, user_id, role)
        values
          (${MEMBERSHIPS.adminA}::uuid, ${COMPANIES.admins}::uuid,
           ${USERS.adminA}::uuid, 'company_admin'),
          (${MEMBERSHIPS.adminB}::uuid, ${COMPANIES.admins}::uuid,
           ${USERS.adminB}::uuid, 'company_admin')
      `

      await workerA`
        select pg_advisory_lock(
          hashtextextended(${COMPANIES.admins}::text, ${COMPANY_ADMIN_LOCK_SEED})
        )
      `
      sessionGateHeld = true
      await beginBoundedTransaction(workerA)
      workerATransactionOpen = true
      await workerA`
        update public.company_memberships
        set status = 'suspended',
            suspended_at = clock_timestamp(),
            suspended_by = ${USERS.adminA}::uuid,
            suspension_reason = 'Teste concorrente do último administrador'
        where id = ${MEMBERSHIPS.adminA}::uuid
      `

      secondAttempt = runTransaction(workerB, () => workerB`
        update public.company_memberships
        set status = 'suspended',
            suspended_at = clock_timestamp(),
            suspended_by = ${USERS.adminB}::uuid,
            suspension_reason = 'Teste concorrente do último administrador'
        where id = ${MEMBERSHIPS.adminB}::uuid
      `)

      await waitForAdvisoryBlock(workerA, workerBPid, WORKER_B_NAME)
      await workerA.unsafe("commit")
      workerATransactionOpen = false
      await releaseSessionGate(workerA, COMPANIES.admins, COMPANY_ADMIN_LOCK_SEED)
      sessionGateHeld = false

      expectConflict(await secondAttempt, "last_active_company_admin")
      const [remaining] = await workerA<[{ count: number }]>`
        select count(*)::integer as count
        from public.company_memberships
        where company_id = ${COMPANIES.admins}::uuid
          and role = 'company_admin'
          and status = 'active'
      `
      expect(remaining.count).toBe(1)
    } finally {
      await finalizeGateRace({
        workerATransactionOpen,
        sessionGateHeld,
        resourceId: COMPANIES.admins,
        seed: COMPANY_ADMIN_LOCK_SEED,
        concurrentAttempts: secondAttempt ? [secondAttempt] : [],
      })
    }
  }, 20_000)
})
