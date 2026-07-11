import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { GET } from "@/app/api/auth/realtime-token/route"
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
let expectedAccessToken = ""

function request(): Request {
  return new Request("http://127.0.0.1:3000/api/auth/realtime-token", {
    headers: { "x-correlation-id": fixture.nextCorrelationId() },
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
  expectedAccessToken = (await fixture.signInAndActivate()).accessToken
}, 30_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
  }
}, 30_000)

describe.sequential("Task 11 Realtime token route with local Auth and BFF", () => {
  it("returns the current token only after the active app context resolves", async () => {
    const response = await GET(request())
    const body = (await response.json()) as { accessToken: string }

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body.accessToken).toBe(expectedAccessToken)
    expect(body.accessToken.length).toBeGreaterThan(100)
  })

  it("returns a stable no-store 401 when no authenticated cookie exists", async () => {
    fixture.jar.clear()
    const response = await GET(request())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(401)
    expectNoStore(response)
    expect(serialized).toContain("AUTH_REQUIRED")
    expect(serialized).not.toContain(expectedAccessToken)
  })
})
