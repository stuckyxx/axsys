import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/supabase/database.types"

type CookieJar = Map<string, string>

const requestCookies = vi.hoisted(() => ({
  current: undefined as CookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = requestCookies.current
    if (!jar) {
      throw new Error("Request cookie jar is unavailable")
    }

    return {
      getAll: () =>
        [...jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => {
        jar.set(name, value)
      },
    }
  },
}))

import { createServerSupabase } from "@/lib/supabase/server"
import {
  getAccessContext,
  type AccessResolution,
} from "@/modules/auth/server/get-access-context"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local integration environment directly.
  }
}

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

function parseLocalUrl(value: string | undefined, label: string): URL {
  if (!value) {
    throw new Error(`${label} is unavailable`)
  }

  try {
    return new URL(value)
  } catch {
    throw new Error(`${label} is unavailable`)
  }
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  const url = parseLocalUrl(value, "Local Supabase URL")

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "54321" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Local Supabase URL is unavailable")
  }

  return url.toString()
}

function requireLocalAdminDatabaseUrl(value: string | undefined): string {
  const url = parseLocalUrl(value, "Local owner database URL")
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
    throw new Error("Local owner database URL is unavailable")
  }

  return url.toString()
}

function requireSecret(value: string | undefined, label: string): string {
  if (!value || value.length < 20) {
    throw new Error(`${label} is unavailable`)
  }
  return value
}

function testPassword(
  primary: string | undefined,
  fallback: string | undefined,
): string {
  const password = primary ?? fallback
  if (password && password.length >= 12) {
    return password
  }

  // The planned untracked E2E credentials may not exist on a fresh clone yet.
  // An in-memory random fallback keeps the integration fixture secret-free.
  return `Axsys-${randomBytes(24).toString("base64url")}!`
}

function uniqueEmail(base: string | undefined, label: string): string {
  const normalized = (base ?? `${label}@example.test`).trim().toLowerCase()
  const separator = normalized.lastIndexOf("@")
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new Error(`${label} email is unavailable`)
  }

  return `${normalized.slice(0, separator)}+access-${randomUUID()}@${normalized.slice(separator + 1)}`
}

function randomCnpj(): string {
  return Array.from({ length: 14 }, () => randomInt(10)).join("")
}

const supabaseUrl = requireLocalSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
)
const databaseUrl = requireLocalAdminDatabaseUrl(process.env.DATABASE_URL)
requireSecret(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  "Local publishable key",
)
const secretKey = requireSecret(
  process.env.SUPABASE_SECRET_KEY,
  "Local secret key",
)
const platformPassword = testPassword(
  process.env.AXSYS_E2E_PLATFORM_PASSWORD,
  process.env.AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD,
)
const companyPassword = testPassword(
  process.env.AXSYS_E2E_COMPANY_A_PASSWORD,
  process.env.AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD,
)

const admin = createClient<Database>(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
})
const ownerSql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 20,
  connection: {
    application_name: "axsys-access-context-integration",
    lock_timeout: 6_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  },
})

const platformJar: CookieJar = new Map()
const companyJar: CookieJar = new Map()
const publicSignupJar: CookieJar = new Map()
const createdUserIds: string[] = []
const companyId = randomUUID()
const membershipId = randomUUID()
const forgedCompanyId = randomUUID()
const platformEmail = uniqueEmail(
  process.env.AXSYS_E2E_PLATFORM_EMAIL,
  "platform-access",
)
const companyEmail = uniqueEmail(
  process.env.AXSYS_E2E_COMPANY_A_EMAIL,
  "company-access",
)
const publicSignupEmail = uniqueEmail(undefined, "public-signup")
const publicSignupPassword = testPassword(undefined, undefined)

let platformUserId = ""
let platformSessionId = ""
let companyUserId = ""
let companySessionId = ""

function selectCookieJar(jar: CookieJar): void {
  requestCookies.current = jar
}

async function createAuthUser(input: {
  email: string
  password: string
  userMetadata?: Record<string, unknown>
}): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: input.userMetadata,
  })
  if (error || !data.user) {
    throw new Error("Local Auth fixture could not be created")
  }

  createdUserIds.push(data.user.id)
  return data.user.id
}

async function signIn(
  jar: CookieJar,
  email: string,
  password: string,
  expectedUserId: string,
): Promise<string> {
  selectCookieJar(jar)
  const client = await createServerSupabase()
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    throw new Error(
      `Local Auth fixture could not sign in (${error?.code ?? "missing-session"})`,
    )
  }

  const claimsResult = await client.auth.getClaims()
  const sessionId = claimsResult.data?.claims.session_id
  if (
    claimsResult.error !== null ||
    data.user.id !== expectedUserId ||
    typeof sessionId !== "string"
  ) {
    throw new Error("Local Auth fixture claims are invalid")
  }

  return sessionId
}

async function activateAppSession(input: {
  sessionId: string
  userId: string
  scope: "platform" | "tenant"
  companyId: string | null
}): Promise<void> {
  const rows = await ownerSql<{ sessionId: string }[]>`
    insert into private.auth_session_controls (
      session_id,
      user_id,
      auth_created_at,
      remember_me,
      state,
      absolute_expires_at,
      audit_scope,
      audit_company_id,
      activated_at,
      last_seen_at,
      created_at,
      updated_at
    )
    select
      auth_session.id,
      auth_session.user_id,
      auth_session.created_at,
      false,
      'active'::private.auth_session_state,
      least(
        auth_session.created_at + interval '8 hours',
        coalesce(
          auth_session.not_after,
          auth_session.created_at + interval '8 hours'
        )
      ),
      ${input.scope}::public.audit_scope,
      ${input.companyId}::uuid,
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp()
    from auth.sessions auth_session
    where auth_session.id = ${input.sessionId}::uuid
      and auth_session.user_id = ${input.userId}::uuid
    returning session_id as "sessionId"
  `
  if (rows.length !== 1 || rows[0]?.sessionId !== input.sessionId) {
    throw new Error("Local app-session fixture could not be activated")
  }
}

async function cleanupFixtures(): Promise<void> {
  const unexpectedSignupUsers = await ownerSql<{ id: string }[]>`
    select id
    from auth.users
    where email = ${publicSignupEmail}
  `
  const userIds = [
    ...new Set([
      ...createdUserIds,
      ...unexpectedSignupUsers.map(({ id }) => id),
    ]),
  ]
  if (userIds.length > 0) {
    await ownerSql.begin(async (transaction) => {
      await transaction`
        delete from private.auth_session_controls
        where user_id = any(${userIds}::uuid[])
      `
      await transaction`
        delete from private.auth_user_session_cutoffs
        where user_id = any(${userIds}::uuid[])
      `
      await transaction`
        delete from public.member_modules
        where membership_id = ${membershipId}::uuid
      `
      await transaction`
        delete from public.company_memberships
        where id = ${membershipId}::uuid
      `
      await transaction`
        delete from public.platform_roles
        where user_id = any(${userIds}::uuid[])
      `
      await transaction`
        delete from public.companies
        where id = ${companyId}::uuid
      `
      await transaction`
        delete from public.profiles
        where user_id = any(${userIds}::uuid[])
      `
    })

    for (const userId of userIds) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) {
        throw new Error("Local Auth fixture could not be deleted")
      }
    }

    const [residue] = await ownerSql<[{ count: number }]>`
      select (
        (select count(*) from auth.users
         where id = any(${userIds}::uuid[]))
        + (select count(*) from public.profiles
           where user_id = any(${userIds}::uuid[]))
        + (select count(*) from public.platform_roles
           where user_id = any(${userIds}::uuid[]))
        + (select count(*) from public.company_memberships
           where user_id = any(${userIds}::uuid[]))
        + (select count(*) from public.member_modules
           where membership_id = ${membershipId}::uuid)
        + (select count(*) from public.companies
           where id = ${companyId}::uuid)
        + (select count(*) from private.auth_session_controls
           where user_id = any(${userIds}::uuid[]))
        + (select count(*) from private.auth_user_session_cutoffs
           where user_id = any(${userIds}::uuid[]))
      )::integer as count
    `
    expect(residue.count, "access-context fixture residue").toBe(0)
  }

  createdUserIds.length = 0
  platformJar.clear()
  companyJar.clear()
  publicSignupJar.clear()
  requestCookies.current = undefined
}

beforeAll(async () => {
  platformUserId = await createAuthUser({
    email: platformEmail,
    password: platformPassword,
  })
  companyUserId = await createAuthUser({
    email: companyEmail,
    password: companyPassword,
    userMetadata: {
      companyId: forgedCompanyId,
      role: "super_admin",
      modules: ["certificates"],
    },
  })

  await ownerSql.begin(async (transaction) => {
    await transaction`
      insert into public.profiles (user_id, email, display_name)
      values
        (${platformUserId}::uuid, ${platformEmail}, 'Platform Integration'),
        (${companyUserId}::uuid, ${companyEmail}, 'Company Integration')
    `
    await transaction`
      insert into public.platform_roles (user_id)
      values (${platformUserId}::uuid)
    `
    await transaction`
      insert into public.companies (
        id,
        legal_name,
        cnpj_normalized,
        contact_email
      ) values (
        ${companyId}::uuid,
        'Axsys Access Context Integration',
        ${randomCnpj()},
        ${companyEmail}
      )
    `
    await transaction`
      insert into public.company_memberships (
        id,
        company_id,
        user_id,
        role
      ) values (
        ${membershipId}::uuid,
        ${companyId}::uuid,
        ${companyUserId}::uuid,
        'member'
      )
    `
    await transaction`
      insert into public.member_modules (company_id, membership_id, module)
      values
        (${companyId}::uuid, ${membershipId}::uuid, 'financial'),
        (${companyId}::uuid, ${membershipId}::uuid, 'administrative')
    `
  })

  platformSessionId = await signIn(
    platformJar,
    platformEmail,
    platformPassword,
    platformUserId,
  )
  companySessionId = await signIn(
    companyJar,
    companyEmail,
    companyPassword,
    companyUserId,
  )
  await activateAppSession({
    sessionId: platformSessionId,
    userId: platformUserId,
    scope: "platform",
    companyId: null,
  })
  await activateAppSession({
    sessionId: companySessionId,
    userId: companyUserId,
    scope: "tenant",
    companyId,
  })
}, 30_000)

afterAll(async () => {
  try {
    await cleanupFixtures()
  } finally {
    await ownerSql.end({ timeout: 2 })
  }
}, 30_000)

describe.sequential("getAccessContext with local Auth, RLS, and BFF", () => {
  it("keeps public signup disabled while the email sign-in provider is enabled", async () => {
    selectCookieJar(publicSignupJar)
    const client = await createServerSupabase()

    const signup = await client.auth.signUp({
      email: publicSignupEmail,
      password: publicSignupPassword,
    })

    expect(signup.error).toMatchObject({ code: "signup_disabled" })
    expect(signup.data.user).toBeNull()
    expect(signup.data.session).toBeNull()
    const [created] = await ownerSql<[{ count: number }]>`
      select count(*)::integer as count
      from auth.users
      where email = ${publicSignupEmail}
    `
    expect(created.count).toBe(0)
  })

  it("resolves the platform scope from the cookie-bound authenticated user", async () => {
    selectCookieJar(platformJar)

    const resolution = await getAccessContext()
    expect(resolution).toEqual({
      status: "authenticated",
      context: {
        kind: "platform",
        userId: platformUserId,
        sessionId: platformSessionId,
        authenticatedAt: expect.any(Number),
        profile: {
          displayName: "Platform Integration",
          email: platformEmail,
          preferredTheme: "dark",
          version: 1,
        },
      },
    })
    if (resolution.status === "authenticated") {
      expect(Number.isSafeInteger(resolution.context.authenticatedAt)).toBe(true)
      expect(resolution.context.authenticatedAt).toBeGreaterThan(0)
    }
  })

  it("derives tenant, role, and modules from RLS rows instead of forged input or metadata", async () => {
    selectCookieJar(companyJar)
    const callWithForgedInput = getAccessContext as unknown as (
      ignored: unknown,
    ) => Promise<AccessResolution>

    const resolution = await callWithForgedInput({
      companyId: forgedCompanyId,
      role: "super_admin",
      modules: ["certificates"],
    })

    expect(resolution).toEqual({
      status: "authenticated",
      context: {
        kind: "company",
        userId: companyUserId,
        sessionId: companySessionId,
        authenticatedAt: expect.any(Number),
        companyId,
        membershipId,
        role: "member",
        modules: ["administrative", "financial"],
        profile: {
          displayName: "Company Integration",
          email: companyEmail,
          preferredTheme: "dark",
          version: 1,
        },
      },
    })
    if (resolution.status === "authenticated") {
      expect(Number.isSafeInteger(resolution.context.authenticatedAt)).toBe(true)
      expect(resolution.context.authenticatedAt).toBeGreaterThan(0)
    }
  })

  it("rechecks revocation through BFF and direct RLS on the next request", async () => {
    const [revoked] = await ownerSql<[{ count: number }]>`
      select private.revoke_auth_sessions(
        ${companyUserId}::uuid,
        null::uuid
      ) as count
    `
    expect(revoked.count).toBe(1)

    selectCookieJar(companyJar)
    await expect(getAccessContext()).resolves.toEqual({ status: "anonymous" })

    const requestClient = await createServerSupabase()
    const directRead = await requestClient.from("companies").select("id")
    expect(directRead.error).toBeNull()
    expect(directRead.data).toEqual([])
  })
})
