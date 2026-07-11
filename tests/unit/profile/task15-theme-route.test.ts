import { beforeEach, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { ApiError } from "@/lib/http/api-error"
import { createPlatformContext } from "../../helpers/auth"

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(),
  assertMutationOrigin: vi.fn(),
  cookieGet: vi.fn(),
  cookies: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  currentEq: vi.fn(),
  currentMaybeSingle: vi.fn(),
  currentSelect: vi.fn(),
  getAccessContext: vi.fn(),
  update: vi.fn(),
  updateEqUser: vi.fn(),
  updateEqVersion: vi.fn(),
  updateMaybeSingle: vi.fn(),
  updateSelect: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))
vi.mock("@/lib/security/csrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/csrf")>()
  return { ...actual, assertCsrf: mocks.assertCsrf }
})
vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: mocks.assertMutationOrigin,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}))
vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))

import { PATCH } from "@/app/api/profile/theme/route"

const USER_ID = "10000000-0000-4000-8000-000000000001"
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const CSRF_TOKEN = "csrf-token"

function request(body: unknown): Request {
  return new Request("https://axsys.test/api/profile/theme", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://axsys.test",
      "x-correlation-id": CORRELATION_ID,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  })
}

function expectNoStore(response: Response): void {
  for (const [header, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(header)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookieGet.mockReturnValue({ value: CSRF_TOKEN })
  mocks.cookies.mockResolvedValue({ get: mocks.cookieGet })
  mocks.getAccessContext.mockResolvedValue({
    status: "authenticated",
    context: createPlatformContext(),
  })

  mocks.updateMaybeSingle.mockResolvedValue({
    data: { preferred_theme: "light", version: 8 },
    error: null,
  })
  mocks.updateSelect.mockReturnValue({ maybeSingle: mocks.updateMaybeSingle })
  mocks.updateEqVersion.mockReturnValue({ select: mocks.updateSelect })
  mocks.updateEqUser.mockReturnValue({ eq: mocks.updateEqVersion })
  mocks.update.mockReturnValue({ eq: mocks.updateEqUser })

  mocks.currentMaybeSingle.mockResolvedValue({
    data: { preferred_theme: "dark", version: 9 },
    error: null,
  })
  mocks.currentEq.mockReturnValue({ maybeSingle: mocks.currentMaybeSingle })
  mocks.currentSelect.mockReturnValue({ eq: mocks.currentEq })
  mocks.from.mockReturnValue({
    select: mocks.currentSelect,
    update: mocks.update,
  })
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from })
})

describe("Task 15 profile theme route", () => {
  it("updates only the authenticated profile with optimistic concurrency", async () => {
    const response = await PATCH(request({ theme: "light", version: 7 }))

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({
      preferredTheme: "light",
      version: 8,
    })
    expect(mocks.assertMutationOrigin).toHaveBeenCalledWith("https://axsys.test")
    expect(mocks.assertCsrf).toHaveBeenCalledWith(CSRF_TOKEN, CSRF_TOKEN)
    expect(mocks.getAccessContext).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith("profiles")
    expect(mocks.update).toHaveBeenCalledWith({ preferred_theme: "light" })
    expect(mocks.updateEqUser).toHaveBeenCalledWith("user_id", USER_ID)
    expect(mocks.updateEqVersion).toHaveBeenCalledWith("version", 7)
    expect(mocks.updateSelect).toHaveBeenCalledWith("preferred_theme,version")
    expect(mocks.assertMutationOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCsrf.mock.invocationCallOrder[0],
    )
    expect(mocks.assertCsrf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAccessContext.mock.invocationCallOrder[0],
    )
  })

  it("returns the current self row on a stale version without overwriting it", async () => {
    mocks.updateMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await PATCH(request({ theme: "light", version: 3 }))

    expect(response.status).toBe(409)
    expectNoStore(response)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "Os dados mudaram em outra sessão.",
        correlationId: CORRELATION_ID,
      },
      current: { preferredTheme: "dark", version: 9 },
    })
    expect(mocks.currentSelect).toHaveBeenCalledWith("preferred_theme,version")
    expect(mocks.currentEq).toHaveBeenCalledWith("user_id", USER_ID)
  })

  it.each(["userId", "companyId", "role"])(
    "rejects client-owned authority field %s before database access",
    async (field) => {
      const response = await PATCH(
        request({ theme: "light", version: 7, [field]: "attacker-value" }),
      )

      expect(response.status).toBe(422)
      expectNoStore(response)
      expect(mocks.getAccessContext).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )

  it("fails closed with a generic envelope when PostgREST rejects the update", async () => {
    mocks.updateMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "sensitive database detail" },
    })

    const response = await PATCH(request({ theme: "light", version: 7 }))

    expect(response.status).toBe(500)
    expectNoStore(response)
    const text = await response.text()
    expect(text).toContain("Não foi possível concluir a operação.")
    expect(text).not.toContain("sensitive database detail")
  })

  it("stops before CSRF, context and database when Origin is invalid", async () => {
    mocks.assertMutationOrigin.mockImplementationOnce(() => {
      throw new ApiError("ORIGIN_INVALID", 403, "Origem da requisição recusada.")
    })

    const response = await PATCH(request({ theme: "light", version: 7 }))

    expect(response.status).toBe(403)
    expectNoStore(response)
    expect(mocks.assertCsrf).not.toHaveBeenCalled()
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("stops before context and database when CSRF is invalid", async () => {
    mocks.assertCsrf.mockImplementationOnce(() => {
      throw new ApiError("CSRF_INVALID", 403, "Token de segurança inválido.")
    })

    const response = await PATCH(request({ theme: "light", version: 7 }))

    expect(response.status).toBe(403)
    expectNoStore(response)
    expect(mocks.getAccessContext).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    ["anonymous", { status: "anonymous" }, 401, "AUTH_REQUIRED"],
    [
      "password change",
      {
        status: "password_change",
        userId: USER_ID,
        expired: false,
      },
      403,
      "PASSWORD_CHANGE_REQUIRED",
    ],
  ])("returns an API envelope instead of a redirect for %s", async (_name, resolution, status, code) => {
    mocks.getAccessContext.mockResolvedValueOnce(resolution)

    const response = await PATCH(request({ theme: "light", version: 7 }))

    expect(response.status).toBe(status)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code, correlationId: CORRELATION_ID },
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
