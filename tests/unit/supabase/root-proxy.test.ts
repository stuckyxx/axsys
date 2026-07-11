import { NextRequest, NextResponse } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"

const { updateSupabaseSessionMock } = vi.hoisted(() => ({
  updateSupabaseSessionMock: vi.fn(),
}))

vi.mock("@/lib/supabase/proxy", () => ({
  updateSupabaseSession: updateSupabaseSessionMock,
}))

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
} as const

function stubPublicEnv(): void {
  for (const [name, value] of Object.entries(PUBLIC_ENV)) vi.stubEnv(name, value)
}

describe("Next.js security proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it("injects one identical request/response nonce and all security headers", async () => {
    stubPublicEnv()
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "123e4567-e89b-42d3-a456-426614174000",
    )
    updateSupabaseSessionMock.mockImplementation(
      async (_request: NextRequest, headers: Headers) =>
        NextResponse.next({ request: { headers } }),
    )
    const { proxy } = await import("@/proxy")
    const request = new NextRequest("https://axsys.test/api/auth/callback", {
      headers: {
        "x-nonce": "attacker-value",
        "content-security-policy": "connect-src *",
      },
    })

    const response = await proxy(request)

    const forwardedHeaders = updateSupabaseSessionMock.mock.calls[0][1] as Headers
    const expectedNonce = "123e4567e89b42d3a456426614174000"
    const requestCsp = forwardedHeaders.get("content-security-policy")
    expect(forwardedHeaders.get("x-nonce")).toBe(expectedNonce)
    expect(requestCsp).toContain(`'nonce-${expectedNonce}'`)
    expect(requestCsp).not.toContain("connect-src *")
    expect(response.headers.get("content-security-policy")).toBe(requestCsp)
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    )
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it("does not force no-store on a public path without refreshed cookies", async () => {
    stubPublicEnv()
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "223e4567-e89b-42d3-a456-426614174000",
    )
    updateSupabaseSessionMock.mockImplementation(
      async (_request: NextRequest, headers: Headers) =>
        NextResponse.next({ request: { headers } }),
    )
    const { proxy } = await import("@/proxy")

    const response = await proxy(new NextRequest("https://axsys.test/"))

    expect(response.headers.get("content-security-policy")).toContain(
      "'nonce-223e4567e89b42d3a456426614174000'",
    )
    expect(response.headers.get("cache-control")).toBeNull()
    expect(response.headers.get("vary")).toBeNull()
  })

  it.each([
    "/app",
    "/app/dashboard",
    "/platform",
    "/api/auth/me",
    "/api/profile/theme",
    "/auth/callback",
  ])(
    "forces the complete no-store posture on protected path %s",
    async (pathname) => {
      stubPublicEnv()
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
        "323e4567-e89b-42d3-a456-426614174000",
      )
      updateSupabaseSessionMock.mockImplementation(
        async (_request: NextRequest, headers: Headers) =>
          NextResponse.next({ request: { headers } }),
      )
      const { proxy } = await import("@/proxy")

      const response = await proxy(
        new NextRequest(`https://axsys.test${pathname}`),
      )

      for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
        expect(response.headers.get(name)).toBe(value)
      }
    },
  )

  it("uses the Next 16 src proxy matcher and excludes static image assets", async () => {
    const { config } = await import("@/proxy")

    expect(config).toEqual({
      matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      ],
    })
  })
})
