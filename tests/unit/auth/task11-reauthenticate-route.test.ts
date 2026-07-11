import { beforeEach, describe, expect, it, vi } from "vitest"

import * as route from "@/app/api/auth/reauthenticate/route"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { AuthenticationRateLimitError } from "@/modules/auth/server/login"

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(),
  assertMutationOrigin: vi.fn(),
  cookieGet: vi.fn(),
  cookies: vi.fn(),
  reauthenticate: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))
vi.mock("@/lib/security/csrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/csrf")>()
  return { ...actual, assertCsrf: mocks.assertCsrf }
})
vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: mocks.assertMutationOrigin,
}))
vi.mock("@/modules/auth/server/reauthenticate", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/auth/server/reauthenticate")
  >()
  return { ...actual, reauthenticate: mocks.reauthenticate }
})

const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const CSRF = "signed-csrf"

function request(body: unknown): Request {
  return new Request("https://axsys.test/api/auth/reauthenticate", {
    method: "POST",
    headers: {
      origin: "https://axsys.test",
      "x-csrf-token": CSRF,
      "x-correlation-id": CORRELATION_ID,
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
  mocks.cookieGet.mockReturnValue({
    name: "__Host-axsys-csrf",
    value: CSRF,
  })
  mocks.cookies.mockResolvedValue({ get: mocks.cookieGet })
  mocks.reauthenticate.mockResolvedValue({
    kind: "platform",
    userId: "10000000-0000-4000-8000-000000000001",
    modules: [],
    profile: {
      displayName: "Platform Admin",
      email: "admin@example.test",
      preferredTheme: "dark",
      version: 1,
    },
  })
})

describe("Task 11 reauthentication route", () => {
  it("enforces Origin then CSRF then strict parsing and returns no-store", async () => {
    const response = await route.POST(request({ password: "current-password" }))

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      kind: "platform",
      modules: [],
    })
    expect(mocks.assertMutationOrigin).toHaveBeenCalledWith(
      "https://axsys.test",
    )
    expect(mocks.assertCsrf).toHaveBeenCalledWith(CSRF, CSRF)
    expect(mocks.reauthenticate).toHaveBeenCalledWith(
      { password: "current-password" },
      expect.any(Request),
      CORRELATION_ID,
    )
    expect(mocks.assertMutationOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCsrf.mock.invocationCallOrder[0],
    )
    expect(mocks.assertCsrf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reauthenticate.mock.invocationCallOrder[0],
    )
  })

  it.each(["email", "userId", "sessionId", "redirectTo"])(
    "rejects protected body field %s before the service",
    async (field) => {
      const response = await route.POST(
        request({ password: "current-password", [field]: "attacker-value" }),
      )

      expect(response.status).toBe(422)
      expectNoStore(response)
      expect(mocks.reauthenticate).not.toHaveBeenCalled()
    },
  )

  it("adds a bounded Retry-After without changing the stable envelope", async () => {
    mocks.reauthenticate.mockRejectedValue(
      new AuthenticationRateLimitError(1_800),
    )

    const response = await route.POST(request({ password: "current-password" }))

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("1800")
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED", correlationId: CORRELATION_ID },
    })
  })
})
