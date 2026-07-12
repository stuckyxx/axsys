import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as changePasswordPost } from "@/app/api/auth/change-password/route"
import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as temporaryPasswordPost } from "@/app/api/auth/temporary-password/route"
import { bffDb } from "@/lib/db/bff"
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { hashSensitive } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { getAccessContext } from "@/modules/auth/server/get-access-context"
import {
  setTemporaryPassword,
  TemporaryPasswordRetryRequiredError,
} from "@/modules/auth/server/set-temporary-password"
import {
  cookieStoreFor,
  type Task11CookieJar,
} from "./task11-local-fixture"
import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "../../helpers/local-destructive-urls"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local integration environment directly.
  }
}

const requestCookies = vi.hoisted(() => ({
  current: undefined as Task11CookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current) throw new Error("Cookie jar unavailable")
    return cookieStoreFor(requestCookies.current)
  },
}))

const FIXTURE_NAME = "Task 12 local fixture"

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error("Task 12 local fixture is unavailable")
  }
  return value
}

type Identity = {
  readonly email: string
  readonly originalPassword: string
  readonly jar: Task11CookieJar
  userId: string
  membershipId: string
  companyId: string
}

class Task12LocalFixture {
  readonly supabaseUrl = requireLocalHttpUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "54321",
    FIXTURE_NAME,
  )
  readonly databaseUrl = requireLocalOwnerDatabaseUrl(
    process.env.DATABASE_URL,
    FIXTURE_NAME,
  )
  readonly appOrigin = requireLocalHttpUrl(
    process.env.APP_ORIGIN,
    "3000",
    FIXTURE_NAME,
  ).replace(/\/$/u, "")
  readonly applicationName = `axsys-task12-integration-${randomUUID()}`
  readonly correlationIds = new Set<string>()
  readonly rawRateKeys = new Set<string>()
  readonly companyIds: string[] = []
  readonly identities: Identity[] = []
  readonly adminA = this.identity("admin-a")
  readonly memberA = this.identity("member-a")
  readonly memberB = this.identity("member-b")

  private readonly admin = createClient<Database>(
    this.supabaseUrl,
    requireSecret(process.env.SUPABASE_SECRET_KEY),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    },
  )
  readonly ownerSql = postgres(this.databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: this.applicationName,
      lock_timeout: 6_000,
      statement_timeout: 12_000,
      idle_in_transaction_session_timeout: 12_000,
    },
  })

  private identity(label: string): Identity {
    const identity: Identity = {
      email: `task12-${label}-${randomUUID()}@example.test`,
      originalPassword: `Axsys-${randomBytes(22).toString("base64url")}!9a`,
      jar: new Map(),
      userId: "",
      membershipId: randomUUID(),
      companyId: "",
    }
    this.identities.push(identity)
    return identity
  }

  private cnpj(): string {
    return `71${randomInt(0, 1_000_000_000_000).toString().padStart(12, "0")}`
  }

  async create(): Promise<void> {
    const companyA = randomUUID()
    const companyB = randomUUID()
    this.companyIds.push(companyA, companyB)
    this.adminA.companyId = companyA
    this.memberA.companyId = companyA
    this.memberB.companyId = companyB

    for (const identity of this.identities) {
      const created = await this.admin.auth.admin.createUser({
        email: identity.email,
        password: identity.originalPassword,
        email_confirm: true,
      })
      if (created.error || !created.data.user) {
        throw new Error("Task 12 Auth fixture creation failed")
      }
      identity.userId = created.data.user.id
    }

    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.companies (
          id, legal_name, trade_name, cnpj_normalized, contact_email
        ) values
          (${companyA}::uuid, 'Task 12 Empresa A', 'Empresa A', ${this.cnpj()}, ${this.adminA.email}),
          (${companyB}::uuid, 'Task 12 Empresa B', 'Empresa B', ${this.cnpj()}, ${this.memberB.email})
      `
      for (const identity of this.identities) {
        await transaction`
          insert into public.profiles (user_id, email, display_name)
          values (${identity.userId}::uuid, ${identity.email}, ${`Task 12 ${identity.email.split("@")[0]}`})
        `
      }
      await transaction`
        insert into public.company_memberships (
          id, company_id, user_id, role
        ) values
          (${this.adminA.membershipId}::uuid, ${companyA}::uuid,
           ${this.adminA.userId}::uuid, 'company_admin'),
          (${this.memberA.membershipId}::uuid, ${companyA}::uuid,
           ${this.memberA.userId}::uuid, 'member'),
          (${this.memberB.membershipId}::uuid, ${companyB}::uuid,
           ${this.memberB.userId}::uuid, 'member')
      `
      await transaction`
        insert into public.member_modules (company_id, membership_id, module)
        values
          (${companyA}::uuid, ${this.adminA.membershipId}::uuid, 'administrative'),
          (${companyA}::uuid, ${this.memberA.membershipId}::uuid, 'administrative')
      `
    })
  }

  nextCorrelationId(): string {
    const id = randomUUID()
    this.correlationIds.add(id)
    return id
  }

  issueCsrf(jar: Task11CookieJar): string {
    const token = createCsrfToken(requireSecret(process.env.CSRF_SECRET))
    jar.set(CSRF_COOKIE_NAME, token)
    return token
  }

  request(
    path: string,
    body: unknown,
    jar: Task11CookieJar,
    correlationId = this.nextCorrelationId(),
    ip = "203.0.113.120",
  ): Request {
    this.rawRateKeys.add(ip)
    const csrf = this.issueCsrf(jar)
    return new Request(`${this.appOrigin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this.appOrigin,
        "x-correlation-id": correlationId,
        "x-csrf-token": csrf,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    })
  }

  async signInAndActivate(
    identity: Identity,
    jar: Task11CookieJar = identity.jar,
  ): Promise<{ accessToken: string; sessionId: string }> {
    requestCookies.current = jar
    const client = await createServerSupabase()
    const signedIn = await client.auth.signInWithPassword({
      email: identity.email,
      password: identity.originalPassword,
    })
    if (signedIn.error || !signedIn.data.session) {
      throw new Error("Task 12 Auth fixture sign-in failed")
    }
    const claims = await client.auth.getClaims()
    const sessionId = claims.data?.claims.session_id
    if (claims.error || typeof sessionId !== "string") {
      throw new Error("Task 12 Auth fixture claims failed")
    }
    const rows = await this.ownerSql<{ id: string }[]>`
      insert into private.auth_session_controls (
        session_id, user_id, auth_created_at, remember_me, state,
        absolute_expires_at, audit_scope, audit_company_id,
        activated_at, last_seen_at, created_at, updated_at
      )
      select auth_session.id, auth_session.user_id, auth_session.created_at,
        false, 'active'::private.auth_session_state,
        least(
          auth_session.created_at + interval '8 hours',
          coalesce(auth_session.not_after, auth_session.created_at + interval '8 hours')
        ),
        'tenant'::public.audit_scope, ${identity.companyId}::uuid,
        clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp()
      from auth.sessions auth_session
      where auth_session.id = ${sessionId}::uuid
        and auth_session.user_id = ${identity.userId}::uuid
      returning session_id as id
    `
    if (rows.length !== 1) {
      throw new Error("Task 12 app-session fixture activation failed")
    }
    return { accessToken: signedIn.data.session.access_token, sessionId }
  }

  async adminContext(): Promise<AccessContext> {
    requestCookies.current = this.adminA.jar
    const resolution = await getAccessContext()
    if (resolution.status !== "authenticated") {
      throw new Error("Task 12 admin context unavailable")
    }
    return resolution.context
  }

  async passwordOperationRows() {
    return this.ownerSql<
      {
        id: string
        status: string
        reasonCode: string | null
        correlationId: string
        expiresAt: Date
      }[]
    >`
      select id, status::text, reason_code as "reasonCode",
             correlation_id as "correlationId", expires_at as "expiresAt"
      from private.auth_password_operations
      where target_user_id = ${this.memberA.userId}::uuid
      order by reserved_at, id
    `
  }

  async cleanup(): Promise<void> {
    const userIds = this.identities.map(({ userId }) => userId).filter(Boolean)
    const membershipIds = this.identities.map(({ membershipId }) => membershipId)
    const correlations = [...this.correlationIds]
    const rateHashes = [
      ...this.rawRateKeys,
      this.memberA.email,
    ].map((value) => hashSensitive(value))
    const sessionIds: string[] = []
    let cleanupFailure: unknown

    if (userIds.length > 0) {
      try {
        const sessions = await this.ownerSql<{ id: string }[]>`
          select id from auth.sessions
          where user_id = any(${userIds}::uuid[])
          order by id
        `
        sessionIds.push(...sessions.map(({ id }) => id))
      } catch (error) {
        cleanupFailure ??= error
      }

      try {
        await this.ownerSql.begin(async (transaction) => {
          await transaction`alter table public.audit_events disable trigger audit_events_append_only`
          await transaction`alter table public.security_events disable trigger security_events_append_only`
          await transaction`
            delete from public.audit_events
            where actor_user_id = any(${userIds}::uuid[])
               or resource_id = any(${userIds}::uuid[])
               or correlation_id = any(${correlations}::uuid[])
          `
          await transaction`
            delete from public.security_events
            where correlation_id = any(${correlations}::uuid[])
          `
          await transaction`alter table public.audit_events enable trigger audit_events_append_only`
          await transaction`alter table public.security_events enable trigger security_events_append_only`
          await transaction`
            delete from private.auth_password_operations
            where actor_user_id = any(${userIds}::uuid[])
               or target_user_id = any(${userIds}::uuid[])
          `
          if (rateHashes.length > 0) {
            await transaction`
              delete from private.rate_limit_buckets
              where key_hash = any(${rateHashes}::text[])
            `
          }
          await transaction`
            delete from private.auth_session_controls
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            alter table public.company_memberships disable trigger protect_last_company_admin
          `
          await transaction`
            delete from public.member_modules
            where membership_id = any(${membershipIds}::uuid[])
          `
          await transaction`
            delete from public.company_memberships
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            alter table public.company_memberships enable trigger protect_last_company_admin
          `
          await transaction`
            delete from private.company_storage_usage
            where company_id = any(${this.companyIds}::uuid[])
          `
          await transaction`
            delete from public.companies where id = any(${this.companyIds}::uuid[])
          `
          await transaction`
            delete from public.profiles where user_id = any(${userIds}::uuid[])
          `
        })
      } catch (error) {
        cleanupFailure ??= error
      }

      for (const userId of userIds) {
        try {
          const deleted = await this.admin.auth.admin.deleteUser(userId, false)
          if (deleted.error) {
            throw new Error("Task 12 Auth cleanup failed")
          }
        } catch (error) {
          cleanupFailure ??= error
        }
      }

      try {
        await this.ownerSql.begin(async (transaction) => {
          await transaction`
            delete from auth.refresh_tokens
            where user_id = any(${userIds}::text[])
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from auth.sessions where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from auth.identities where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from auth.users where id = any(${userIds}::uuid[])
          `
        })
      } catch (error) {
        cleanupFailure ??= error
      }

      try {
        const [residue] = await this.ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users where id = any(${userIds}::uuid[]))
            + (select count(*) from auth.identities where user_id = any(${userIds}::uuid[]))
            + (select count(*) from auth.sessions where user_id = any(${userIds}::uuid[]))
            + (select count(*) from auth.refresh_tokens
               where user_id = any(${userIds}::text[])
                  or session_id = any(${sessionIds}::uuid[]))
            + (select count(*) from public.profiles where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.company_memberships where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.companies where id = any(${this.companyIds}::uuid[]))
            + (select count(*) from private.auth_session_controls where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.auth_user_session_cutoffs where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.auth_password_operations
               where actor_user_id = any(${userIds}::uuid[])
                  or target_user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.audit_events
               where actor_user_id = any(${userIds}::uuid[])
                  or resource_id = any(${userIds}::uuid[]))
            + (select count(*) from public.security_events
               where correlation_id = any(${correlations}::uuid[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) {
          throw new Error("Task 12 integration left database residue")
        }
      } catch (error) {
        cleanupFailure ??= error
      }
    }

    requestCookies.current = undefined
    try {
      await this.ownerSql.end({ timeout: 2 })
    } catch (error) {
      cleanupFailure ??= error
    }

    const verifier = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: "axsys-task12-verifier" },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = ${this.applicationName}
      `
      if (connections.count !== 0) {
        throw new Error("Task 12 integration left database connections")
      }
    } catch (error) {
      cleanupFailure ??= error
    } finally {
      await verifier.end({ timeout: 2 })
    }
    if (cleanupFailure) throw cleanupFailure
  }
}

const fixture = new Task12LocalFixture()
const memberASecondJar: Task11CookieJar = new Map()
let oldAccessToken = ""

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
  await fixture.signInAndActivate(fixture.adminA)
  await fixture.signInAndActivate(fixture.memberB)
  oldAccessToken = (await fixture.signInAndActivate(fixture.memberA)).accessToken
  await fixture.signInAndActivate(fixture.memberA, memberASecondJar)
})

afterAll(async () => {
  await fixture.cleanup()
  vi.unstubAllEnvs()
})

describe.sequential("Task 12 real temporary-password saga", () => {
  it("enforces IDOR neutrality, authorization, reauthentication, concurrency and immediate RLS closure", async () => {
    requestCookies.current = fixture.adminA.jar
    const crossTenant = await temporaryPasswordPost(
      fixture.request(
        "/api/auth/temporary-password",
        {
          targetUserId: fixture.memberB.userId,
          password: "Axsys-Temp-CrossTenant-42!",
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
        fixture.adminA.jar,
      ),
    )
    const unknown = await temporaryPasswordPost(
      fixture.request(
        "/api/auth/temporary-password",
        {
          targetUserId: randomUUID(),
          password: "Axsys-Temp-UnknownUser-42!",
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
        fixture.adminA.jar,
      ),
    )
    expect(crossTenant.status).toBe(404)
    expect(unknown.status).toBe(404)
    expectNoStore(crossTenant)
    expectNoStore(unknown)
    const crossBody = await crossTenant.json()
    const unknownBody = await unknown.json()
    expect(crossBody).toMatchObject({ error: { code: "USER_NOT_FOUND" } })
    expect(unknownBody).toMatchObject({ error: { code: "USER_NOT_FOUND" } })
    expect(crossBody.error.message).toBe(unknownBody.error.message)

    requestCookies.current = fixture.memberB.jar
    const ordinary = await temporaryPasswordPost(
      fixture.request(
        "/api/auth/temporary-password",
        {
          targetUserId: fixture.memberA.userId,
          password: "Axsys-Temp-Ordinary-42!",
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
        fixture.memberB.jar,
      ),
    )
    expect(ordinary.status).toBe(403)
    await expect(ordinary.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    })

    requestCookies.current = fixture.adminA.jar
    const realNow = Date.now()
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 601_000)
    const stale = await temporaryPasswordPost(
      fixture.request(
        "/api/auth/temporary-password",
        {
          targetUserId: fixture.memberA.userId,
          password: "Axsys-Temp-StaleAdmin-42!",
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
        fixture.adminA.jar,
      ),
    )
    dateSpy.mockRestore()
    expect(stale.status).toBe(403)
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "REAUTHENTICATION_REQUIRED" },
    })

    const actor = await fixture.adminContext()
    const firstCorrelation = fixture.nextCorrelationId()
    const secondCorrelation = fixture.nextCorrelationId()
    const raced = await Promise.allSettled([
      bffDb.beginTemporaryPasswordReset({
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        targetUserId: fixture.memberA.userId,
        requestReasonCode: "ADMIN_RESET_USER_REQUEST",
        correlationId: firstCorrelation,
      }),
      bffDb.beginTemporaryPasswordReset({
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        targetUserId: fixture.memberA.userId,
        requestReasonCode: "ADMIN_RESET_USER_REQUEST",
        correlationId: secondCorrelation,
      }),
    ])
    const successes = raced.filter(
      (result): result is PromiseFulfilledResult<{
        operationId: string
        expiresAt: string
      }> => result.status === "fulfilled",
    )
    const failures = raced.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toMatchObject({ code: "23505" })
    const winnerIndex = raced.findIndex((result) => result.status === "fulfilled")
    const winningCorrelation = [firstCorrelation, secondCorrelation][winnerIndex]
    const [reservedState] = await fixture.ownerSql<
      [{ revokedSessions: number; activeSessions: number }]
    >`
      select
        count(*) filter (where state = 'revoked')::integer as "revokedSessions",
        count(*) filter (where state = 'active')::integer as "activeSessions"
      from private.auth_session_controls
      where user_id = ${fixture.memberA.userId}::uuid
    `
    expect(reservedState).toEqual({ revokedSessions: 2, activeSessions: 0 })
    await bffDb.failTemporaryPasswordReset({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationId: successes[0]!.value.operationId,
      reasonCode: "AUTH_CALL_NOT_ATTEMPTED",
      correlationId: winningCorrelation!,
    })

    const temporaryPassword = "Axsys-Temp-Initial-42!"
    const success = await temporaryPasswordPost(
      fixture.request(
        "/api/auth/temporary-password",
        {
          targetUserId: fixture.memberA.userId,
          password: temporaryPassword,
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
        fixture.adminA.jar,
      ),
    )
    expect(success.status).toBe(200)
    expectNoStore(success)
    const successText = await success.text()
    expect(successText).not.toContain(temporaryPassword)
    expect(JSON.parse(successText)).toMatchObject({ status: "completed" })

    const [profile] = await fixture.ownerSql<
      [{ mustChange: boolean; expiresAt: Date; activeSessions: number }]
    >`
      select profile.must_change_password as "mustChange",
             profile.temporary_password_expires_at as "expiresAt",
             (select count(*)::integer
              from private.auth_session_controls control
              where control.user_id = profile.user_id
                and control.state = 'active') as "activeSessions"
      from public.profiles profile
      where profile.user_id = ${fixture.memberA.userId}::uuid
    `
    expect(profile.mustChange).toBe(true)
    const observedAt = Date.now()
    expect(profile.expiresAt.getTime()).toBeGreaterThan(observedAt + 23 * 60 * 60_000)
    expect(profile.expiresAt.getTime()).toBeLessThanOrEqual(
      observedAt + 24 * 60 * 60_000 + 1_000,
    )
    expect(profile.activeSessions).toBe(0)

    const oldJwtResponse = await fetch(
      `${fixture.supabaseUrl}rest/v1/profiles?select=user_id`,
      {
        headers: {
          apikey: requireSecret(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
          authorization: `Bearer ${oldAccessToken}`,
        },
        cache: "no-store",
      },
    )
    expect(oldJwtResponse.status).toBe(200)
    await expect(oldJwtResponse.json()).resolves.toEqual([])
  }, 30_000)

  it("keeps every injected failure closed, redacted and safely retryable", async () => {
    const actor = await fixture.adminContext()
    const passwords = [
      "Axsys-Temp-BeforeAuth-42!",
      "Axsys-Temp-DuringAuth-42!",
      "Axsys-Temp-AfterAuth-42!",
      "Axsys-Temp-FinalRetry-42!",
    ] as const
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const thrownTexts: string[] = []

    const cases = [
      {
        password: passwords[0],
        dependencies: {
          beforeAuthUpdate: async () => {
            throw new Error(`raw ${passwords[0]}`)
          },
        },
        reasonCode: "AUTH_CALL_NOT_ATTEMPTED",
      },
      {
        password: passwords[1],
        dependencies: {
          updateAuthPassword: async () => {
            throw new Error(`raw ${passwords[1]}`)
          },
        },
        reasonCode: "AUTH_PROVIDER_FAILURE",
      },
      {
        password: passwords[2],
        dependencies: {
          afterAuthUpdate: async () => {
            throw new Error(`raw ${passwords[2]}`)
          },
        },
        reasonCode: "AUTH_COMPLETION_FAILURE",
      },
    ] as const

    try {
      for (const failureCase of cases) {
        const correlationId = fixture.nextCorrelationId()
        let thrown: unknown
        try {
          await setTemporaryPassword(
            {
              actor,
              targetUserId: fixture.memberA.userId,
              password: failureCase.password,
              reasonCode: "ADMIN_RESET_USER_REQUEST",
              correlationId,
            },
            failureCase.dependencies,
          )
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(TemporaryPasswordRetryRequiredError)
        expect(thrown).toMatchObject({ operationStatus: "failed" })
        const thrownText = JSON.stringify(thrown)
        thrownTexts.push(thrownText)
        expect(thrownText).not.toContain(failureCase.password)

        const [operation] = await fixture.ownerSql<
          [{ status: string; reasonCode: string; mustChange: boolean }]
        >`
          select operation.status::text,
                 operation.reason_code as "reasonCode",
                 profile.must_change_password as "mustChange"
          from private.auth_password_operations operation
          join public.profiles profile on profile.user_id = operation.target_user_id
          where operation.correlation_id = ${correlationId}::uuid
        `
        expect(operation).toEqual({
          status: "failed",
          reasonCode: failureCase.reasonCode,
          mustChange: true,
        })
      }

      const finalCorrelation = fixture.nextCorrelationId()
      await expect(
        setTemporaryPassword({
          actor,
          targetUserId: fixture.memberA.userId,
          password: passwords[3],
          reasonCode: "ADMIN_RESET_USER_REQUEST",
          correlationId: finalCorrelation,
        }),
      ).resolves.toMatchObject({ status: "completed" })

      const [leaks] = await fixture.ownerSql<[{ count: number }]>`
        select (
          (select count(*)
           from public.audit_events audit
           cross join unnest(${[...passwords]}::text[]) secret(value)
           where position(secret.value in row_to_json(audit)::text) > 0)
          +
          (select count(*)
           from private.auth_password_operations operation
           cross join unnest(${[...passwords]}::text[]) secret(value)
           where position(secret.value in row_to_json(operation)::text) > 0)
        )::integer as count
      `
      expect(leaks.count).toBe(0)
      const consoleText = JSON.stringify([
        ...consoleLog.mock.calls,
        ...consoleError.mock.calls,
        ...consoleWarn.mock.calls,
      ])
      for (const password of passwords) {
        expect(consoleText).not.toContain(password)
        expect(thrownTexts.join(" ")).not.toContain(password)
      }
    } finally {
      consoleLog.mockRestore()
      consoleError.mockRestore()
      consoleWarn.mockRestore()
    }
  }, 30_000)

  it("rejects a genuinely expired forced change before modifying Auth", async () => {
    const temporaryPassword = "Axsys-Temp-FinalRetry-42!"
    const rejectedPassword = "Axsys-Expired-Must-Not-Apply-42!"
    const expiredJar: Task11CookieJar = new Map()
    requestCookies.current = expiredJar

    const login = await loginPost(
      fixture.request(
        "/api/auth/login",
        {
          email: fixture.memberA.email,
          password: temporaryPassword,
          rememberMe: false,
        },
        expiredJar,
        fixture.nextCorrelationId(),
        "203.0.113.123",
      ),
    )
    expect(login.status).toBe(200)
    await expect(login.json()).resolves.toEqual({ redirectTo: "/change-password" })

    const [before] = await fixture.ownerSql<[{ encryptedPassword: string }]>`
      select encrypted_password as "encryptedPassword"
      from auth.users
      where id = ${fixture.memberA.userId}::uuid
    `

    try {
      await fixture.ownerSql`
        update public.profiles
        set temporary_password_expires_at = clock_timestamp() - interval '1 minute'
        where user_id = ${fixture.memberA.userId}::uuid
      `

      const change = await changePasswordPost(
        fixture.request(
          "/api/auth/change-password",
          { password: rejectedPassword, confirmation: rejectedPassword },
          expiredJar,
        ),
      )
      expect(change.status).toBe(403)
      expectNoStore(change)
      await expect(change.json()).resolves.toMatchObject({
        error: { code: "TEMPORARY_PASSWORD_EXPIRED" },
      })

      const [after] = await fixture.ownerSql<[{ encryptedPassword: string }]>`
        select encrypted_password as "encryptedPassword"
        from auth.users
        where id = ${fixture.memberA.userId}::uuid
      `
      expect(after.encryptedPassword).toBe(before.encryptedPassword)
    } finally {
      await fixture.ownerSql`
        update public.profiles
        set temporary_password_expires_at = clock_timestamp() + interval '24 hours'
        where user_id = ${fixture.memberA.userId}::uuid
      `
    }
  }, 30_000)

  it("changes the valid temporary password, signs out, and accepts only the definitive password", async () => {
    const temporaryPassword = "Axsys-Temp-FinalRetry-42!"
    const permanentPassword = "Axsys-Permanent-Password-84!"
    const targetJar: Task11CookieJar = new Map()
    requestCookies.current = targetJar
    fixture.rawRateKeys.add(fixture.memberA.email)

    const login = await loginPost(
      fixture.request(
        "/api/auth/login",
        {
          email: fixture.memberA.email,
          password: temporaryPassword,
          rememberMe: false,
        },
        targetJar,
        fixture.nextCorrelationId(),
        "203.0.113.121",
      ),
    )
    expect(login.status).toBe(200)
    expectNoStore(login)
    await expect(login.json()).resolves.toEqual({ redirectTo: "/change-password" })
    await expect(getAccessContext()).resolves.toMatchObject({
      status: "password_change",
      userId: fixture.memberA.userId,
      expired: false,
    })

    const change = await changePasswordPost(
      fixture.request(
        "/api/auth/change-password",
        { password: permanentPassword, confirmation: permanentPassword },
        targetJar,
      ),
    )
    expect(change.status).toBe(200)
    expectNoStore(change)
    await expect(change.json()).resolves.toEqual({ redirectTo: "/login" })
    expect([...targetJar.keys()].some((name) => name.includes("auth-token"))).toBe(false)

    const [profile] = await fixture.ownerSql<
      [{ mustChange: boolean; expiresAt: Date | null; changedAt: Date | null; activeSessions: number }]
    >`
      select profile.must_change_password as "mustChange",
             profile.temporary_password_expires_at as "expiresAt",
             profile.password_changed_at as "changedAt",
             (select count(*)::integer
              from private.auth_session_controls control
              where control.user_id = profile.user_id
                and control.state = 'active') as "activeSessions"
      from public.profiles profile
      where profile.user_id = ${fixture.memberA.userId}::uuid
    `
    expect(profile.mustChange).toBe(false)
    expect(profile.expiresAt).toBeNull()
    expect(profile.changedAt).toBeInstanceOf(Date)
    expect(profile.activeSessions).toBe(0)

    const rejectedJar: Task11CookieJar = new Map()
    requestCookies.current = rejectedJar
    const rejectedTemporaryLogin = await loginPost(
      fixture.request(
        "/api/auth/login",
        {
          email: fixture.memberA.email,
          password: temporaryPassword,
          rememberMe: false,
        },
        rejectedJar,
        fixture.nextCorrelationId(),
        "203.0.113.124",
      ),
    )
    expect(rejectedTemporaryLogin.status).toBe(401)
    expectNoStore(rejectedTemporaryLogin)
    await expect(rejectedTemporaryLogin.json()).resolves.toMatchObject({
      error: { code: "AUTH_INVALID_CREDENTIALS" },
    })

    requestCookies.current = targetJar
    const finalLogin = await loginPost(
      fixture.request(
        "/api/auth/login",
        {
          email: fixture.memberA.email,
          password: permanentPassword,
          rememberMe: false,
        },
        targetJar,
        fixture.nextCorrelationId(),
        "203.0.113.125",
      ),
    )
    expect(finalLogin.status).toBe(200)
    expectNoStore(finalLogin)
    await expect(finalLogin.json()).resolves.toEqual({
      redirectTo: "/app/dashboard",
    })
  }, 30_000)
})
