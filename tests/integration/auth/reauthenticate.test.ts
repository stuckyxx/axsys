import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { bffDb } from "@/lib/db/bff"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createServerSupabase } from "@/lib/supabase/server"
import { POST } from "@/app/api/auth/reauthenticate/route"
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
const clientIp = "203.0.113.42"
const successfulAccountIp = "203.0.113.47"
const interleavedSprayIp = "203.0.113.48"
let oldAccessToken = ""
let oldSessionId = ""

function request(password: string, ip = clientIp): Request {
  const csrf = fixture.issueCsrf()
  return new Request("http://127.0.0.1:3000/api/auth/reauthenticate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      "x-correlation-id": fixture.nextCorrelationId(),
      "x-csrf-token": csrf,
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ password }),
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
  await fixture.createPlatformIdentity()
  const signedIn = await fixture.signInAndActivate()
  oldAccessToken = signedIn.accessToken
  oldSessionId = signedIn.sessionId
}, 30_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 30_000)

describe.sequential("Task 11 reauthentication with local Auth and BFF", () => {
  it("keeps a wrong current password neutral without rotating the session", async () => {
    const response = await POST(request("wrong-current-password"))

    expect(response.status).toBe(401)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Senha atual inválida.",
      },
    })
    expect(await fixture.sessionState(oldSessionId)).toBe("active")
  }, 10_000)

  it("rotates to a fresh session, revokes the old JWT, and returns only safe context", async () => {
    const response = await POST(request(fixture.password))
    const body = await response.json()

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body).toMatchObject({
      kind: "platform",
      userId: fixture.userId,
      modules: [],
      profile: { email: fixture.email },
    })
    expect(body).not.toHaveProperty("sessionId")
    expect(body).not.toHaveProperty("authenticatedAt")

    const client = await createServerSupabase()
    const claims = await client.auth.getClaims()
    const newSessionId = claims.data?.claims.session_id
    expect(claims.error).toBeNull()
    expect(typeof newSessionId).toBe("string")
    expect(newSessionId).not.toBe(oldSessionId)
    expect(await fixture.sessionState(oldSessionId)).toBe("revoked")
    expect(await fixture.sessionState(String(newSessionId))).toBe("active")
    expect(await fixture.auditCount("auth.reauthenticated")).toBe(1)

    const oldJwtResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=user_id`,
      {
        headers: {
          apikey: String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
          authorization: `Bearer ${oldAccessToken}`,
        },
        cache: "no-store",
      },
    )
    expect(oldJwtResponse.status).toBe(200)
    await expect(oldJwtResponse.json()).resolves.toEqual([])
  }, 20_000)

  it("does not accumulate account failures across six successful reauthentications", async () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await POST(
        request(fixture.password, successfulAccountIp),
      )
      expect(response.status, `successful reauthentication ${attempt}`).toBe(200)
      expectNoStore(response)
    }
  }, 20_000)

  it("keeps IP volume after a valid interleaved reauthentication and blocks N plus one", async () => {
    await fixture.preseedRateLimit(
      "reauth-ip-volume",
      interleavedSprayIp,
      19,
    )
    const validAtLimit = await POST(
      request(fixture.password, interleavedSprayIp),
    )
    expect(validAtLimit.status).toBe(200)
    expectNoStore(validAtLimit)

    const blocked = await POST(
      request(fixture.password, interleavedSprayIp),
    )
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expectNoStore(blocked)
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED" },
    })
  }, 20_000)

  it("makes fail-closed database revocation authoritative for the fresh JWT", async () => {
    const client = await createServerSupabase()
    const [claims, session] = await Promise.all([
      client.auth.getClaims(),
      client.auth.getSession(),
    ])
    const freshSessionId = claims.data?.claims.session_id
    const freshAccessToken = session.data.session?.access_token
    expect(claims.error).toBeNull()
    expect(session.error).toBeNull()
    expect(typeof freshSessionId).toBe("string")
    expect(typeof freshAccessToken).toBe("string")
    expect(await fixture.sessionState(String(freshSessionId))).toBe("active")

    await bffDb.failClosedLoginSession({
      actorUserId: fixture.userId,
      sessionId: String(freshSessionId),
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      correlationId: fixture.nextCorrelationId(),
    })

    expect(await fixture.sessionState(String(freshSessionId))).toBe("revoked")
    if (typeof freshAccessToken !== "string") {
      throw new Error("Task 11 fresh access token was unavailable")
    }
    const freshJwtResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=user_id`,
      {
        headers: {
          apikey: String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
          authorization: `Bearer ${freshAccessToken}`,
        },
        cache: "no-store",
      },
    )
    expect(freshJwtResponse.status).toBe(200)
    await expect(freshJwtResponse.json()).resolves.toEqual([])
  }, 20_000)
})
