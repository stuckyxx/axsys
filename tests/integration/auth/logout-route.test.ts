import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { POST } from "@/app/api/auth/logout/route"
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
let sessionId = ""

function request(input?: { csrf?: string; origin?: string }): Request {
  const correlationId = fixture.nextCorrelationId()
  const headers = new Headers({
    "user-agent": "task11-logout-integration",
    "x-correlation-id": correlationId,
  })
  if (input?.origin !== undefined) headers.set("origin", input.origin)
  if (input?.csrf !== undefined) headers.set("x-csrf-token", input.csrf)
  return new Request("http://127.0.0.1:3000/api/auth/logout", {
    method: "POST",
    headers,
  })
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeAll(async () => {
  requestCookies.current = fixture.jar
  await fixture.createPlatformIdentity()
  sessionId = (await fixture.signInAndActivate()).sessionId
}, 30_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
  }
}, 30_000)

describe.sequential("Task 11 logout route with local Auth and BFF", () => {
  it("rejects an evil Origin and a missing CSRF token while still authenticated", async () => {
    const csrf = fixture.issueCsrf()
    const evil = await POST(
      request({ csrf, origin: "https://evil.example.test" }),
    )
    expect(evil.status).toBe(403)
    expectNoStore(evil)

    const missingCsrf = await POST(
      request({ origin: "http://127.0.0.1:3000" }),
    )
    expect(missingCsrf.status).toBe(403)
    expectNoStore(missingCsrf)
    expect(await fixture.sessionState(sessionId)).toBe("active")
  })

  it("revokes the app session, audits, signs out, and clears auth/CSRF cookies", async () => {
    const csrf = fixture.issueCsrf()
    const response = await POST(
      request({ csrf, origin: "http://127.0.0.1:3000" }),
    )

    expect(response.status).toBe(204)
    expectNoStore(response)
    expect(["revoked", null]).toContain(await fixture.sessionState(sessionId))
    expect(await fixture.auditCount("auth.logout")).toBe(1)
    expect(fixture.jar.has("__Host-axsys-csrf")).toBe(false)
    expect(
      [...fixture.jar.keys()].some((name) => name.includes("-auth-token")),
    ).toBe(false)
  }, 20_000)

  it("allows an anonymous retry after cookie deletion without Origin or CSRF", async () => {
    const response = await POST(request())

    expect(response.status).toBe(204)
    expectNoStore(response)
    expect(await fixture.auditCount("auth.logout")).toBe(1)
  })
})
