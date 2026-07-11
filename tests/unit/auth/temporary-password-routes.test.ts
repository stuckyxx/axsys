import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { POST as changePasswordPost } from "@/app/api/auth/change-password/route"
import { POST as temporaryPasswordPost } from "@/app/api/auth/temporary-password/route"
import { TemporaryPasswordRetryRequiredError } from "@/modules/auth/server/set-temporary-password"

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(),
  assertMutationOrigin: vi.fn(),
  changeTemporaryPassword: vi.fn(),
  cookies: vi.fn(),
  getAccessContext: vi.fn(),
  setTemporaryPassword: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))
vi.mock("@/lib/security/csrf", () => ({
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
  assertCsrf: mocks.assertCsrf,
}))
vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: mocks.assertMutationOrigin,
}))
vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))
vi.mock("@/modules/auth/server/change-temporary-password", () => ({
  changeTemporaryPassword: mocks.changeTemporaryPassword,
}))
vi.mock(
  "@/modules/auth/server/set-temporary-password",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/modules/auth/server/set-temporary-password")
    >()
    return {
      ...actual,
      setTemporaryPassword: mocks.setTemporaryPassword,
    }
  },
)

const CSRF = "csrf-token"
const PASSWORD = "Senha provisória forte 42!"
const TARGET_ID = "61000000-0000-4000-8000-000000000001"
const OPERATION_ID = "62000000-0000-4000-8000-000000000001"
const actor = {
  kind: "platform" as const,
  userId: "63000000-0000-4000-8000-000000000001",
  sessionId: "64000000-0000-4000-8000-000000000001",
  authenticatedAt: 1_900_000_000,
  profile: {
    displayName: "Super Admin",
    email: "platform@example.test",
    preferredTheme: "dark" as const,
    version: 1,
  },
}

function request(path: string, body: unknown): Request {
  return new Request(`https://axsys.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://axsys.test",
      "x-correlation-id": "65000000-0000-4000-8000-000000000001",
      "x-csrf-token": CSRF,
    },
    body: JSON.stringify(body),
  })
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  mocks.cookies.mockResolvedValue({
    get: (name: string) =>
      name === "__Host-axsys-csrf" ? { name, value: CSRF } : undefined,
  })
  mocks.getAccessContext.mockResolvedValue({ status: "authenticated", context: actor })
  mocks.setTemporaryPassword.mockResolvedValue({
    operationId: OPERATION_ID,
    status: "completed",
    expiresAt: "2030-01-01T00:00:00.000Z",
  })
  mocks.changeTemporaryPassword.mockResolvedValue({ redirectTo: "/login" })
})

describe("Task 12 temporary-password handlers", () => {
  describe.each([
    ["temporary-password", temporaryPasswordPost],
    ["change-password", changePasswordPost],
  ] as const)("%s security short-circuit", (_name, handler) => {
    it("rejects Origin before CSRF, JSON parsing and authentication", async () => {
      mocks.assertMutationOrigin.mockImplementationOnce(() => {
        throw new ApiError("ORIGIN_INVALID", 403, "Origem recusada.")
      })
      const guardedRequest = request("/api/auth/guarded", { invalid: true })
      const json = vi.spyOn(guardedRequest, "json")

      const response = await handler(guardedRequest)

      expect(response.status).toBe(403)
      expectNoStore(response)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ORIGIN_INVALID" },
      })
      expect(mocks.assertCsrf).not.toHaveBeenCalled()
      expect(json).not.toHaveBeenCalled()
      expect(mocks.getAccessContext).not.toHaveBeenCalled()
    })

    it("rejects CSRF before JSON parsing and authentication", async () => {
      mocks.assertCsrf.mockImplementationOnce(() => {
        throw new ApiError("CSRF_INVALID", 403, "Token recusado.")
      })
      const guardedRequest = request("/api/auth/guarded", { invalid: true })
      const json = vi.spyOn(guardedRequest, "json")

      const response = await handler(guardedRequest)

      expect(response.status).toBe(403)
      expectNoStore(response)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "CSRF_INVALID" },
      })
      expect(json).not.toHaveBeenCalled()
      expect(mocks.getAccessContext).not.toHaveBeenCalled()
    })
  })

  it("returns only the durable administrative result under no-store", async () => {
    const response = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        targetUserId: TARGET_ID,
        password: PASSWORD,
      }),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({
      operationId: OPERATION_ID,
      status: "completed",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })
    expect(mocks.setTemporaryPassword).toHaveBeenCalledWith({
      actor,
      targetUserId: TARGET_ID,
      password: PASSWORD,
      correlationId: "65000000-0000-4000-8000-000000000001",
    })
    expect(mocks.assertMutationOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCsrf.mock.invocationCallOrder[0],
    )
    expect(mocks.assertCsrf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAccessContext.mock.invocationCallOrder[0],
    )
  })

  it.each([
    [{ status: "anonymous" }, 401, "AUTH_REQUIRED"],
    [
      { status: "password_change", userId: actor.userId, expired: false },
      403,
      "PASSWORD_CHANGE_REQUIRED",
    ],
  ] as const)("converts non-authenticated admin state to JSON", async (resolution, status, code) => {
    mocks.getAccessContext.mockResolvedValueOnce(resolution)
    const response = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        targetUserId: TARGET_ID,
        password: PASSWORD,
      }),
    )

    expect(response.status).toBe(status)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
    expect(mocks.setTemporaryPassword).not.toHaveBeenCalled()
  })

  it("surfaces only safe reconciliation state on a saga failure", async () => {
    mocks.setTemporaryPassword.mockRejectedValueOnce(
      new TemporaryPasswordRetryRequiredError(OPERATION_ID, "failed"),
    )
    const response = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        targetUserId: TARGET_ID,
        password: PASSWORD,
      }),
    )

    expect(response.status).toBe(503)
    expectNoStore(response)
    const body = await response.text()
    expect(body).toContain(OPERATION_ID)
    expect(body).toContain('"operationStatus":"failed"')
    expect(body).not.toContain(PASSWORD)
  })

  it("rejects protected fields through the strict schema", async () => {
    const response = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        targetUserId: TARGET_ID,
        password: PASSWORD,
        companyId: "forged",
        actorUserId: "forged",
      }),
    )
    expect(response.status).toBe(422)
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
    expect(mocks.setTemporaryPassword).not.toHaveBeenCalled()
  })

  it("allows change-password only for a current forced-change state", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "password_change",
      userId: TARGET_ID,
      expired: false,
    })
    const response = await changePasswordPost(
      request("/api/auth/change-password", {
        password: PASSWORD,
        confirmation: PASSWORD,
      }),
    )
    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({ redirectTo: "/login" })
    expect(mocks.changeTemporaryPassword).toHaveBeenCalledWith(
      { password: PASSWORD, confirmation: PASSWORD },
      "65000000-0000-4000-8000-000000000001",
    )
  })

  it.each([
    [{ status: "anonymous" }, 401, "AUTH_REQUIRED"],
    [{ status: "authenticated", context: actor }, 403, "PASSWORD_CHANGE_NOT_REQUIRED"],
    [
      { status: "password_change", userId: TARGET_ID, expired: true },
      403,
      "TEMPORARY_PASSWORD_EXPIRED",
    ],
  ] as const)("blocks change-password outside its exact state", async (resolution, status, code) => {
    mocks.getAccessContext.mockResolvedValueOnce(resolution)
    const response = await changePasswordPost(
      request("/api/auth/change-password", {
        password: PASSWORD,
        confirmation: PASSWORD,
      }),
    )
    expect(response.status).toBe(status)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
    expect(mocks.changeTemporaryPassword).not.toHaveBeenCalled()
  })
})
