import { beforeEach, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { AuthenticationRateLimitError } from "@/modules/auth/server/login"
import * as loginRoute from "@/app/api/auth/login/route"
import * as logoutRoute from "@/app/api/auth/logout/route"
import * as meRoute from "@/app/api/auth/me/route"
import * as realtimeTokenRoute from "@/app/api/auth/realtime-token/route"

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(),
  assertMutationOrigin: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieGetAll: vi.fn(),
  cookies: vi.fn(),
  getAccessContext: vi.fn(),
  getClaims: vi.fn(),
  getClientIp: vi.fn(),
  getSession: vi.fn(),
  hashSensitive: vi.fn(),
  login: vi.fn(),
  revokeSessionsAndWriteLogout: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    revokeSessionsAndWriteLogout: mocks.revokeSessionsAndWriteLogout,
  },
}))

vi.mock("@/lib/security/csrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/csrf")>()
  return { ...actual, assertCsrf: mocks.assertCsrf }
})

vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: mocks.assertMutationOrigin,
}))

vi.mock("@/lib/security/rate-limit", () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock("@/lib/security/redact", () => ({
  hashSensitive: mocks.hashSensitive,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getClaims: mocks.getClaims,
      getSession: mocks.getSession,
      signOut: mocks.signOut,
    },
  })),
}))

vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))

vi.mock("@/modules/auth/server/login", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/auth/server/login")
  >()
  return { ...actual, login: mocks.login }
})

const USER_ID = "10000000-0000-4000-8000-000000000001"
const SESSION_ID = "90000000-0000-4000-8000-000000000001"
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const HASH = "a".repeat(64)
const CSRF = "signed-csrf"

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://axsys.test${path}`, {
    ...init,
    headers: {
      origin: "https://axsys.test",
      "x-correlation-id": CORRELATION_ID,
      "x-csrf-token": CSRF,
      "user-agent": "test-agent",
      ...init?.headers,
    },
  })
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

function expectDeletionCookie(
  response: Response,
  name: string,
  sameSite: "Lax" | "Strict",
): void {
  const header = response.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith(`${name}=`))
  expect(header).toBeDefined()
  expect(header).toContain("Max-Age=0")
  expect(header).toContain("Path=/")
  expect(header).toContain("HttpOnly")
  expect(header).toContain("Secure")
  expect(header).toContain(`SameSite=${sameSite}`)
}

function authenticatedContext() {
  return {
    status: "authenticated" as const,
    context: {
      kind: "company" as const,
      userId: USER_ID,
      sessionId: SESSION_ID,
      authenticatedAt: 1_700_000_000,
      companyId: "30000000-0000-4000-8000-000000000001",
      membershipId: "40000000-0000-4000-8000-000000000001",
      role: "company_admin" as const,
      modules: ["administrative", "financial"] as const,
      profile: {
        displayName: "Company Admin",
        email: "admin@example.test",
        preferredTheme: "dark" as const,
        version: 2,
      },
    },
  }
}

beforeEach(() => {
  mocks.cookieGet.mockImplementation((name: string) =>
    name === "__Host-axsys-csrf" ? { name, value: CSRF } : undefined,
  )
  mocks.cookieGetAll.mockReturnValue([
    { name: "sb-project-auth-token", value: "raw-auth-cookie" },
    { name: "__Host-axsys-csrf", value: CSRF },
    { name: "unrelated", value: "keep" },
  ])
  mocks.cookies.mockResolvedValue({
    delete: mocks.cookieDelete,
    get: mocks.cookieGet,
    getAll: mocks.cookieGetAll,
  })
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID, session_id: SESSION_ID } },
    error: null,
  })
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "verified-realtime-token" } },
    error: null,
  })
  mocks.getAccessContext.mockResolvedValue(authenticatedContext())
  mocks.getClientIp.mockReturnValue("203.0.113.10")
  mocks.hashSensitive.mockReturnValue(HASH)
  mocks.login.mockResolvedValue({ redirectTo: "/app/dashboard" })
  mocks.revokeSessionsAndWriteLogout.mockResolvedValue(undefined)
  mocks.signOut.mockResolvedValue({ error: null })
})

describe("Task 11 login route", () => {
  it("enforces Origin then CSRF then strict parsing and returns no-store", async () => {
    const response = await loginRoute.POST(
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: " Admin@Example.Test ",
          password: "secret-value",
          rememberMe: true,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({
      redirectTo: "/app/dashboard",
    })
    expect(mocks.assertMutationOrigin).toHaveBeenCalledWith(
      "https://axsys.test",
    )
    expect(mocks.assertCsrf).toHaveBeenCalledWith(CSRF, CSRF)
    expect(mocks.login).toHaveBeenCalledWith(
      {
        email: "admin@example.test",
        password: "secret-value",
        rememberMe: true,
      },
      expect.any(Request),
      CORRELATION_ID,
    )
    expect(mocks.assertMutationOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCsrf.mock.invocationCallOrder[0],
    )
    expect(mocks.assertCsrf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.login.mock.invocationCallOrder[0],
    )
  })

  it.each(["companyId", "role", "redirectTo"])(
    "rejects protected body field %s before the service",
    async (field) => {
      const response = await loginRoute.POST(
        request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: "admin@example.test",
            password: "secret-value",
            rememberMe: false,
            [field]: "attacker-value",
          }),
        }),
      )

      expect(response.status).toBe(422)
      expectNoStore(response)
      expect(mocks.login).not.toHaveBeenCalled()
    },
  )

  it("adds a bounded Retry-After to a stable rate-limit envelope", async () => {
    mocks.login.mockRejectedValue(new AuthenticationRateLimitError(900))

    const response = await loginRoute.POST(
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@example.test",
          password: "secret-value",
        }),
      }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("900")
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED", correlationId: CORRELATION_ID },
    })
  })
})

describe("Task 11 logout route", () => {
  it("lets an already anonymous retry finish without the deleted CSRF cookie", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null })
    mocks.cookieGet.mockReturnValue(undefined)

    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )

    expect(response.status).toBe(204)
    expectNoStore(response)
    expect(mocks.assertMutationOrigin).not.toHaveBeenCalled()
    expect(mocks.assertCsrf).not.toHaveBeenCalled()
    expect(mocks.revokeSessionsAndWriteLogout).not.toHaveBeenCalled()
    expectDeletionCookie(response, "sb-project-auth-token", "Lax")
    expectDeletionCookie(response, "__Host-axsys-csrf", "Strict")
  })

  it("commits app revocation before upstream signout and clears auth/CSRF cookies", async () => {
    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )

    expect(response.status).toBe(204)
    expectNoStore(response)
    expect(mocks.revokeSessionsAndWriteLogout).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      correlationId: CORRELATION_ID,
      ipHash: HASH,
      userAgentHash: HASH,
    })
    expect(
      mocks.revokeSessionsAndWriteLogout.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0])
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).toHaveBeenCalledWith("__Host-axsys-csrf")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
    expectDeletionCookie(response, "sb-project-auth-token", "Lax")
    expectDeletionCookie(response, "__Host-axsys-csrf", "Strict")
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })

  it("expires every Auth chunk and verifier once without reflecting unsafe cookie names", async () => {
    mocks.cookieGetAll.mockReturnValue([
      { name: "sb-project-auth-token.0", value: "chunk-zero" },
      { name: "sb-project-auth-token.1", value: "chunk-one" },
      {
        name: "sb-project-auth-token-code-verifier",
        value: "code-verifier",
      },
      { name: "sb-project-auth-token.0", value: "duplicate-chunk" },
      { name: "__Host-axsys-csrf", value: CSRF },
      { name: "unrelated", value: "keep" },
      {
        name: "sb-project-auth-token\r\nInjected-Cookie",
        value: "reject",
      },
    ])

    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )
    const deletionNames = response.headers.getSetCookie().map((header) =>
      header.slice(0, header.indexOf("=")),
    )

    expect(response.status).toBe(204)
    expect(deletionNames.sort()).toEqual([
      "__Host-axsys-csrf",
      "sb-project-auth-token-code-verifier",
      "sb-project-auth-token.0",
      "sb-project-auth-token.1",
    ])
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith(
      "sb-project-auth-token\r\nInjected-Cookie",
    )
    expect(response.headers.getSetCookie().join("\n")).not.toContain(
      "Injected-Cookie",
    )
  })

  it("does not acknowledge logout or clear cookies when revocation fails", async () => {
    mocks.revokeSessionsAndWriteLogout.mockRejectedValue(
      new Error("private database detail"),
    )

    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )

    expect(response.status).toBe(500)
    expectNoStore(response)
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it("still acknowledges the committed revocation if Auth signout is unavailable", async () => {
    mocks.signOut.mockRejectedValue(new Error("provider unavailable"))

    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )

    expect(response.status).toBe(204)
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).toHaveBeenCalledWith("__Host-axsys-csrf")
    expectDeletionCookie(response, "sb-project-auth-token", "Lax")
    expectDeletionCookie(response, "__Host-axsys-csrf", "Strict")
  })

  it("fails closed when claims verification itself is unavailable", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: null },
      error: new Error("provider unavailable"),
    })

    const response = await logoutRoute.POST(
      request("/api/auth/logout", { method: "POST" }),
    )

    expect(response.status).toBe(500)
    expect(mocks.revokeSessionsAndWriteLogout).not.toHaveBeenCalled()
  })
})

describe("Task 11 identity route", () => {
  it("returns only the safe self projection", async () => {
    const response = await meRoute.GET(
      request("/api/auth/me", { method: "GET" }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body).toEqual({
      kind: "company",
      userId: USER_ID,
      companyId: "30000000-0000-4000-8000-000000000001",
      role: "company_admin",
      modules: ["administrative", "financial"],
      profile: authenticatedContext().context.profile,
    })
    expect(body).not.toHaveProperty("sessionId")
    expect(body).not.toHaveProperty("membershipId")
    expect(body).not.toHaveProperty("authenticatedAt")
  })

  it.each([
    ["anonymous", { status: "anonymous" }, 401, "AUTH_REQUIRED"],
    [
      "forced password change",
      { status: "password_change", userId: USER_ID, expired: false },
      403,
      "PASSWORD_CHANGE_REQUIRED",
    ],
  ] as const)("maps %s to its stable envelope", async (_case, resolution, status, code) => {
    mocks.getAccessContext.mockResolvedValue(resolution)

    const response = await meRoute.GET(
      request("/api/auth/me", { method: "GET" }),
    )

    expect(response.status).toBe(status)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
  })
})

describe("Task 11 Realtime token route", () => {
  it("verifies claims and current context before reading the raw session token", async () => {
    const response = await realtimeTokenRoute.GET(
      request("/api/auth/realtime-token", { method: "GET" }),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({
      accessToken: "verified-realtime-token",
    })
    expect(mocks.getClaims.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAccessContext.mock.invocationCallOrder[0],
    )
    expect(mocks.getAccessContext.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getSession.mock.invocationCallOrder[0],
    )
  })

  it("never reads a session token for an anonymous or mismatched context", async () => {
    mocks.getAccessContext.mockResolvedValue({ status: "anonymous" })

    const response = await realtimeTokenRoute.GET(
      request("/api/auth/realtime-token", { method: "GET" }),
    )

    expect(response.status).toBe(401)
    expectNoStore(response)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
})
