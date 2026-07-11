import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { cookiesMock, createServerClientMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  createServerClientMock: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: cookiesMock }))
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }))

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
} as const

function stubPublicEnv(): void {
  for (const [name, value] of Object.entries(PUBLIC_ENV)) vi.stubEnv(name, value)
}

describe("server Supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("awaits cookies and creates a fresh request-scoped client", async () => {
    stubPublicEnv()
    const cookieStore = {
      getAll: vi.fn(() => [{ name: "existing", value: "cookie" }]),
      set: vi.fn(),
    }
    cookiesMock.mockResolvedValue(cookieStore)
    createServerClientMock
      .mockReturnValueOnce({ request: 1 })
      .mockReturnValueOnce({ request: 2 })
    const { createServerSupabase } = await import("@/lib/supabase/server")

    await expect(createServerSupabase()).resolves.toEqual({ request: 1 })
    await expect(createServerSupabase()).resolves.toEqual({ request: 2 })
    expect(cookiesMock).toHaveBeenCalledTimes(2)
    expect(createServerClientMock).toHaveBeenCalledTimes(2)

    const [url, key, options] = createServerClientMock.mock.calls[0]
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(options.cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    })
    expect(options.cookies.getAll()).toEqual([{ name: "existing", value: "cookie" }])

    options.cookies.setAll(
      [
        {
          name: "auth",
          value: "new-value",
          options: { httpOnly: false, secure: false, path: "/unsafe" },
        },
      ],
      { "Cache-Control": "private, no-store" },
    )
    expect(cookieStore.set).toHaveBeenCalledWith("auth", "new-value", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    })
  })

  it("tolerates cookie writes rejected by a Server Component", async () => {
    stubPublicEnv()
    const cookieStore = {
      getAll: vi.fn(() => []),
      set: vi.fn(() => {
        throw new Error("Cookies can only be modified in a Server Action")
      }),
    }
    cookiesMock.mockResolvedValue(cookieStore)
    createServerClientMock.mockReturnValue({ request: 1 })
    const { createServerSupabase } = await import("@/lib/supabase/server")

    await createServerSupabase()
    const options = createServerClientMock.mock.calls[0][2]

    expect(() =>
      options.cookies.setAll(
        [{ name: "auth", value: "new", options: {} }],
        {},
      ),
    ).not.toThrow()
  })

  it("is server-only, awaits the async cookie API, and never caches a client", () => {
    const source = readFileSync(resolve("src/lib/supabase/server.ts"), "utf8")

    expect(source.trimStart()).toMatch(/^import "server-only"/u)
    expect(source).toContain("const cookieStore = await cookies()")
    expect(source).not.toMatch(/let\s+(?:server|supabase)Client/u)
    expect(source).not.toContain("SUPABASE_SECRET_KEY")
  })
})
