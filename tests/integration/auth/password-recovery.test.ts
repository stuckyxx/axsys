import { createHash, randomBytes, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { GET as callbackGet } from "@/app/auth/callback/route"
import { POST as forgotPasswordPost } from "@/app/api/auth/forgot-password/route"
import { POST as resetPasswordPost } from "@/app/api/auth/reset-password/route"
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"
import type { Database } from "@/lib/supabase/database.types"
import {
  PasswordRecoveryRetryRequiredError,
  RECOVERY_GRANT_COOKIE_NAME,
  resetRecoveredPassword,
} from "@/modules/auth/server/reset-recovered-password"
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

type CookieOptions = Readonly<{
  domain?: string
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: boolean | "lax" | "strict" | "none"
  secure?: boolean
}>

type CookieEntry = { value: string; options: CookieOptions }
type RecoveryCookieJar = Map<string, CookieEntry>

const requestCookies = vi.hoisted(() => ({
  current: undefined as RecoveryCookieJar | undefined,
}))

function cookieStoreFor(jar: RecoveryCookieJar) {
  return {
    delete: (name: string) => jar.delete(name),
    get: (name: string) => {
      const entry = jar.get(name)
      return entry ? { name, value: entry.value } : undefined
    },
    getAll: () =>
      [...jar].map(([name, entry]) => ({ name, value: entry.value })),
    set: (name: string, value: string, options: CookieOptions = {}) => {
      if (value === "" || options.maxAge === 0) jar.delete(name)
      else jar.set(name, { value, options: Object.freeze({ ...options }) })
    },
  }
}

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current) throw new Error("Recovery cookie jar unavailable")
    return cookieStoreFor(requestCookies.current)
  },
}))

const FIXTURE_NAME = "Task 13 password-recovery integration"
const NEUTRAL_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos as instruções."

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) throw new Error(`${FIXTURE_NAME} unavailable`)
  return value
}

function setCookie(
  jar: RecoveryCookieJar,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  jar.set(name, { value, options: Object.freeze({ ...options }) })
}

type Identity = {
  email: string
  password: string
  userId: string
}

type MailpitSummary = {
  ID: string
  To?: Array<{ Address?: string }>
}

class Task13Fixture {
  readonly appOrigin = requireLocalHttpUrl(
    process.env.APP_ORIGIN,
    "3000",
    FIXTURE_NAME,
  ).replace(/\/$/u, "")
  readonly supabaseUrl = requireLocalHttpUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "54321",
    FIXTURE_NAME,
  ).replace(/\/$/u, "")
  readonly mailpitUrl = requireLocalHttpUrl(
    "http://127.0.0.1:54324",
    "54324",
    FIXTURE_NAME,
  ).replace(/\/$/u, "")
  readonly databaseUrl = requireLocalOwnerDatabaseUrl(
    process.env.DATABASE_URL,
    FIXTURE_NAME,
  )
  readonly known = this.identity("known")
  readonly failures = [
    this.identity("before-auth"),
    this.identity("during-auth"),
    this.identity("after-auth"),
  ] as const
  readonly correlationIds = new Set<string>()
  readonly rateKeys = new Set<string>()
  readonly jar: RecoveryCookieJar = new Map()
  readonly ownerSql = postgres(this.databaseUrl, {
    max: 3,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: `axsys-task13-integration-${randomUUID()}`,
      lock_timeout: 6_000,
      statement_timeout: 12_000,
      idle_in_transaction_session_timeout: 12_000,
    },
  })

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

  oldAccessToken = ""
  oldSessionId = ""

  private identity(label: string): Identity {
    return {
      email: `task13-${label}-${randomUUID()}@example.test`,
      password: `Axsys-${randomBytes(23).toString("base64url")}!7q`,
      userId: "",
    }
  }

  nextCorrelationId(): string {
    const correlationId = randomUUID()
    this.correlationIds.add(correlationId)
    return correlationId
  }

  issueCsrf(jar: RecoveryCookieJar): string {
    const token = createCsrfToken(requireSecret(process.env.CSRF_SECRET))
    setCookie(jar, CSRF_COOKIE_NAME, token, {
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    })
    return token
  }

  request(input: {
    path: string
    body: unknown
    jar: RecoveryCookieJar
    origin?: string
    csrf?: string | null
    ip?: string
  }): Request {
    const ip = input.ip ?? `203.0.113.${20 + this.rateKeys.size}`
    this.rateKeys.add(ip)
    const headers = new Headers({
      "content-type": "application/json",
      "x-correlation-id": this.nextCorrelationId(),
      "x-forwarded-for": ip,
    })
    if (input.origin !== undefined) headers.set("origin", input.origin)
    if (input.csrf !== null) {
      headers.set("x-csrf-token", input.csrf ?? this.issueCsrf(input.jar))
    }
    return new Request(`${this.appOrigin}${input.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
    })
  }

  async create(): Promise<void> {
    for (const identity of [this.known, ...this.failures]) {
      const created = await this.admin.auth.admin.createUser({
        email: identity.email,
        password: identity.password,
        email_confirm: true,
      })
      if (created.error || !created.data.user) {
        throw new Error("Task 13 Auth fixture creation failed")
      }
      identity.userId = created.data.user.id
    }

    await this.ownerSql.begin(async (transaction) => {
      for (const identity of [this.known, ...this.failures]) {
        await transaction`
          insert into public.profiles (user_id, email, display_name)
          values (
            ${identity.userId}::uuid,
            ${identity.email},
            ${`Task 13 ${identity.email.split("@")[0]}`}
          )
        `
        await transaction`
          insert into public.platform_roles (user_id)
          values (${identity.userId}::uuid)
        `
      }
    })

    const oldClient = createClient<Database>(
      this.supabaseUrl,
      requireSecret(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    )
    const signedIn = await oldClient.auth.signInWithPassword({
      email: this.known.email,
      password: this.known.password,
    })
    if (signedIn.error || !signedIn.data.session) {
      throw new Error("Task 13 old session sign-in failed")
    }
    this.oldAccessToken = signedIn.data.session.access_token
    const claims = await oldClient.auth.getClaims(this.oldAccessToken)
    const sessionId = claims.data?.claims.session_id
    if (claims.error || typeof sessionId !== "string") {
      throw new Error("Task 13 old session claims failed")
    }
    this.oldSessionId = sessionId
    const controls = await this.ownerSql<{ id: string }[]>`
      insert into private.auth_session_controls (
        session_id, user_id, auth_created_at, remember_me, state,
        absolute_expires_at, audit_scope, audit_company_id,
        activated_at, last_seen_at, created_at, updated_at
      )
      select id, user_id, created_at, false, 'active',
             clock_timestamp() + interval '8 hours',
             'platform', null,
             clock_timestamp(), clock_timestamp(),
             clock_timestamp(), clock_timestamp()
      from auth.sessions
      where id = ${sessionId}::uuid
        and user_id = ${this.known.userId}::uuid
      returning session_id as id
    `
    if (controls.length !== 1) throw new Error("Task 13 control activation failed")
    await this.clearMail()
  }

  async clearMail(): Promise<void> {
    const response = await fetch(`${this.mailpitUrl}/api/v1/messages`, {
      method: "DELETE",
      cache: "no-store",
    })
    if (!response.ok) throw new Error("Task 13 Mailpit cleanup failed")
  }

  async mailFor(email: string): Promise<MailpitSummary[]> {
    const response = await fetch(`${this.mailpitUrl}/api/v1/messages`, {
      cache: "no-store",
    })
    if (!response.ok) throw new Error("Task 13 Mailpit list failed")
    const body = (await response.json()) as { messages?: MailpitSummary[] }
    return (body.messages ?? []).filter((message) =>
      message.To?.some(({ Address }) => Address?.toLowerCase() === email),
    )
  }

  async recoveryLink(messageId: string): Promise<string> {
    const response = await fetch(
      `${this.mailpitUrl}/api/v1/message/${encodeURIComponent(messageId)}`,
      { cache: "no-store" },
    )
    if (!response.ok) throw new Error("Task 13 Mailpit message failed")
    const body = (await response.json()) as { HTML?: string; Text?: string }
    const contents = `${body.Text ?? ""}\n${body.HTML ?? ""}`.replaceAll(
      "&amp;",
      "&",
    )
    const links = contents.match(/https?:\/\/[^\s"'<>]+/gu) ?? []
    const link = links.find((candidate) => candidate.includes("/auth/v1/verify"))
    if (!link) throw new Error("Task 13 recovery link missing")
    return link
  }

  async oldSessionCanReadProfile(): Promise<boolean> {
    const response = await fetch(
      `${this.supabaseUrl}/rest/v1/profiles?select=user_id&user_id=eq.${this.known.userId}`,
      {
        headers: {
          apikey: requireSecret(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
          authorization: `Bearer ${this.oldAccessToken}`,
        },
        cache: "no-store",
      },
    )
    if (!response.ok) throw new Error("Task 13 RLS probe failed")
    const rows = (await response.json()) as unknown[]
    return rows.length === 1
  }

  async passwordCanSignIn(email: string, password: string): Promise<boolean> {
    const probe = createClient<Database>(
      this.supabaseUrl,
      requireSecret(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    )
    const result = await probe.auth.signInWithPassword({ email, password })
    return result.error === null
  }

  async directRecovery(identity: Identity, jar: RecoveryCookieJar) {
    const sessionId = randomUUID()
    const rawGrant = randomBytes(32).toString("base64url")
    const grantHash = createHash("sha256").update(rawGrant).digest("hex")
    await this.ownerSql`
      insert into auth.sessions (id, user_id, created_at, updated_at)
      values (
        ${sessionId}::uuid,
        ${identity.userId}::uuid,
        clock_timestamp(),
        clock_timestamp()
      )
    `
    await this.ownerSql`
      insert into private.password_recovery_grants (
        grant_hash, user_id, session_id, expires_at,
        created_at, updated_at
      ) values (
        ${grantHash}, ${identity.userId}::uuid, ${sessionId}::uuid,
        clock_timestamp() + interval '5 minutes',
        clock_timestamp(), clock_timestamp()
      )
    `
    setCookie(jar, RECOVERY_GRANT_COOKIE_NAME, rawGrant, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 300,
    })
    return {
      sessionId,
      claims: {
        sub: identity.userId,
        session_id: sessionId,
        is_anonymous: false,
        amr: [
          {
            method: "recovery",
            timestamp: Math.floor(Date.now() / 1_000),
          },
        ],
      },
    }
  }

  async cleanup(): Promise<void> {
    const identities = [this.known, ...this.failures]
    const userIds = identities.map(({ userId }) => userId).filter(Boolean)
    const rateHashes = [
      ...this.rateKeys,
      ...identities.map(({ email }) => email),
      unknownEmail,
    ].map((value) => hashSensitive(value))
    let cleanupError: unknown

    try {
      await this.ownerSql.begin(async (transaction) => {
        await transaction`alter table public.audit_events disable trigger audit_events_append_only`
        await transaction`alter table public.security_events disable trigger security_events_append_only`
        await transaction`
          delete from public.audit_events
          where actor_user_id = any(${userIds}::uuid[])
             or resource_id = any(${userIds}::uuid[])
             or correlation_id = any(${[...this.correlationIds]}::uuid[])
        `
        await transaction`
          delete from public.security_events
          where user_id = any(${userIds}::uuid[])
             or correlation_id = any(${[...this.correlationIds]}::uuid[])
        `
        await transaction`alter table public.audit_events enable trigger audit_events_append_only`
        await transaction`alter table public.security_events enable trigger security_events_append_only`
        await transaction`
          delete from private.auth_password_operations
          where target_user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from private.password_recovery_grants
          where user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from private.rate_limit_buckets
          where key_hash = any(${rateHashes}::text[])
        `
        await transaction`
          delete from private.auth_session_controls
          where user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from private.auth_user_session_cutoffs
          where user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from auth.refresh_tokens
          where user_id = any(${userIds}::text[])
        `
        await transaction`
          delete from auth.sessions where user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from public.platform_roles
          where user_id = any(${userIds}::uuid[])
        `
        await transaction`
          delete from public.profiles where user_id = any(${userIds}::uuid[])
        `
      })
    } catch (error) {
      cleanupError = error
    }

    for (const identity of identities) {
      if (!identity.userId) continue
      try {
        const deleted = await this.admin.auth.admin.deleteUser(identity.userId, false)
        if (deleted.error) throw new Error("Task 13 Auth cleanup failed")
      } catch (error) {
        cleanupError ??= error
      }
    }

    try {
      await this.ownerSql.begin(async (transaction) => {
        await transaction`
          delete from auth.refresh_tokens
          where user_id = any(${userIds}::text[])
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
      await this.clearMail()
    } catch (error) {
      cleanupError ??= error
    }

    requestCookies.current = undefined
    await this.ownerSql.end({ timeout: 2 })
    if (cleanupError) throw cleanupError
  }
}

const fixture = new Task13Fixture()
const unknownEmail = `task13-unknown-${randomUUID()}@example.test`
const unknownJar: RecoveryCookieJar = new Map()

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  vi.stubEnv("CLAMAV_HOST", "127.0.0.1")
  vi.stubEnv("CLAMAV_PORT", "3310")
  vi.stubEnv(
    "SUPABASE_STORAGE_TUS_ENDPOINT",
    "http://127.0.0.1:54321/storage/v1/upload/resumable",
  )
  vi.stubEnv(
    "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64",
    Buffer.alloc(32, 11).toString("base64"),
  )
  vi.stubEnv(
    "PII_ENCRYPTION_KEY_V1_BASE64",
    Buffer.alloc(32, 12).toString("base64"),
  )
  await fixture.create()
}, 30_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    vi.unstubAllEnvs()
  }
}, 30_000)

describe.sequential("Task 13 real email password recovery", () => {
  it("rejects forged Origin and missing CSRF without sending mail", async () => {
    requestCookies.current = fixture.jar
    const csrf = fixture.issueCsrf(fixture.jar)
    const evil = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: fixture.known.email },
        jar: fixture.jar,
        origin: "https://evil.example.test",
        csrf,
      }),
    )
    const missing = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: fixture.known.email },
        jar: fixture.jar,
        origin: fixture.appOrigin,
        csrf: null,
      }),
    )

    expect(evil.status).toBe(403)
    expect(missing.status).toBe(403)
    expectNoStore(evil)
    expectNoStore(missing)
    expect(await fixture.mailFor(fixture.known.email)).toHaveLength(0)
  })

  it("rejects an untrusted callback query without mutating pre-exchange state", async () => {
    requestCookies.current = fixture.jar
    const recoveryGrant = randomBytes(32).toString("base64url")
    const authCookieName = `sb-${new URL(fixture.supabaseUrl).hostname.split(".")[0]}-auth-token`
    const verifierCookieName = `${authCookieName}-code-verifier`
    const verifierCookieValue = `base64-${Buffer.from(
      JSON.stringify(`${"a".repeat(56)}/recovery`),
      "utf8",
    ).toString("base64url")}`
    setCookie(fixture.jar, RECOVERY_GRANT_COOKIE_NAME, recoveryGrant)
    setCookie(fixture.jar, verifierCookieName, verifierCookieValue)

    const response = await callbackGet(
      new Request(
        `${fixture.appOrigin}/auth/callback?code=untrusted&next=${encodeURIComponent("https://evil.example.test")}`,
      ),
    )

    expect(response.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    expectNoStore(response)
    expect(fixture.jar.get(RECOVERY_GRANT_COOKIE_NAME)?.value).toBe(
      recoveryGrant,
    )
    expect(
      fixture.jar.get(verifierCookieName)?.value,
    ).toBe(verifierCookieValue)

    const failedExchange = await callbackGet(
      new Request(
        `${fixture.appOrigin}/auth/callback?code=syntactically-valid-but-invalid&next=/reset-password`,
      ),
    )
    expect(failedExchange.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    expectNoStore(failedExchange)
    expect(fixture.jar.get(RECOVERY_GRANT_COOKIE_NAME)?.value).toBe(
      recoveryGrant,
    )
    expect(
      fixture.jar.get(verifierCookieName)?.value,
    ).toBe(verifierCookieValue)
    expect(fixture.jar.get(verifierCookieName)?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3_600,
    })
    fixture.jar.delete(RECOVERY_GRANT_COOKIE_NAME)
    fixture.jar.delete(verifierCookieName)
  })

  it("returns identical 202 bodies and Mailpit receives only the known account", async () => {
    requestCookies.current = fixture.jar
    const known = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: `  ${fixture.known.email.toUpperCase()}  ` },
        jar: fixture.jar,
        origin: fixture.appOrigin,
        ip: "203.0.113.31",
      }),
    )
    requestCookies.current = unknownJar
    const unknown = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: unknownEmail },
        jar: unknownJar,
        origin: fixture.appOrigin,
        ip: "203.0.113.32",
      }),
    )
    const knownBody = await known.text()
    const unknownBody = await unknown.text()

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(knownBody).toBe(unknownBody)
    expect(JSON.parse(knownBody)).toEqual({ message: NEUTRAL_MESSAGE })
    expectNoStore(known)
    expectNoStore(unknown)
    expect(await fixture.mailFor(fixture.known.email)).toHaveLength(1)
    expect(await fixture.mailFor(unknownEmail)).toHaveLength(0)
  }, 15_000)

  it("keeps known and unknown account-rate responses indistinguishable", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await consumeRateLimit("forgot-account-volume", fixture.known.email)
      await consumeRateLimit("forgot-account-volume", unknownEmail)
    }
    requestCookies.current = fixture.jar
    const known = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: fixture.known.email },
        jar: fixture.jar,
        origin: fixture.appOrigin,
        ip: "203.0.113.33",
      }),
    )
    requestCookies.current = unknownJar
    const unknown = await forgotPasswordPost(
      fixture.request({
        path: "/api/auth/forgot-password",
        body: { email: unknownEmail },
        jar: unknownJar,
        origin: fixture.appOrigin,
        ip: "203.0.113.34",
      }),
    )
    const knownBody = await known.text()
    const unknownBody = await unknown.text()

    expect(known.status).toBe(429)
    expect(unknown.status).toBe(429)
    expect(knownBody.length).toBe(unknownBody.length)
    expect(JSON.parse(knownBody).error).toMatchObject({
      code: "PASSWORD_RECOVERY_RATE_LIMITED",
      message: NEUTRAL_MESSAGE,
    })
    expect(JSON.parse(unknownBody).error).toMatchObject({
      code: "PASSWORD_RECOVERY_RATE_LIMITED",
      message: NEUTRAL_MESSAGE,
    })
    for (const response of [known, unknown]) {
      const retryAfter = Number(response.headers.get("retry-after"))
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(3_600)
      expectNoStore(response)
    }
  })

  it("exchanges one PKCE code, sets a strict short grant, resets once, and revokes old access", async () => {
    expect(await fixture.oldSessionCanReadProfile()).toBe(true)
    const [message] = await fixture.mailFor(fixture.known.email)
    const verifyLink = await fixture.recoveryLink(message.ID)
    const verification = await fetch(verifyLink, {
      redirect: "manual",
      cache: "no-store",
    })
    expect(verification.status).toBeGreaterThanOrEqual(300)
    expect(verification.status).toBeLessThan(400)
    const callbackLocation = verification.headers.get("location")
    expect(callbackLocation).not.toBeNull()
    const callbackUrl = new URL(callbackLocation!)
    expect(callbackUrl.pathname).toBe("/auth/callback")
    expect(callbackUrl.searchParams.get("next")).toBe("/reset-password")
    expect(callbackUrl.searchParams.get("code")).toBeTruthy()

    requestCookies.current = fixture.jar
    const verifierCookieName = `sb-${new URL(fixture.supabaseUrl).hostname.split(".")[0]}-auth-token-code-verifier`
    const realVerifier = fixture.jar.get(verifierCookieName)
    expect(realVerifier?.value).toBeTruthy()
    const failedExchange = await callbackGet(
      new Request(
        `${fixture.appOrigin}/auth/callback?code=invalid-before-real-exchange&next=/reset-password`,
      ),
    )
    expect(failedExchange.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    expectNoStore(failedExchange)
    expect(fixture.jar.get(verifierCookieName)?.value).toBe(realVerifier?.value)

    const external = await callbackGet(
      new Request(
        `${fixture.appOrigin}/auth/callback?code=${encodeURIComponent(callbackUrl.searchParams.get("code")!)}&next=${encodeURIComponent("https://evil.example.test")}`,
      ),
    )
    expect(external.status).toBeGreaterThanOrEqual(300)
    expect(external.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    expectNoStore(external)

    const callback = await callbackGet(new Request(callbackUrl))
    expect(callback.status).toBeGreaterThanOrEqual(300)
    expect(callback.headers.get("location")).toBe(
      `${fixture.appOrigin}/reset-password`,
    )
    expectNoStore(callback)
    const recoveryCookie = fixture.jar.get(RECOVERY_GRANT_COOKIE_NAME)
    expect(recoveryCookie).toBeDefined()
    expect(recoveryCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(recoveryCookie?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    })
    expect(recoveryCookie?.options.domain).toBeUndefined()
    expect(recoveryCookie?.options.maxAge).toBeGreaterThanOrEqual(1)
    expect(recoveryCookie?.options.maxAge).toBeLessThanOrEqual(600)
    const rawGrant = recoveryCookie!.value
    const authStateBeforeInvalidCode = [...fixture.jar]
      .filter(([name]) => name.includes("-auth-token"))
      .map(([name, entry]) => [name, entry.value] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const failedAfterExchange = await callbackGet(
      new Request(
        `${fixture.appOrigin}/auth/callback?code=invalid-after-real-exchange&next=/reset-password`,
      ),
    )
    expect(failedAfterExchange.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    expectNoStore(failedAfterExchange)
    expect(fixture.jar.get(RECOVERY_GRANT_COOKIE_NAME)?.value).toBe(rawGrant)
    expect(
      [...fixture.jar]
        .filter(([name]) => name.includes("-auth-token"))
        .map(([name, entry]) => [name, entry.value] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual(authStateBeforeInvalidCode)
    const [grantState] = await fixture.ownerSql<
      [{ count: number; rawPersisted: boolean }]
    >`
      select count(*)::integer as count,
             bool_or(grant_hash = ${rawGrant}) as "rawPersisted"
      from private.password_recovery_grants
      where user_id = ${fixture.known.userId}::uuid
    `
    expect(grantState).toEqual({ count: 1, rawPersisted: false })

    const newPassword = `Axsys-${randomBytes(24).toString("base64url")}!9z`
    const reset = await resetPasswordPost(
      fixture.request({
        path: "/api/auth/reset-password",
        body: { password: newPassword, confirmation: newPassword },
        jar: fixture.jar,
        origin: fixture.appOrigin,
        ip: "203.0.113.35",
      }),
    )
    expect(reset.status).toBe(200)
    expectNoStore(reset)
    await expect(reset.json()).resolves.toEqual({ redirectTo: "/login" })
    expect(fixture.jar.has(RECOVERY_GRANT_COOKIE_NAME)).toBe(false)
    expect(fixture.jar.has(CSRF_COOKIE_NAME)).toBe(false)
    expect(
      [...fixture.jar.keys()].some((name) => name.includes("-auth-token")),
    ).toBe(false)
    expect(await fixture.oldSessionCanReadProfile()).toBe(false)

    expect(
      await fixture.passwordCanSignIn(
        fixture.known.email,
        fixture.known.password,
      ),
    ).toBe(false)
    expect(
      await fixture.passwordCanSignIn(fixture.known.email, newPassword),
    ).toBe(true)

    requestCookies.current = fixture.jar
    const replayCallback = await callbackGet(new Request(callbackUrl))
    expect(replayCallback.headers.get("location")).toBe(
      `${fixture.appOrigin}/login?recovery=invalid`,
    )
    setCookie(fixture.jar, RECOVERY_GRANT_COOKIE_NAME, rawGrant)
    const replayReset = await resetPasswordPost(
      fixture.request({
        path: "/api/auth/reset-password",
        body: { password: newPassword, confirmation: newPassword },
        jar: fixture.jar,
        origin: fixture.appOrigin,
        ip: "203.0.113.36",
      }),
    )
    expect(replayReset.status).toBe(401)
    expectNoStore(replayReset)

    const [operation] = await fixture.ownerSql<
      [{ status: string; consumedOrRemoved: boolean; audits: number }]
    >`
      select operation.status::text as status,
             not exists (
               select 1
               from private.password_recovery_grants grant_row
               where grant_row.user_id = operation.target_user_id
                 and grant_row.consumed_at is null
             ) as "consumedOrRemoved",
             (select count(*)::integer from public.audit_events audit
               where audit.correlation_id = operation.correlation_id) as audits
      from private.auth_password_operations operation
      where operation.target_user_id = ${fixture.known.userId}::uuid
        and operation.kind = 'password_recovery'
      order by operation.reserved_at desc
      limit 1
    `
    expect(operation).toEqual({
      status: "completed",
      consumedOrRemoved: true,
      audits: 2,
    })
  }, 25_000)

  it.each([
    ["before Auth", "AUTH_CALL_NOT_ATTEMPTED"],
    ["during Auth", "AUTH_PROVIDER_FAILURE"],
    ["after Auth", "AUTH_COMPLETION_FAILURE"],
  ] as const)(
    "keeps RLS closed after a failure %s",
    async (_label, expectedReason) => {
      const index = [
        "AUTH_CALL_NOT_ATTEMPTED",
        "AUTH_PROVIDER_FAILURE",
        "AUTH_COMPLETION_FAILURE",
      ].indexOf(expectedReason)
      const identity = fixture.failures[index]!
      const jar: RecoveryCookieJar = new Map()
      const recovery = await fixture.directRecovery(identity, jar)
      requestCookies.current = jar
      const correlationId = fixture.nextCorrelationId()
      const failurePassword = `Axsys-${randomBytes(24).toString("base64url")}!4x`
      const globalSignOut = vi.fn(async () => true)
      const getClaims = vi.fn(async () => recovery.claims)
      setCookie(jar, "sb-task13-auth-token", "sensitive-auth-cookie")
      fixture.issueCsrf(jar)
      const update = vi.fn(async () => {
        if (expectedReason === "AUTH_PROVIDER_FAILURE") {
          throw new Error("provider failure containing no credential")
        }
      })

      await expect(
        resetRecoveredPassword(
          {
            password: failurePassword,
            confirmation: failurePassword,
          },
          correlationId,
          {
            auth: {
              getClaims,
              updatePassword: update,
              globalSignOut,
            },
            beforeAuthUpdate:
              expectedReason === "AUTH_CALL_NOT_ATTEMPTED"
                ? async () => {
                    throw new Error("before auth")
                  }
                : undefined,
            afterAuthUpdate:
              expectedReason === "AUTH_COMPLETION_FAILURE"
                ? async () => {
                    throw new Error("after auth")
                  }
                : undefined,
          },
        ),
      ).rejects.toBeInstanceOf(PasswordRecoveryRetryRequiredError)

      const [state] = await fixture.ownerSql<
        [{ status: string; reasonCode: string; forced: boolean; credentialAbsent: boolean }]
      >`
        select operation.status::text as status,
               operation.reason_code as "reasonCode",
               profile.must_change_password as forced,
               position(
                 ${failurePassword}
                 in row_to_json(operation)::text || row_to_json(profile)::text ||
                    coalesce((
                      select string_agg(row_to_json(audit)::text, '')
                      from public.audit_events audit
                      where audit.correlation_id = operation.correlation_id
                    ), '')
               ) = 0 as "credentialAbsent"
        from private.auth_password_operations operation
        join public.profiles profile on profile.user_id = operation.target_user_id
        where operation.target_user_id = ${identity.userId}::uuid
        order by operation.reserved_at desc
        limit 1
      `
      expect(state).toEqual({
        status: "failed",
        reasonCode: expectedReason,
        forced: true,
        credentialAbsent: true,
      })
      expect(getClaims).toHaveBeenCalledTimes(2)
      expect(globalSignOut).toHaveBeenCalledTimes(1)
      expect(jar.has(RECOVERY_GRANT_COOKIE_NAME)).toBe(false)
      expect(jar.has(CSRF_COOKIE_NAME)).toBe(false)
      expect(
        [...jar.keys()].some((name) => name.includes("-auth-token")),
      ).toBe(false)
    },
  )
})
