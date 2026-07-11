import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import {
  AuthenticationRateLimitError,
  login,
} from "@/modules/auth/server/login"

const mocks = vi.hoisted(() => ({
  assertAuthSession: vi.fn(),
  clearAccountFailureRateLimit: vi.fn(),
  consumeRateLimit: vi.fn(),
  cookies: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGetAll: vi.fn(),
  failClosedLoginSession: vi.fn(),
  getAccessContext: vi.fn(),
  getClientIp: vi.fn(),
  getClaims: vi.fn(),
  hashSensitive: vi.fn(),
  registerAuthSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  writeAuditEvent: vi.fn(),
  writeSecurityEvent: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    assertAuthSession: mocks.assertAuthSession,
    failClosedLoginSession: mocks.failClosedLoginSession,
    registerAuthSession: mocks.registerAuthSession,
  },
}))

vi.mock("@/lib/security/rate-limit", () => ({
  clearAccountFailureRateLimit: mocks.clearAccountFailureRateLimit,
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
  progressiveDelayMs: (attempts: number) => 250 * 2 ** Math.max(0, attempts - 1),
}))

vi.mock("@/lib/security/redact", () => ({
  hashSensitive: mocks.hashSensitive,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getClaims: mocks.getClaims,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  })),
}))

vi.mock("@/modules/audit/server/write-audit-event", () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock("@/modules/audit/server/write-security-event", () => ({
  writeSecurityEvent: mocks.writeSecurityEvent,
}))

vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))

const USER_ID = "10000000-0000-4000-8000-000000000001"
const SESSION_ID = "90000000-0000-4000-8000-000000000001"
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const EMAIL_HASH = "a".repeat(64)
const IP_HASH = "b".repeat(64)
const USER_AGENT_HASH = "c".repeat(64)
const REQUEST = new Request("https://axsys.test/api/auth/login", {
  method: "POST",
  headers: { "user-agent": "test-agent" },
})
const INPUT = {
  email: "person@example.test",
  password: "correct horse battery staple",
  rememberMe: true,
} as const

function allowed(attempts = 1) {
  return { allowed: true, attempts, retryAfterSeconds: 0 }
}

function platformContext() {
  return {
    status: "authenticated" as const,
    context: {
      kind: "platform" as const,
      userId: USER_ID,
      sessionId: SESSION_ID,
      authenticatedAt: 1_700_000_000,
      profile: {
        displayName: "Platform Admin",
        email: INPUT.email,
        preferredTheme: "dark" as const,
        version: 1,
      },
    },
  }
}

beforeEach(() => {
  mocks.consumeRateLimit
    .mockResolvedValueOnce(allowed())
    .mockResolvedValueOnce(allowed())
  mocks.clearAccountFailureRateLimit.mockResolvedValue(undefined)
  mocks.getClientIp.mockReturnValue("203.0.113.10")
  mocks.hashSensitive.mockImplementation((value: string) => {
    if (value === INPUT.email) return EMAIL_HASH
    if (value === "203.0.113.10") return IP_HASH
    if (value === "test-agent") return USER_AGENT_HASH
    throw new Error("unexpected raw hash input")
  })
  mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID, session_id: SESSION_ID } },
    error: null,
  })
  mocks.registerAuthSession.mockResolvedValue("2030-01-01T00:00:00.000Z")
  mocks.writeAuditEvent.mockResolvedValue(undefined)
  mocks.writeSecurityEvent.mockResolvedValue(undefined)
  mocks.getAccessContext.mockResolvedValue(platformContext())
  mocks.failClosedLoginSession.mockResolvedValue(undefined)
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.cookieGetAll.mockReturnValue([
    { name: "sb-project-auth-token", value: "raw-auth-cookie" },
    { name: "unrelated", value: "keep" },
  ])
  mocks.cookies.mockResolvedValue({
    delete: mocks.cookieDelete,
    getAll: mocks.cookieGetAll,
  })
})

describe("Task 11 login service", () => {
  it("activates the pending session and audit before resolving the redirect", async () => {
    const sleep = vi.fn()

    await expect(
      login(INPUT, REQUEST, CORRELATION_ID, { sleep }),
    ).resolves.toEqual({ redirectTo: "/platform" })

    expect(mocks.consumeRateLimit.mock.calls).toEqual([
      ["login-ip-volume", "203.0.113.10"],
      ["login-account-failure", INPUT.email],
    ])
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: INPUT.email,
      password: INPUT.password,
    })
    expect(mocks.clearAccountFailureRateLimit).toHaveBeenCalledWith(
      "login-account-failure",
      INPUT.email,
    )
    expect(mocks.registerAuthSession).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      true,
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      action: "auth.login",
      resourceType: "session",
      resourceId: null,
      outcome: "success",
      reasonCode: null,
      correlationId: CORRELATION_ID,
      ipHash: IP_HASH,
      userAgentHash: USER_AGENT_HASH,
      metadata: { rememberMe: true },
    })
    expect(mocks.writeAuditEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAccessContext.mock.invocationCallOrder[0],
    )
    expect(mocks.failClosedLoginSession).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([
    ["platform", platformContext(), "/platform"],
    [
      "company",
      {
        status: "authenticated",
        context: {
          ...platformContext().context,
          kind: "company",
          companyId: "30000000-0000-4000-8000-000000000001",
          membershipId: "40000000-0000-4000-8000-000000000001",
          role: "member",
          modules: ["certificates"],
        },
      },
      "/app/dashboard",
    ],
    [
      "password change",
      { status: "password_change", userId: USER_ID, expired: false },
      "/change-password",
    ],
  ] as const)("returns only the server-derived %s redirect", async (_case, resolution, redirectTo) => {
    mocks.getAccessContext.mockResolvedValue(resolution)

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).resolves.toEqual({
      redirectTo,
    })
  })

  it.each([
    ["known account", { message: "Invalid login credentials" }],
    ["unknown account", { message: "User not found" }],
  ])("returns the same delayed credential error for a %s", async (_case, providerError) => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: providerError })
    const sleep = vi.fn()

    let thrown: unknown
    try {
      await login(INPUT, REQUEST, CORRELATION_ID, { sleep })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(
      new ApiError(
        "AUTH_INVALID_CREDENTIALS",
        401,
        "E-mail ou senha inválidos.",
      ),
    )
    expect(sleep).toHaveBeenCalledWith(250)
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith({
      eventType: "auth.login.failed",
      emailHash: EMAIL_HASH,
      ipHash: IP_HASH,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId: CORRELATION_ID,
      metadata: { attempts: 1 },
    })
    expect(JSON.stringify(mocks.writeSecurityEvent.mock.calls)).not.toContain(
      INPUT.email,
    )
    expect(JSON.stringify(mocks.writeSecurityEvent.mock.calls)).not.toContain(
      INPUT.password,
    )
    expect(mocks.registerAuthSession).not.toHaveBeenCalled()
  })

  it("keeps a thrown provider failure outwardly neutral", async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error("provider raw detail"))
    const sleep = vi.fn()

    await expect(
      login(INPUT, REQUEST, CORRELATION_ID, { sleep }),
    ).rejects.toEqual(
      new ApiError(
        "AUTH_INVALID_CREDENTIALS",
        401,
        "E-mail ou senha inválidos.",
      ),
    )
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
      { allowed: false, attempts: 31, retryAfterSeconds: 1_800 },
      "IP_RATE_LIMITED",
    ],
    [
      "account",
      { allowed: false, attempts: 6, retryAfterSeconds: 900 },
      "ACCOUNT_RATE_LIMITED",
    ],
  ] as const)("blocks the frozen %s bucket before Auth", async (scope, decision, reasonCode) => {
    mocks.consumeRateLimit.mockReset()
    if (scope === "IP") {
      mocks.consumeRateLimit.mockResolvedValueOnce(decision)
    } else {
      mocks.consumeRateLimit
        .mockResolvedValueOnce(allowed())
        .mockResolvedValueOnce(decision)
    }

    let thrown: unknown
    try {
      await login(INPUT, REQUEST, CORRELATION_ID)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(
      new AuthenticationRateLimitError(decision.retryAfterSeconds),
    )
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith({
      eventType: "auth.login.rate_limited",
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

  it("revokes the pending row and clears only auth cookies if activation fails", async () => {
    mocks.writeAuditEvent.mockRejectedValue(new Error("private database detail"))
    mocks.failClosedLoginSession
      .mockRejectedValueOnce(new Error("not an expired temporary password"))
      .mockResolvedValueOnce(undefined)

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).rejects.toEqual(
      new ApiError(
        "AUTH_LOGIN_UNAVAILABLE",
        403,
        "Não foi possível concluir o acesso.",
      ),
    )

    expect(mocks.failClosedLoginSession.mock.calls).toEqual([
      [
        {
          actorUserId: USER_ID,
          sessionId: SESSION_ID,
          reasonCode: "TEMPORARY_PASSWORD_EXPIRED",
          correlationId: CORRELATION_ID,
        },
      ],
      [
        {
          actorUserId: USER_ID,
          sessionId: SESSION_ID,
          reasonCode: "AUTH_AUDIT_ACTIVATION_FAILED",
          correlationId: CORRELATION_ID,
        },
      ],
    ])
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
  })

  it("returns the stable expiry error only when atomic fail-closed classification succeeds", async () => {
    mocks.writeAuditEvent.mockRejectedValue(new Error("private database detail"))

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).rejects.toEqual(
      new ApiError(
        "TEMPORARY_PASSWORD_EXPIRED",
        403,
        "A senha provisória expirou. Solicite uma nova senha.",
      ),
    )

    expect(mocks.failClosedLoginSession).toHaveBeenCalledTimes(1)
    expect(mocks.failClosedLoginSession).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      reasonCode: "TEMPORARY_PASSWORD_EXPIRED",
      correlationId: CORRELATION_ID,
    })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
  })

  it("fails closed when password-change resolution belongs to another actor", async () => {
    mocks.getAccessContext.mockResolvedValue({
      status: "password_change",
      userId: "10000000-0000-4000-8000-000000000099",
      expired: false,
    })

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).rejects.toEqual(
      new ApiError(
        "AUTH_LOGIN_UNAVAILABLE",
        403,
        "Não foi possível concluir o acesso.",
      ),
    )
    expect(mocks.failClosedLoginSession).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: SESSION_ID,
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      correlationId: CORRELATION_ID,
    })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
  })

  it("keeps post-activation expiry generic when atomic classification fails", async () => {
    mocks.getAccessContext.mockResolvedValue({
      status: "password_change",
      userId: USER_ID,
      expired: true,
    })
    mocks.failClosedLoginSession
      .mockRejectedValueOnce(new Error("expiry classification rejected"))
      .mockResolvedValueOnce(undefined)

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).rejects.toEqual(
      new ApiError(
        "AUTH_LOGIN_UNAVAILABLE",
        403,
        "Não foi possível concluir o acesso.",
      ),
    )
    expect(mocks.failClosedLoginSession.mock.calls).toEqual([
      [
        {
          actorUserId: USER_ID,
          sessionId: SESSION_ID,
          reasonCode: "TEMPORARY_PASSWORD_EXPIRED",
          correlationId: CORRELATION_ID,
        },
      ],
      [
        {
          actorUserId: USER_ID,
          sessionId: SESSION_ID,
          reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
          correlationId: CORRELATION_ID,
        },
      ],
    ])
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
  })

  it("revokes an activated session when context resolution fails", async () => {
    mocks.getAccessContext.mockResolvedValue({ status: "anonymous" })

    await expect(login(INPUT, REQUEST, CORRELATION_ID)).rejects.toMatchObject({
      code: "AUTH_LOGIN_UNAVAILABLE",
    })
    expect(mocks.failClosedLoginSession).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      }),
    )
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
  })

  it("strictly rejects protected navigation and authority fields", async () => {
    await expect(
      login(
        {
          ...INPUT,
          redirectTo: "/platform",
          role: "super_admin",
          companyId: "30000000-0000-4000-8000-000000000001",
        } as typeof INPUT,
        REQUEST,
        CORRELATION_ID,
      ),
    ).rejects.toBeDefined()

    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it("contains no provider error logging, admin client, or client navigation input", () => {
    const source = readFileSync(
      resolve("src/modules/auth/server/login.ts"),
      "utf8",
    )
    expect(source.trimStart()).toMatch(/^import "server-only"/u)
    expect(source).not.toMatch(/console\.|logger\./u)
    expect(source).not.toContain("getAdminSupabase")
    expect(source).not.toContain("SUPABASE_SECRET_KEY")
    expect(source).not.toContain("input.redirectTo")
    expect(source).not.toContain("input.companyId")
    expect(source).not.toContain("input.role")
    expect(source).not.toContain('.from("profiles")')
    expect(source).not.toMatch(/PostgresError|error\.(?:code|message)/u)
  })
})
