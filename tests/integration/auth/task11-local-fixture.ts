import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import {
  consumeRateLimit,
  type RateLimitBucket,
} from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local integration environment directly.
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

function requireLocalUrl(value: string | undefined, port: string): string {
  if (!value) throw new Error("Task 11 local fixture is unavailable")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Task 11 local fixture is unavailable")
  }
  if (
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== port ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Task 11 local fixture is unavailable")
  }
  return url.toString()
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error("Task 11 local fixture is unavailable")
  }
  return value
}

export type Task11CookieJar = Map<string, string>

export function cookieStoreFor(jar: Task11CookieJar) {
  return {
    delete: (name: string) => jar.delete(name),
    get: (name: string) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name)
      else jar.set(name, value)
    },
  }
}

export class Task11LocalFixture {
  readonly jar: Task11CookieJar = new Map()
  readonly email = `task11-${randomUUID()}@example.test`
  readonly password = `Axsys-${randomBytes(24).toString("base64url")}!`
  userId = ""
  companyId = ""
  membershipId = ""
  readonly correlationIds = new Set<string>()
  readonly rawRateKeys = new Set<string>()

  private readonly supabaseUrl = requireLocalUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "54321",
  )
  private readonly databaseUrl = requireLocalUrl(
    process.env.DATABASE_URL,
    "54322",
  )
  private readonly applicationName = `axsys-task11-integration-${randomUUID()}`
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
  private readonly ownerSql = postgres(this.databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: this.applicationName,
      lock_timeout: 6_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 10_000,
    },
  })
  private created = false

  private async createIdentityProfile(): Promise<void> {
    if (this.created) throw new Error("Task 11 Auth fixture already exists")
    const created = await this.admin.auth.admin.createUser({
      email: this.email,
      password: this.password,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 11 Auth fixture creation failed")
    }
    this.userId = created.data.user.id
    this.created = true
    await this.ownerSql`
      insert into public.profiles (user_id, email, display_name)
      values (${this.userId}::uuid, ${this.email}, 'Task 11 Identity')
    `
  }

  async createPlatformIdentity(): Promise<void> {
    await this.createIdentityProfile()
    await this.ownerSql`
      insert into public.platform_roles (user_id)
      values (${this.userId}::uuid)
    `
  }

  async createCompanyIdentity(): Promise<void> {
    await this.createIdentityProfile()
    this.companyId = randomUUID()
    this.membershipId = randomUUID()
    const cnpj = `98${randomInt(0, 1_000_000_000_000)
      .toString()
      .padStart(12, "0")}`
    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.companies (
          id, legal_name, trade_name, cnpj_normalized, contact_email
        ) values (
          ${this.companyId}::uuid,
          'Task 11 Company',
          'Task 11',
          ${cnpj},
          ${this.email}
        )
      `
      await transaction`
        insert into public.company_memberships (
          id, company_id, user_id, role
        ) values (
          ${this.membershipId}::uuid,
          ${this.companyId}::uuid,
          ${this.userId}::uuid,
          'company_admin'
        )
      `
      await transaction`
        insert into public.member_modules (company_id, membership_id, module)
        values
          (${this.companyId}::uuid, ${this.membershipId}::uuid, 'administrative'),
          (${this.companyId}::uuid, ${this.membershipId}::uuid, 'certificates')
      `
    })
  }

  async markTemporaryPasswordExpired(): Promise<void> {
    const rows = await this.ownerSql<{ userId: string }[]>`
      update public.profiles
      set must_change_password = true,
          temporary_password_expires_at = clock_timestamp() - interval '1 minute'
      where user_id = ${this.userId}::uuid
      returning user_id as "userId"
    `
    if (rows.length !== 1 || rows[0]?.userId !== this.userId) {
      throw new Error("Task 11 temporary-password fixture update failed")
    }
  }

  async preseedRateLimit(
    bucket: RateLimitBucket,
    rawKey: string,
    attempts: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts > 100) {
      throw new Error("Task 11 rate-limit preseed is invalid")
    }
    this.addRateKey(rawKey)
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const decision = await consumeRateLimit(bucket, rawKey)
      if (!decision.allowed || decision.attempts !== attempt) {
        throw new Error("Task 11 rate-limit preseed failed")
      }
    }
  }

  issueCsrf(): string {
    const token = createCsrfToken(requireSecret(process.env.CSRF_SECRET))
    this.jar.set(CSRF_COOKIE_NAME, token)
    return token
  }

  nextCorrelationId(): string {
    const id = randomUUID()
    this.correlationIds.add(id)
    return id
  }

  addRateKey(rawKey: string): void {
    this.rawRateKeys.add(rawKey)
  }

  async signInAndActivate(): Promise<{
    accessToken: string
    sessionId: string
  }> {
    const client = await createServerSupabase()
    const signedIn = await client.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    })
    if (signedIn.error || !signedIn.data.session) {
      throw new Error("Task 11 Auth fixture sign-in failed")
    }
    const claims = await client.auth.getClaims()
    const sessionId = claims.data?.claims.session_id
    if (claims.error || typeof sessionId !== "string") {
      throw new Error("Task 11 Auth fixture claims failed")
    }
    const rows = await this.ownerSql<{ id: string }[]>`
      insert into private.auth_session_controls (
        session_id, user_id, auth_created_at, remember_me, state,
        absolute_expires_at, audit_scope, activated_at, last_seen_at,
        created_at, updated_at
      )
      select auth_session.id, auth_session.user_id, auth_session.created_at,
        false, 'active'::private.auth_session_state,
        least(
          auth_session.created_at + interval '8 hours',
          coalesce(auth_session.not_after, auth_session.created_at + interval '8 hours')
        ),
        'platform'::public.audit_scope, clock_timestamp(), clock_timestamp(),
        clock_timestamp(), clock_timestamp()
      from auth.sessions auth_session
      where auth_session.id = ${sessionId}::uuid
        and auth_session.user_id = ${this.userId}::uuid
      returning session_id as id
    `
    if (rows.length !== 1) {
      throw new Error("Task 11 app-session fixture activation failed")
    }
    return { accessToken: signedIn.data.session.access_token, sessionId }
  }

  async sessionState(sessionId: string): Promise<string | null> {
    const rows = await this.ownerSql<{ state: string }[]>`
      select state::text
      from private.auth_session_controls
      where session_id = ${sessionId}::uuid
    `
    return rows[0]?.state ?? null
  }

  async sessionStates(): Promise<string[]> {
    const rows = await this.ownerSql<{ state: string }[]>`
      select state::text
      from private.auth_session_controls
      where user_id = ${this.userId}::uuid
      order by created_at
    `
    return rows.map(({ state }) => state)
  }

  async auditCount(action: string): Promise<number> {
    const [row] = await this.ownerSql<[{ count: number }]>`
      select count(*)::integer as count
      from public.audit_events
      where actor_user_id = ${this.userId}::uuid
        and action = ${action}
    `
    return row.count
  }

  async securityEventCount(eventType: string): Promise<number> {
    const [row] = await this.ownerSql<[{ count: number }]>`
      select count(*)::integer as count
      from public.security_events
      where event_type = ${eventType}
        and correlation_id = any(${[...this.correlationIds]}::uuid[])
        and jsonb_typeof(metadata) = 'object'
    `
    return row.count
  }

  async cleanup(): Promise<void> {
    const correlationIds = [...this.correlationIds]
    const rateHashes = [...this.rawRateKeys].map((raw) => hashSensitive(raw))
    let cleanupFailure: unknown
    try {
      if (this.userId !== "") {
        await this.ownerSql.begin(async (transaction) => {
          await transaction`alter table public.audit_events disable trigger audit_events_append_only`
          await transaction`alter table public.security_events disable trigger security_events_append_only`
          await transaction`
            delete from public.audit_events
            where actor_user_id = ${this.userId}::uuid
               or correlation_id = any(${correlationIds}::uuid[])
          `
          await transaction`
            delete from public.security_events
            where correlation_id = any(${correlationIds}::uuid[])
          `
          await transaction`alter table public.audit_events enable trigger audit_events_append_only`
          await transaction`alter table public.security_events enable trigger security_events_append_only`
          if (rateHashes.length > 0) {
            await transaction`
              delete from private.rate_limit_buckets
              where key_hash = any(${rateHashes}::text[])
            `
          }
          await transaction`
            delete from private.auth_session_controls
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.platform_roles
            where user_id = ${this.userId}::uuid
          `
          if (this.membershipId !== "") {
            await transaction`
              alter table public.company_memberships
              disable trigger protect_last_company_admin
            `
            await transaction`
              delete from public.member_modules
              where membership_id = ${this.membershipId}::uuid
            `
            await transaction`
              delete from public.company_memberships
              where id = ${this.membershipId}::uuid
            `
            await transaction`
              alter table public.company_memberships
              enable trigger protect_last_company_admin
            `
          }
          if (this.companyId !== "") {
            await transaction`
              delete from public.companies
              where id = ${this.companyId}::uuid
            `
          }
          await transaction`
            delete from public.profiles
            where user_id = ${this.userId}::uuid
          `
        })
        if (this.created) {
          const deleted = await this.admin.auth.admin.deleteUser(this.userId)
          if (deleted.error) {
            throw new Error("Task 11 Auth fixture cleanup failed")
          }
        }

        const [residue] = await this.ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users where id = ${this.userId}::uuid)
            + (select count(*) from auth.sessions where user_id = ${this.userId}::uuid)
            + (select count(*) from public.profiles where user_id = ${this.userId}::uuid)
            + (select count(*) from public.platform_roles where user_id = ${this.userId}::uuid)
            + (select count(*) from public.company_memberships where user_id = ${this.userId}::uuid)
            + (select count(*) from public.member_modules
               where membership_id = nullif(${this.membershipId}, '')::uuid)
            + (select count(*) from public.companies
               where id = nullif(${this.companyId}, '')::uuid)
            + (select count(*) from private.auth_session_controls where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_user_session_cutoffs where user_id = ${this.userId}::uuid)
            + (select count(*) from public.audit_events
               where actor_user_id = ${this.userId}::uuid
                  or correlation_id = any(${correlationIds}::uuid[]))
            + (select count(*) from public.security_events
               where correlation_id = any(${correlationIds}::uuid[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) {
          throw new Error("Task 11 fixture left database residue")
        }
      }
    } catch (error) {
      cleanupFailure = error
    } finally {
      this.jar.clear()
      await this.ownerSql.end({ timeout: 2 })
    }

    const verifier = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: "axsys-task11-cleanup-verifier" },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = ${this.applicationName}
      `
      if (connections.count !== 0) {
        throw new Error("Task 11 fixture left database connections")
      }
    } finally {
      await verifier.end({ timeout: 2 })
    }
    if (cleanupFailure) throw cleanupFailure
  }
}
