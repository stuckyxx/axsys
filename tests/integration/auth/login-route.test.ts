import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { clearAccountFailureRateLimit } from "@/lib/security/rate-limit"
import { createServerSupabase } from "@/lib/supabase/server"
import { POST } from "@/app/api/auth/login/route"
import {
  Task11LocalFixture,
  cookieStoreFor,
  type Task11CookieJar,
} from "./task11-local-fixture"

const requestCookies = vi.hoisted(() => ({
  current: undefined as Task11CookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current) throw new Error("Cookie jar unavailable")
    return cookieStoreFor(requestCookies.current)
  },
}))

const fixture = new Task11LocalFixture()
const companyFixture = new Task11LocalFixture()
const expiredFixture = new Task11LocalFixture()
const clientIp = "203.0.113.41"
const companyIp = "203.0.113.43"
const expiredIp = "203.0.113.44"
const successfulAccountIp = "203.0.113.45"
const interleavedSprayIp = "203.0.113.46"
const unknownEmail = `unknown-${randomUUID()}@example.test`

function request(
  body: unknown,
  options: Readonly<{
    target?: Task11LocalFixture
    csrf?: string
    ip?: string
  }> = {},
): Request {
  const target = options.target ?? fixture
  const csrf = options.csrf ?? target.issueCsrf()
  const correlationId = target.nextCorrelationId()
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      "user-agent": "task11-login-integration",
      "x-correlation-id": correlationId,
      "x-csrf-token": csrf,
      "x-forwarded-for": options.ip ?? clientIp,
    },
    body: JSON.stringify(body),
  })
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  requestCookies.current = fixture.jar
  fixture.addRateKey(clientIp)
  fixture.addRateKey(successfulAccountIp)
  fixture.addRateKey(interleavedSprayIp)
  fixture.addRateKey(fixture.email)
  fixture.addRateKey(unknownEmail)
  companyFixture.addRateKey(companyIp)
  companyFixture.addRateKey(companyFixture.email)
  expiredFixture.addRateKey(expiredIp)
  expiredFixture.addRateKey(expiredFixture.email)
  await fixture.createPlatformIdentity()
  await companyFixture.createCompanyIdentity()
  await expiredFixture.createPlatformIdentity()
  await expiredFixture.markTemporaryPasswordExpired()
}, 30_000)

afterAll(async () => {
  try {
    await expiredFixture.cleanup()
  } finally {
    try {
      await companyFixture.cleanup()
    } finally {
      try {
        await fixture.cleanup()
      } finally {
        requestCookies.current = undefined
        vi.unstubAllEnvs()
      }
    }
  }
}, 30_000)

describe.sequential("Task 11 login route with local Auth and BFF", () => {
  it("activates and audits a real pending platform session before redirecting", async () => {
    const response = await POST(
      request({
        email: fixture.email,
        password: fixture.password,
        rememberMe: false,
      }),
    )

    const body = await response.clone().json()
    const diagnostics = {
      body,
      sessionStates: await fixture.sessionStates(),
      loginAuditCount: await fixture.auditCount("auth.login"),
    }
    expect(response.status, JSON.stringify(diagnostics)).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({ redirectTo: "/platform" })

    const client = await createServerSupabase()
    const claims = await client.auth.getClaims()
    const sessionId = claims.data?.claims.session_id
    expect(claims.error).toBeNull()
    expect(typeof sessionId).toBe("string")
    expect(await fixture.sessionState(String(sessionId))).toBe("active")
    expect(await fixture.auditCount("auth.login")).toBe(1)
  }, 20_000)

  it("derives the company dashboard from a real active membership", async () => {
    requestCookies.current = companyFixture.jar
    try {
      const response = await POST(
        request(
          {
            email: companyFixture.email,
            password: companyFixture.password,
            rememberMe: false,
          },
          { target: companyFixture, ip: companyIp },
        ),
      )

      expect(response.status).toBe(200)
      expectNoStore(response)
      await expect(response.json()).resolves.toEqual({
        redirectTo: "/app/dashboard",
      })
      const client = await createServerSupabase()
      const claims = await client.auth.getClaims()
      const sessionId = claims.data?.claims.session_id
      expect(claims.error).toBeNull()
      expect(typeof sessionId).toBe("string")
      expect(await companyFixture.sessionState(String(sessionId))).toBe("active")
      expect(await companyFixture.auditCount("auth.login")).toBe(1)
    } finally {
      requestCookies.current = fixture.jar
    }
  }, 20_000)

  it("returns stable temporary-password expiry when activation rejects it", async () => {
    requestCookies.current = expiredFixture.jar
    try {
      const response = await POST(
        request(
          {
            email: expiredFixture.email,
            password: expiredFixture.password,
            rememberMe: false,
          },
          { target: expiredFixture, ip: expiredIp },
        ),
      )

      expect(response.status).toBe(403)
      expectNoStore(response)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "TEMPORARY_PASSWORD_EXPIRED",
          message: "A senha provisória expirou. Solicite uma nova senha.",
        },
      })
      expect(await expiredFixture.auditCount("auth.login")).toBe(0)
      expect(
        [...expiredFixture.jar.keys()].some((name) =>
          name.includes("-auth-token"),
        ),
      ).toBe(false)
    } finally {
      requestCookies.current = fixture.jar
    }
  }, 20_000)

  it.each(["companyId", "role", "redirectTo"])(
    "rejects protected body field %s before Auth",
    async (field) => {
      const response = await POST(
        request({
          email: fixture.email,
          password: fixture.password,
          rememberMe: false,
          [field]: "attacker-value",
        }),
      )
      expect(response.status).toBe(422)
      expectNoStore(response)
    },
  )

  it("keeps known and unknown credential failures observationally neutral", async () => {
    const known = await POST(
      request({ email: fixture.email, password: "wrong-password" }),
    )
    const unknown = await POST(
      request({ email: unknownEmail, password: "wrong-password" }),
    )
    const knownBody = await known.json()
    const unknownBody = await unknown.json()

    expect(known.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(knownBody.error).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "E-mail ou senha inválidos.",
    })
    expect(unknownBody.error).toMatchObject({
      code: knownBody.error.code,
      message: knownBody.error.message,
    })
    expectNoStore(known)
    expectNoStore(unknown)
    expect(await fixture.securityEventCount("auth.login.failed")).toBe(2)
    await clearAccountFailureRateLimit("login-account-failure", fixture.email)
  }, 10_000)

  it("allows exactly five failed account attempts and blocks the sixth", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await POST(
        request({ email: fixture.email, password: "wrong-password" }),
      )
      expect(response.status, `attempt ${attempt}`).toBe(401)
    }
    const blocked = await POST(
      request({ email: fixture.email, password: "wrong-password" }),
    )

    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expectNoStore(blocked)
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED" },
    })
  }, 20_000)

  it("atomically allows five of six simultaneous failures and blocks one", async () => {
    await clearAccountFailureRateLimit("login-account-failure", fixture.email)
    const csrf = fixture.issueCsrf()
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        POST(
          request(
            { email: fixture.email, password: "wrong-password" },
            { csrf },
          ),
        ),
      ),
    )
    const statuses = responses.map(({ status }) => status).sort()

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    const blocked = responses.find(({ status }) => status === 429)
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThan(0)
    responses.forEach(expectNoStore)
  }, 20_000)

  it("does not accumulate account failures across six successful logins", async () => {
    await clearAccountFailureRateLimit("login-account-failure", fixture.email)
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await POST(
        request(
          {
            email: fixture.email,
            password: fixture.password,
            rememberMe: false,
          },
          { ip: successfulAccountIp },
        ),
      )
      expect(response.status, `successful login ${attempt}`).toBe(200)
      expectNoStore(response)
    }
  }, 20_000)

  it("keeps IP volume after a valid interleaved login and blocks N plus one", async () => {
    await fixture.preseedRateLimit(
      "login-ip-volume",
      interleavedSprayIp,
      29,
    )
    const validAtLimit = await POST(
      request(
        {
          email: fixture.email,
          password: fixture.password,
          rememberMe: false,
        },
        { ip: interleavedSprayIp },
      ),
    )
    expect(validAtLimit.status).toBe(200)
    expectNoStore(validAtLimit)

    const blocked = await POST(
      request(
        { email: unknownEmail, password: "wrong-password" },
        { ip: interleavedSprayIp },
      ),
    )
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expectNoStore(blocked)
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED" },
    })
  }, 20_000)
})
