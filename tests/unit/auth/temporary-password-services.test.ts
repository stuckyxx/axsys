import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import {
  changeTemporaryPassword,
} from "@/modules/auth/server/change-temporary-password"
import {
  setTemporaryPassword,
  TemporaryPasswordRetryRequiredError,
} from "@/modules/auth/server/set-temporary-password"

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  completeChange: vi.fn(),
  completeReset: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGetAll: vi.fn(),
  cookies: vi.fn(),
  failReset: vi.fn(),
  getAccessContext: vi.fn(),
  getClaims: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  signOut: vi.fn(),
  updateCurrentUser: vi.fn(),
  updateUserById: vi.fn(),
  validatePassword: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))
vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    beginTemporaryPasswordReset: mocks.begin,
    completeTemporaryPasswordChange: mocks.completeChange,
    completeTemporaryPasswordReset: mocks.completeReset,
    failTemporaryPasswordReset: mocks.failReset,
  },
}))
vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabase: () => ({
    auth: { admin: { updateUserById: mocks.updateUserById } },
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getClaims: mocks.getClaims,
      signOut: mocks.signOut,
      updateUser: mocks.updateCurrentUser,
    },
  })),
}))
vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))
vi.mock("@/modules/auth/server/guards", () => ({
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}))
vi.mock("@/modules/auth/server/password-policy", () => ({
  validatePassword: mocks.validatePassword,
}))

const ACTOR_ID = "51000000-0000-4000-8000-000000000001"
const SESSION_ID = "51100000-0000-4000-8000-000000000001"
const TARGET_ID = "52000000-0000-4000-8000-000000000001"
const OPERATION_ID = "53000000-0000-4000-8000-000000000001"
const CORRELATION_ID = "54000000-0000-4000-8000-000000000001"
const PASSWORD = "Senha provisória forte 42!"
const REQUEST_REASON_CODE = "ADMIN_RESET_USER_REQUEST" as const
const EXPIRES_AT = "2030-01-02T03:04:05.000Z"
const actor = {
  kind: "company" as const,
  userId: ACTOR_ID,
  sessionId: SESSION_ID,
  authenticatedAt: 1_900_000_000,
  companyId: "55000000-0000-4000-8000-000000000001",
  membershipId: "56000000-0000-4000-8000-000000000001",
  role: "company_admin" as const,
  modules: [] as const,
  profile: {
    displayName: "Admin",
    email: "admin@example.test",
    preferredTheme: "dark" as const,
    version: 1,
  },
}

beforeEach(() => {
  mocks.begin.mockResolvedValue({ operationId: OPERATION_ID, expiresAt: EXPIRES_AT })
  mocks.completeChange.mockResolvedValue(undefined)
  mocks.completeReset.mockResolvedValue(undefined)
  mocks.failReset.mockResolvedValue(undefined)
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: TARGET_ID, session_id: SESSION_ID } },
    error: null,
  })
  mocks.getAccessContext.mockResolvedValue({
    status: "password_change",
    userId: TARGET_ID,
    expired: false,
  })
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.updateCurrentUser.mockResolvedValue({ data: {}, error: null })
  mocks.updateUserById.mockResolvedValue({ data: {}, error: null })
  mocks.validatePassword.mockResolvedValue(undefined)
  mocks.cookieGetAll.mockReturnValue([
    { name: "sb-project-auth-token", value: "secret-cookie" },
    { name: "unrelated", value: "keep" },
  ])
  mocks.cookies.mockResolvedValue({
    delete: mocks.cookieDelete,
    getAll: mocks.cookieGetAll,
  })
})

describe("Task 12 administrative temporary password", () => {
  it("closes RLS before the only Auth Admin password call and then completes", async () => {
    const result = await setTemporaryPassword({
      actor,
      targetUserId: TARGET_ID,
      password: PASSWORD,
      reasonCode: REQUEST_REASON_CODE,
      correlationId: CORRELATION_ID,
    })

    expect(result).toEqual({
      operationId: OPERATION_ID,
      status: "completed",
      expiresAt: EXPIRES_AT,
    })
    expect(mocks.requireRecentAuthentication).toHaveBeenCalledWith(actor)
    expect(mocks.validatePassword).toHaveBeenCalledWith(PASSWORD)
    expect(mocks.begin).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      targetUserId: TARGET_ID,
      requestReasonCode: REQUEST_REASON_CODE,
      correlationId: CORRELATION_ID,
    })
    expect(mocks.updateUserById).toHaveBeenCalledWith(TARGET_ID, {
      password: PASSWORD,
    })
    expect(mocks.completeReset).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      operationId: OPERATION_ID,
      correlationId: CORRELATION_ID,
    })
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUserById.mock.invocationCallOrder[0],
    )
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeReset.mock.invocationCallOrder[0],
    )
    expect(mocks.failReset).not.toHaveBeenCalled()
  })

  it("requires recent authentication before reserving or touching Auth", async () => {
    mocks.requireRecentAuthentication.mockImplementationOnce(() => {
      throw new ApiError("REAUTHENTICATION_REQUIRED", 403, "Confirme sua senha.")
    })

    await expect(
      setTemporaryPassword({
        actor,
        targetUserId: TARGET_ID,
        password: PASSWORD,
        reasonCode: REQUEST_REASON_CODE,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" })
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it.each([
    ["P0002", "USER_NOT_FOUND", 404],
    ["42501", "FORBIDDEN", 403],
    ["23505", "TEMPORARY_PASSWORD_OPERATION_IN_PROGRESS", 409],
  ])("maps database authorization %s without an existence oracle", async (code, apiCode, status) => {
    mocks.begin.mockRejectedValueOnce(Object.assign(new Error("private detail"), { code }))

    await expect(
      setTemporaryPassword({
        actor,
        targetUserId: TARGET_ID,
        password: PASSWORD,
        reasonCode: REQUEST_REASON_CODE,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toMatchObject({ code: apiCode, status })
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it.each([
    ["before Auth", "AUTH_CALL_NOT_ATTEMPTED", "beforeAuthUpdate"],
    ["during Auth", "AUTH_PROVIDER_FAILURE", "provider"],
    ["after Auth", "AUTH_COMPLETION_FAILURE", "afterAuthUpdate"],
  ] as const)("keeps a durable failed operation when failure occurs %s", async (_case, reasonCode, stage) => {
    const dependencies: Parameters<typeof setTemporaryPassword>[1] = {}
    if (stage === "beforeAuthUpdate") {
      dependencies.beforeAuthUpdate = vi.fn(async () => {
        throw new Error(`raw ${PASSWORD}`)
      })
    } else if (stage === "provider") {
      dependencies.updateAuthPassword = vi.fn(async () => {
        throw new Error(`raw ${PASSWORD}`)
      })
    } else {
      dependencies.afterAuthUpdate = vi.fn(async () => {
        throw new Error(`raw ${PASSWORD}`)
      })
    }

    let thrown: unknown
    try {
      await setTemporaryPassword(
        {
          actor,
          targetUserId: TARGET_ID,
          password: PASSWORD,
          reasonCode: REQUEST_REASON_CODE,
          correlationId: CORRELATION_ID,
        },
        dependencies,
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(TemporaryPasswordRetryRequiredError)
    expect(thrown).toMatchObject({
      code: "TEMPORARY_PASSWORD_RETRY_REQUIRED",
      operationId: OPERATION_ID,
      operationStatus: "failed",
    })
    expect(JSON.stringify(thrown)).not.toContain(PASSWORD)
    expect(mocks.failReset).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      operationId: OPERATION_ID,
      reasonCode,
      correlationId: CORRELATION_ID,
    })
  })

  it("surfaces a reserved operation when the failure marker is unavailable", async () => {
    mocks.updateUserById.mockRejectedValueOnce(new Error(`provider ${PASSWORD}`))
    mocks.failReset.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(
      setTemporaryPassword({
        actor,
        targetUserId: TARGET_ID,
        password: PASSWORD,
        reasonCode: REQUEST_REASON_CODE,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toMatchObject({
      operationId: OPERATION_ID,
      operationStatus: "reserved",
    })
  })
})

describe("Task 12 forced password change", () => {
  it("updates Auth, atomically completes DB revocation, then signs out globally", async () => {
    await expect(
      changeTemporaryPassword(
        { password: PASSWORD, confirmation: PASSWORD },
        CORRELATION_ID,
      ),
    ).resolves.toEqual({ redirectTo: "/login" })

    expect(mocks.validatePassword).toHaveBeenCalledWith(PASSWORD)
    expect(mocks.updateCurrentUser).toHaveBeenCalledWith({ password: PASSWORD })
    expect(mocks.completeChange).toHaveBeenCalledWith({
      actorUserId: TARGET_ID,
      sessionId: SESSION_ID,
      correlationId: CORRELATION_ID,
    })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.updateCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeChange.mock.invocationCallOrder[0],
    )
    expect(mocks.completeChange.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0],
    )
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated")
  })

  it("refuses expired temporary state before Auth", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "password_change",
      userId: TARGET_ID,
      expired: true,
    })

    await expect(
      changeTemporaryPassword(
        { password: PASSWORD, confirmation: PASSWORD },
        CORRELATION_ID,
      ),
    ).rejects.toMatchObject({ code: "TEMPORARY_PASSWORD_EXPIRED", status: 403 })
    expect(mocks.updateCurrentUser).not.toHaveBeenCalled()
  })

  it("keeps the response neutral when DB completion fails after Auth", async () => {
    mocks.completeChange.mockRejectedValueOnce(new Error(`private ${PASSWORD}`))

    await expect(
      changeTemporaryPassword(
        { password: PASSWORD, confirmation: PASSWORD },
        CORRELATION_ID,
      ),
    ).rejects.toEqual(
      new ApiError(
        "PASSWORD_CHANGE_RETRY_REQUIRED",
        503,
        "Não foi possível concluir a troca. Entre novamente e tente de novo.",
      ),
    )
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-project-auth-token")
  })
})

describe("Task 12 credential source boundary", () => {
  it("never logs, persists or sends a password to table CRUD", () => {
    const source = [
      "src/modules/auth/server/set-temporary-password.ts",
      "src/modules/auth/server/change-temporary-password.ts",
    ].map((path) => readFileSync(resolve(path), "utf8")).join("\n")

    expect(source).not.toMatch(/console\.|logger\.|\.from\(/u)
    expect(source).not.toMatch(/password\s*:\s*.*(?:bffDb|metadata|audit)/u)
    expect(source).toContain("validatePassword")
  })
})
