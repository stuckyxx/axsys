import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const { createServerClientMock, getClaimsMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getClaimsMock: vi.fn(),
}))

vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }))

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
} as const

function stubPublicEnv(): void {
  for (const [name, value] of Object.entries(PUBLIC_ENV)) vi.stubEnv(name, value)
}

describe("Supabase proxy session refresh", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("forwards request headers and mirrors refreshed cookies plus cache headers", async () => {
    stubPublicEnv()
    createServerClientMock.mockImplementation((url, key, options) => {
      void url
      void key
      getClaimsMock.mockImplementationOnce(async () => {
        await options.cookies.setAll(
          [
            {
              name: "sb-auth",
              value: "refreshed",
              options: { httpOnly: false, secure: false, sameSite: "strict" },
            },
          ],
          {
            "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
            Expires: "0",
            Pragma: "no-cache",
          },
        )
        return { data: { claims: { sub: "user" } }, error: null }
      })
      return { auth: { getClaims: getClaimsMock } }
    })
    const { updateSupabaseSession } = await import("@/lib/supabase/proxy")
    const request = new NextRequest("https://axsys.test/app", {
      headers: { cookie: "existing=value" },
    })
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-nonce", "same-nonce")
    requestHeaders.set(
      "Content-Security-Policy",
      "script-src 'nonce-same-nonce'",
    )

    const response = await updateSupabaseSession(request, requestHeaders)

    expect(getClaimsMock).toHaveBeenCalledOnce()
    const [url, key, options] = createServerClientMock.mock.calls[0]
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(options.cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    })
    expect(options.cookies.getAll()).toEqual(
      expect.arrayContaining([{ name: "existing", value: "value" }]),
    )
    expect(request.cookies.get("sb-auth")?.value).toBe("refreshed")
    expect(response.headers.get("set-cookie")).toContain(
      "sb-auth=refreshed; Path=/; Secure; HttpOnly; SameSite=lax",
    )
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    )
    expect(response.headers.get("expires")).toBe("0")
    expect(response.headers.get("pragma")).toBe("no-cache")
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe("same-nonce")
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe("script-src 'nonce-same-nonce'")
  })

  it("uses verified claims for refresh and remains authorization-agnostic", () => {
    const source = readFileSync(resolve("src/lib/supabase/proxy.ts"), "utf8")

    expect(source).toContain("await supabase.auth.getClaims()")
    expect(source).not.toContain(".getSession(")
    expect(source).not.toContain("NextResponse.redirect")
    expect(source).toContain("Object.entries(responseHeaders)")
  })
})
