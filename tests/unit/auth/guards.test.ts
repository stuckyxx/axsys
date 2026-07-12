import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import { createCompanyContext, createPlatformContext } from "../../helpers/auth"

const mocks = vi.hoisted(() => ({
  getAccessContext: vi.fn(),
  redirect: vi.fn((location: string): never => {
    throw new Error(`REDIRECT:${location}`)
  }),
}))

vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
  getCompanyApiAccessContext: mocks.getAccessContext,
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

import {
  requireAccessContext,
  requireCompanyApiContext,
  requireCompanyContext,
  requirePlatformContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"

const NOW = new Date("2026-07-11T12:00:00.000Z")
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000)

function withAuthenticationTime(
  context: AccessContext,
  authenticatedAt: unknown,
): AccessContext {
  return {
    ...context,
    authenticatedAt,
  } as AccessContext
}

describe("auth guards", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("redirects anonymous and password-change states without trusting Proxy", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({ status: "anonymous" })
    await expect(requireAccessContext()).rejects.toThrow("REDIRECT:/login")

    mocks.getAccessContext.mockResolvedValueOnce({
      status: "password_change",
      userId: "11111111-1111-4111-8111-111111111111",
      expired: false,
    })
    await expect(requireAccessContext()).rejects.toThrow(
      "REDIRECT:/change-password",
    )
  })

  it("returns an authenticated context", async () => {
    const context = createPlatformContext()
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context,
    })

    await expect(requireAccessContext()).resolves.toBe(context)
  })

  it("keeps platform and company page scopes separated", async () => {
    const platform = createPlatformContext()
    const company = createCompanyContext()

    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: company,
    })
    await expect(requirePlatformContext()).rejects.toThrow(
      "REDIRECT:/app/dashboard",
    )

    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: platform,
    })
    await expect(requireCompanyContext()).rejects.toThrow("REDIRECT:/platform")
  })

  it("returns a company context only when its DB-derived module is present", async () => {
    const context = createCompanyContext()
    mocks.getAccessContext.mockResolvedValue({
      status: "authenticated",
      context,
    })

    await expect(requireCompanyContext("financial")).resolves.toBe(context)
    await expect(requireCompanyContext("certificates")).resolves.toBe(context)
  })

  it("uses a stable module-forbidden API error", async () => {
    const context = {
      ...createCompanyContext(),
      modules: Object.freeze(["administrative"] as const),
    }
    mocks.getAccessContext.mockResolvedValue({
      status: "authenticated",
      context,
    })

    await expect(requireCompanyContext("financial")).rejects.toMatchObject({
      name: "ApiError",
      code: "MODULE_FORBIDDEN",
      status: 403,
      message: "Módulo não autorizado.",
    })
  })

  it.each([
    [
      "anonymous",
      { status: "anonymous" },
      { code: "AUTH_REQUIRED", status: 401 },
    ],
    [
      "temporary password",
      {
        status: "password_change",
        userId: "11111111-1111-4111-8111-111111111111",
        expired: false,
      },
      { code: "PASSWORD_CHANGE_REQUIRED", status: 403 },
    ],
    [
      "archived company",
      { status: "company_inactive", reason: "archived" },
      { code: "COMPANY_ARCHIVED", status: 403 },
    ],
  ])("returns an API error without redirecting for %s", async (_name, resolution, error) => {
    mocks.getAccessContext.mockResolvedValueOnce(resolution)

    await expect(requireCompanyApiContext()).rejects.toMatchObject(error)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("keeps platform users out of company APIs without redirecting", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: createPlatformContext(),
    })

    await expect(requireCompanyApiContext()).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
      status: 403,
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("returns the DB-derived company context and enforces optional modules", async () => {
    const context = {
      ...createCompanyContext(),
      modules: Object.freeze(["financial"] as const),
    }
    mocks.getAccessContext.mockResolvedValue({
      status: "authenticated",
      context,
    })

    await expect(requireCompanyApiContext("financial")).resolves.toBe(context)
    await expect(requireCompanyApiContext("administrative")).rejects.toMatchObject({
      code: "MODULE_FORBIDDEN",
      status: 403,
    })
  })

  it("accepts recent password authentication at the exact boundary", () => {
    expect(() =>
      requireRecentAuthentication(
        withAuthenticationTime(createPlatformContext(), NOW_SECONDS - 600),
      ),
    ).not.toThrow()
    expect(() =>
      requireRecentAuthentication(
        withAuthenticationTime(createPlatformContext(), NOW_SECONDS - 601),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "REAUTHENTICATION_REQUIRED",
        status: 403,
        message: "Confirme sua senha novamente para continuar.",
      }),
    )
  })

  it("supports a stricter positive max age", () => {
    const context = withAuthenticationTime(
      createPlatformContext(),
      NOW_SECONDS - 30,
    )
    expect(() => requireRecentAuthentication(context, 30)).not.toThrow()
    expect(() => requireRecentAuthentication(context, 29)).toThrow()
  })

  it.each([
    ["missing", 0],
    ["negative", -1],
    ["fractional", NOW_SECONDS - 0.5],
    ["not finite", Number.POSITIVE_INFINITY],
    ["not numeric", `${NOW_SECONDS}`],
    ["far future", NOW_SECONDS + 61],
  ])("rejects a %s authentication timestamp", (_name, authenticatedAt) => {
    expect(() =>
      requireRecentAuthentication(
        withAuthenticationTime(createPlatformContext(), authenticatedAt),
      ),
    ).toThrowError(expect.objectContaining({ code: "REAUTHENTICATION_REQUIRED" }))
  })

  it("clamps a valid small clock skew to now", () => {
    expect(() =>
      requireRecentAuthentication(
        withAuthenticationTime(createPlatformContext(), NOW_SECONDS + 60),
      ),
    ).not.toThrow()
  })

  it("fails closed when the runtime clock is not a finite integer", () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.NaN)

    expect(() =>
      requireRecentAuthentication(
        withAuthenticationTime(createPlatformContext(), NOW_SECONDS),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "REAUTHENTICATION_REQUIRED" }),
    )
  })

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, 601])(
    "fails closed for invalid maxAgeSeconds=%s",
    (maxAgeSeconds) => {
      expect(() =>
        requireRecentAuthentication(
          withAuthenticationTime(createPlatformContext(), NOW_SECONDS),
          maxAgeSeconds,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "REAUTHENTICATION_REQUIRED" }),
      )
    },
  )
})
