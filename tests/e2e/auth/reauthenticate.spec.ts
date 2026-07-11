import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"

test.use({ trace: "off", screenshot: "off", video: "off" })

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local E2E environment directly.
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

function requireLocalUrl(value: string | undefined, port: string): string {
  if (!value) throw new Error("Task 11 local E2E fixture is unavailable")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Task 11 local E2E fixture is unavailable")
  }
  if (
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== port ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Task 11 local E2E fixture is unavailable")
  }
  return url.toString()
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error("Task 11 local E2E fixture is unavailable")
  }
  return value
}

function hashSensitive(value: string): string {
  return createHmac("sha256", requireSecret(process.env.SECURITY_HASH_PEPPER))
    .update(value.trim().toLowerCase())
    .digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type BrowserApiResult = Readonly<{
  status: number
  cacheControl: string | null
  pragma: string | null
  body: unknown
}>

async function getApi(page: Page, endpoint: string): Promise<BrowserApiResult> {
  return page.evaluate(async (path) => {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
    })
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      pragma: response.headers.get("pragma"),
      body: (await response.json()) as unknown,
    }
  }, endpoint)
}

async function postReauthentication(
  page: Page,
  password: string,
  correlationId: string,
): Promise<BrowserApiResult> {
  return page.evaluate(
    async ({ currentPassword, requestId }) => {
      const csrfResponse = await fetch("/api/auth/csrf", {
        cache: "no-store",
        credentials: "same-origin",
      })
      const csrfBody = (await csrfResponse.json()) as unknown
      if (
        !csrfResponse.ok ||
        typeof csrfBody !== "object" ||
        csrfBody === null ||
        !("token" in csrfBody) ||
        typeof csrfBody.token !== "string"
      ) {
        return {
          status: 0,
          cacheControl: null,
          pragma: null,
          body: null,
        }
      }

      const response = await fetch("/api/auth/reauthenticate", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": requestId,
          "x-csrf-token": csrfBody.token,
        },
        body: JSON.stringify({ password: currentPassword }),
      })
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        pragma: response.headers.get("pragma"),
        body: (await response.json()) as unknown,
      }
    },
    { currentPassword: password, requestId: correlationId },
  )
}

function expectNoStore(result: BrowserApiResult): void {
  expect(result.cacheControl).toContain("no-store")
  expect(result.pragma).toBe("no-cache")
}

test.describe("Task 11 browser reauthentication", () => {
  const supabaseUrl = requireLocalUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "54321",
  )
  const databaseUrl = requireLocalUrl(process.env.DATABASE_URL, "54322")
  const publishableKey = requireSecret(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
  const admin = createClient(
    supabaseUrl,
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
  const ownerSql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: "axsys-task11-e2e",
      lock_timeout: 6_000,
      statement_timeout: 10_000,
    },
  })
  const email = `task11-e2e-${randomUUID()}@example.test`
  const password = `Axsys-${randomBytes(24).toString("base64url")}!9a`
  const correlationIds = new Set<string>()
  let userId = ""

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 11 E2E identity creation failed")
    }
    userId = created.data.user.id
    await ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.profiles (user_id, email, display_name)
        values (${userId}::uuid, ${email}, 'Task 11 E2E Platform')
      `
      await transaction`
        insert into public.platform_roles (user_id)
        values (${userId}::uuid)
      `
    })
  })

  test.afterAll(async () => {
    let cleanupFailure: unknown
    const ids = [...correlationIds]
    const rateHashes = [
      email,
      "local-or-untrusted-proxy",
      "127.0.0.1",
      "::1",
    ].map(hashSensitive)
    try {
      if (userId !== "") {
        await ownerSql.begin(async (transaction) => {
          await transaction`alter table public.audit_events disable trigger audit_events_append_only`
          await transaction`alter table public.security_events disable trigger security_events_append_only`
          await transaction`
            delete from public.audit_events
            where actor_user_id = ${userId}::uuid
               or correlation_id = any(${ids}::uuid[])
          `
          await transaction`
            delete from public.security_events
            where correlation_id = any(${ids}::uuid[])
          `
          await transaction`alter table public.audit_events enable trigger audit_events_append_only`
          await transaction`alter table public.security_events enable trigger security_events_append_only`
          await transaction`
            delete from private.rate_limit_buckets
            where key_hash = any(${rateHashes}::text[])
          `
          await transaction`
            delete from private.auth_session_controls where user_id = ${userId}::uuid
          `
          await transaction`
            delete from private.auth_user_session_cutoffs where user_id = ${userId}::uuid
          `
          await transaction`
            delete from public.platform_roles where user_id = ${userId}::uuid
          `
          await transaction`
            delete from public.profiles where user_id = ${userId}::uuid
          `
        })
        const deleted = await admin.auth.admin.deleteUser(userId)
        if (deleted.error) throw new Error("Task 11 E2E cleanup failed")

        const [residue] = await ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users where id = ${userId}::uuid)
            + (select count(*) from auth.sessions where user_id = ${userId}::uuid)
            + (select count(*) from public.profiles where user_id = ${userId}::uuid)
            + (select count(*) from public.platform_roles where user_id = ${userId}::uuid)
            + (select count(*) from private.auth_session_controls where user_id = ${userId}::uuid)
            + (select count(*) from private.auth_user_session_cutoffs where user_id = ${userId}::uuid)
            + (select count(*) from public.audit_events where actor_user_id = ${userId}::uuid)
            + (select count(*) from public.security_events
               where correlation_id = any(${ids}::uuid[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) {
          throw new Error("Task 11 E2E left database residue")
        }
      }
    } catch (error) {
      cleanupFailure = error
    } finally {
      await ownerSql.end({ timeout: 2 })
    }

    const verifier = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: "axsys-task11-e2e-verifier" },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = 'axsys-task11-e2e'
      `
      if (connections.count !== 0) {
        throw new Error("Task 11 E2E left database connections")
      }
    } finally {
      await verifier.end({ timeout: 2 })
    }
    if (cleanupFailure) throw cleanupFailure
  })

  test("rotates across two tabs and fail-closes both old and fresh JWTs", async ({
    context,
    page,
  }) => {
    test.setTimeout(45_000)
    await page.goto("/login")
    await page.getByLabel("E-mail").fill(email)
    await page.getByLabel("Senha").fill(password)
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page).toHaveURL(/\/platform$/u)

    const oldRealtime = await getApi(page, "/api/auth/realtime-token")
    expect(oldRealtime.status).toBe(200)
    expectNoStore(oldRealtime)
    expect(isRecord(oldRealtime.body)).toBe(true)
    const oldAccessToken = isRecord(oldRealtime.body)
      ? oldRealtime.body.accessToken
      : null
    expect(typeof oldAccessToken).toBe("string")
    expect(typeof oldAccessToken === "string" && oldAccessToken.length > 100).toBe(
      true,
    )

    const secondTab = await context.newPage()
    await secondTab.goto("/platform")
    const beforeRotation = await getApi(secondTab, "/api/auth/me")
    expect(beforeRotation.status).toBe(200)
    expectNoStore(beforeRotation)

    const wrongCorrelationId = randomUUID()
    correlationIds.add(wrongCorrelationId)
    const wrong = await postReauthentication(
      page,
      "wrong-current-password",
      wrongCorrelationId,
    )
    expect(wrong.status).toBe(401)
    expectNoStore(wrong)
    expect(wrong.body).toMatchObject({
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Senha atual inválida.",
      },
    })

    const successCorrelationId = randomUUID()
    correlationIds.add(successCorrelationId)
    const success = await postReauthentication(
      page,
      password,
      successCorrelationId,
    )
    expect(success.status).toBe(200)
    expectNoStore(success)
    expect(success.body).toMatchObject({
      kind: "platform",
      userId,
      modules: [],
      profile: { email },
    })
    expect(success.body).not.toHaveProperty("sessionId")
    expect(success.body).not.toHaveProperty("authenticatedAt")

    const secondTabContext = await getApi(secondTab, "/api/auth/me")
    expect(secondTabContext.status).toBe(200)
    expect(secondTabContext.body).toMatchObject({ kind: "platform", userId })
    const newRealtime = await getApi(secondTab, "/api/auth/realtime-token")
    const newAccessToken = isRecord(newRealtime.body)
      ? newRealtime.body.accessToken
      : null
    expect(newRealtime.status).toBe(200)
    expectNoStore(newRealtime)
    expect(typeof newAccessToken).toBe("string")
    expect(
      typeof oldAccessToken === "string" &&
        typeof newAccessToken === "string" &&
        oldAccessToken !== newAccessToken,
    ).toBe(true)

    for (const browserPage of [page, secondTab]) {
      const forbiddenKeys = await browserPage.evaluate(() =>
        Object.keys(localStorage).filter((key) => /token|session/iu.test(key)),
      )
      expect(forbiddenKeys).toEqual([])
    }

    if (typeof oldAccessToken !== "string") {
      throw new Error("Task 11 old token was unavailable")
    }
    const stolenTokenResponse = await fetch(
      `${supabaseUrl}rest/v1/profiles?select=user_id`,
      {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${oldAccessToken}`,
        },
        cache: "no-store",
      },
    )
    expect(stolenTokenResponse.status).toBe(200)
    await expect(stolenTokenResponse.json()).resolves.toEqual([])

    if (typeof newAccessToken !== "string") {
      throw new Error("Task 11 fresh token was unavailable")
    }
    const encodedPayload = newAccessToken.split(".")[1]
    if (!encodedPayload) {
      throw new Error("Task 11 fresh token payload was unavailable")
    }
    const freshPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown
    const freshSessionId = isRecord(freshPayload)
      ? freshPayload.session_id
      : null
    if (typeof freshSessionId !== "string") {
      throw new Error("Task 11 fresh session was unavailable")
    }

    const failClosedCorrelationId = randomUUID()
    correlationIds.add(failClosedCorrelationId)
    await ownerSql`
      select private.fail_closed_login_session(
        ${userId}::uuid,
        ${freshSessionId}::uuid,
        'AUTH_CONTEXT_RESOLUTION_FAILED',
        ${failClosedCorrelationId}::uuid
      )
    `
    const [freshControl] = await ownerSql<[{ state: string }]>`
      select state::text
      from private.auth_session_controls
      where session_id = ${freshSessionId}::uuid
    `
    expect(freshControl.state).toBe("revoked")

    const freshTokenResponse = await fetch(
      `${supabaseUrl}rest/v1/profiles?select=user_id`,
      {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${newAccessToken}`,
        },
        cache: "no-store",
      },
    )
    expect(freshTokenResponse.status).toBe(200)
    await expect(freshTokenResponse.json()).resolves.toEqual([])
  })
})
