import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { AuthenticationRateLimitError } from "@/modules/auth/server/login"
import {
  reauthenticate,
  reauthenticationSchema,
} from "@/modules/auth/server/reauthenticate"

const mocks = vi.hoisted(() => ({
  clearAccountFailureRateLimit: vi.fn(),
  consumeRateLimit: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGetAll: vi.fn(),
  cookies: vi.fn(),
  failClosedLoginSession: vi.fn(),
  getAccessContext: vi.fn(),
  getClaims: vi.fn(),
  getClientIp: vi.fn(),
  hashSensitive: vi.fn(),
  rotateAppSessionAfterReauthentication: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  writeSecurityEvent: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    failClosedLoginSession: mocks.failClosedLoginSession,
    rotateAppSessionAfterReauthentication:
      mocks.rotateAppSessionAfterReauthentication,
  },
}))

vi.mock("@/lib/security/rate-limit", () => ({
  clearAccountFailureRateLimit: mocks.clearAccountFailureRateLimit,
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
  progressiveDelayMs: (attempts: number) => 250 * 2 ** Math.max(0, attempts - 1),
}))

vi.mock("@/lib/security/redact", () => ({ hashSensitive: mocks.hashSensitive }))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getClaims: mocks.getClaims,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  })),
}))

vi.mock("@/modules/audit/server/write-security-event", () => ({
  writeSecurityEvent: mocks.writeSecurityEvent,
}))

vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))

const USER_ID = "10000000-0000-4000-8000-000000000001"
const OLD_SESSION_ID = "90000000-0000-4000-8000-000000000001"
const NEW_SESSION_ID = "90000000-0000-4000-8000-000000000002"
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const EMAIL = "admin@example.test"
const EMAIL_HASH = "a".repeat(64)
const IP_HASH = "b".repeat(64)
const NOW_SECONDS = 1_700_000_000
const REQUEST = new Request("https://axsys.test/api/auth/reauthenticate", {
  method: "POST",
})
const INPUT = { password: "current-password-value" } as const

function allowed(attempts = 1) {
  return { allowed: true, attempts, retryAfterSeconds: 0 }
}

function context(sessionId = OLD_SESSION_ID) {
  return {
    status: "authenticated" as const,
    context: {
      kind: "platform" as const,
      userId: USER_ID,
      sessionId,
      authenticatedAt: NOW_SECONDS - 700,
      profile: {
        displayName: "Platform Admin",
        email: EMAIL,
        preferredTheme: "dark" as const,
        version: 1,
      },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_SECONDS * 1_000)
  mocks.getClaims
    .mockResolvedValueOnce({
      data: { claims: { sub: USER_ID, session_id: OLD_SESSION_ID } },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        claims: {
          sub: USER_ID,
          session_id: NEW_SESSION_ID,
          amr: [{ method: "password", timestamp: NOW_SECONDS }],
        },
      },
      error: null,
    })
  mocks.getAccessContext
    .mockResolvedValueOnce(context())
    .mockResolvedValueOnce(context(NEW_SESSION_ID))
  mocks.consumeRateLimit
    .mockResolvedValueOnce(allowed())
    .mockResolvedValueOnce(allowed())
  mocks.clearAccountFailureRateLimit.mockResolvedValue(undefined)
  mocks.getClientIp.mockReturnValue("203.0.113.10")
  mocks.hashSensitive.mockImplementation((raw: string) =>
    raw === EMAIL ? EMAIL_HASH : IP_HASH,
  )
  mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  mocks.failClosedLoginSession.mockResolvedValue(undefined)
  mocks.rotateAppSessionAfterReauthentication.mockResolvedValue(undefined)
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.writeSecurityEvent.mockResolvedValue(undefined)
  mocks.cookieGetAll.mockReturnValue([
    { name: "sb-project-auth-token", value: "raw-auth-cookie" },
    { name: "unrelated", value: "keep" },
  ])
  mocks.cookies.mockResolvedValue({
    delete: mocks.cookieDelete,
    getAll: mocks.cookieGetAll,
  })
})

describe("Task 11 reauthentication service", () => {
  it("uses the verified profile email and atomically rotates to a fresh password session", async () => {
    const result = await reauthenticate(INPUT, REQUEST, CORRELATION_ID)

    expect(reauthenticationSchema.safeParse(INPUT).success).toBe(true)
    expect(mocks.consumeRateLimit.mock.calls).toEqual([
      ["reauth-ip-volume", "203.0.113.10"],
      ["reauth-account-failure", EMAIL],
    ])
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: INPUT.password,
    })
    expect(mocks.clearAccountFailureRateLimit).toHaveBeenCalledWith(
      "reauth-account-failure",
      EMAIL,
    )
    expect(mocks.rotateAppSessionAfterReauthentication).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      oldSessionId: OLD_SESSION_ID,
      newSessionId: NEW_SESSION_ID,
      correlationId: CORRELATION_ID,
    })
    expect(
      mocks.rotateAppSessionAfterReauthentication.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getAccessContext.mock.invocationCallOrder[1])
    expect(result).toEqual({
      kind: "platform",
      userId: USER_ID,
      modules: [],
      profile: context().context.profile,
    })
    expect(result).not.toHaveProperty("sessionId")
    expect(result).not.toHaveProperty("authenticatedAt")
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it("returns one delayed neutral error for a wrong password", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    })
    const sleep = vi.fn()

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID, { sleep }),
    ).rejects.toEqual(
      new ApiError(
        "AUTH_INVALID_CREDENTIALS",
        401,
        "Senha atual inválida.",
      ),
    )
    expect(sleep).toHaveBeenCalledWith(250)
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith({
      eventType: "auth.reauthentication.failed",
      emailHash: EMAIL_HASH,
      ipHash: IP_HASH,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId: CORRELATION_ID,
      metadata: { attempts: 1 },
    })
    expect(JSON.stringify(mocks.writeSecurityEvent.mock.calls)).not.toContain(
      EMAIL,
    )
    expect(JSON.stringify(mocks.writeSecurityEvent.mock.calls)).not.toContain(
      INPUT.password,
    )
    expect(mocks.rotateAppSessionAfterReauthentication).not.toHaveBeenCalled()
  })

  it("keeps a thrown Auth provider failure outwardly neutral", async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error("provider raw detail"))
    const sleep = vi.fn()

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID, { sleep }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", status: 401 })
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        reasonCode: "AUTH_PROVIDER_FAILURE",
      }),
    )
    expect(sleep).toHaveBeenCalledWith(250)
  })

  it.each([
    [
      "IP",
      { allowed: false, attempts: 21, retryAfterSeconds: 1_800 },
      "IP_RATE_LIMITED",
    ],
    [
      "account",
      { allowed: false, attempts: 6, retryAfterSeconds: 900 },
      "ACCOUNT_RATE_LIMITED",
    ],
  ] as const)("blocks the frozen %s bucket before Auth", async (scope, decision, reasonCode) => {
    mocks.consumeRateLimit.mockReset()
    if (scope === "IP") mocks.consumeRateLimit.mockResolvedValueOnce(decision)
    else {
      mocks.consumeRateLimit
        .mockResolvedValueOnce(allowed())
        .mockResolvedValueOnce(decision)
    }

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID),
    ).rejects.toEqual(new AuthenticationRateLimitError(decision.retryAfterSeconds))
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith({
      eventType: "auth.reauthentication.rate_limited",
      emailHash: EMAIL_HASH,
      ipHash: IP_HASH,
      outcome: "denied",
      reasonCode,
      correlationId: CORRELATION_ID,
      metadata: {
        attempts: decision.attempts,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
    })
  })

  it.each([
    ["same session", USER_ID, OLD_SESSION_ID, NOW_SECONDS],
    [
      "different subject",
      "10000000-0000-4000-8000-000000000099",
      NEW_SESSION_ID,
      NOW_SECONDS,
    ],
    ["stale password AMR", USER_ID, NEW_SESSION_ID, NOW_SECONDS - 61],
  ])("rejects and globally signs out a %s", async (_case, subject, sessionId, amrTimestamp) => {
    mocks.getClaims.mockReset()
    mocks.getClaims
      .mockResolvedValueOnce({
        data: { claims: { sub: USER_ID, session_id: OLD_SESSION_ID } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          claims: {
            sub: subject,
            session_id: sessionId,
            amr: [{ method: "password", timestamp: amrTimestamp }],
          },
        },
        error: null,
      })

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", status: 401 })
    expect(mocks.rotateAppSessionAfterReauthentication).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
  })

  it("globally signs out the fresh Auth session if database rotation fails", async () => {
    mocks.rotateAppSessionAfterReauthentication.mockRejectedValue(
      new Error("private database detail"),
    )

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID),
    ).rejects.toThrow("Reauthentication unavailable")
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.getAccessContext).toHaveBeenCalledTimes(1)
  })

  it("revokes the fresh app session before global sign-out when final context resolution fails", async () => {
    const signOutErrorRead = vi.fn()
    mocks.getAccessContext.mockReset()
    mocks.getAccessContext
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce({ status: "anonymous" })
    mocks.signOut.mockResolvedValue({
      get error() {
        signOutErrorRead()
        return { message: "provider sign-out unavailable" }
      },
    })

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID),
    ).rejects.toThrow("Reauthentication unavailable")

    expect(mocks.failClosedLoginSession).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: NEW_SESSION_ID,
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      correlationId: CORRELATION_ID,
    })
    expect(
      mocks.rotateAppSessionAfterReauthentication.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.failClosedLoginSession.mock.invocationCallOrder[0])
    expect(mocks.failClosedLoginSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0],
    )
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(signOutErrorRead).toHaveBeenCalledOnce()
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
  })

  it("also contains a thrown final context-resolution failure", async () => {
    mocks.getAccessContext.mockReset()
    mocks.getAccessContext
      .mockResolvedValueOnce(context())
      .mockRejectedValueOnce(new Error("private context detail"))

    await expect(
      reauthenticate(INPUT, REQUEST, CORRELATION_ID),
    ).rejects.toThrow("Reauthentication unavailable")

    expect(mocks.failClosedLoginSession).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: NEW_SESSION_ID,
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      correlationId: CORRELATION_ID,
    })
    expect(mocks.failClosedLoginSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0],
    )
  })

  it("rejects email, identity, navigation, and extra fields before context", async () => {
    for (const field of ["email", "userId", "sessionId", "redirectTo"]) {
      await expect(
        reauthenticate(
          { ...INPUT, [field]: "attacker-value" },
          REQUEST,
          CORRELATION_ID,
        ),
      ).rejects.toBeDefined()
    }
    expect(mocks.getClaims).not.toHaveBeenCalled()
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
  })

  it("contains no raw logging, admin client, session registration, or storage", () => {
    const source = readFileSync(
      resolve("src/modules/auth/server/reauthenticate.ts"),
      "utf8",
    )
    expect(source.trimStart()).toMatch(/^import "server-only"/u)
    expect(source).not.toMatch(/console\.|logger\./u)
    expect(source).not.toContain("getAdminSupabase")
    expect(source).not.toContain("registerAuthSession")
    expect(source).not.toMatch(/localStorage|sessionStorage/u)
  })
})
