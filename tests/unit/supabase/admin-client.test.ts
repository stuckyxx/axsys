import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}))

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(24)}`,
  BFF_DATABASE_URL:
    "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
  APP_ORIGIN: "http://127.0.0.1:3000",
  CSRF_SECRET: "c".repeat(32),
  SECURITY_HASH_PEPPER: "p".repeat(32),
  TRUST_PROXY: "false",
} as const

function stubValidEnv(): void {
  for (const [name, value] of Object.entries(VALID_ENV)) vi.stubEnv(name, value)
}

describe("admin Supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("does not evaluate the secret during import and fails only on initialization", async () => {
    stubValidEnv()
    vi.stubEnv("SUPABASE_SECRET_KEY", "")

    const admin = await import("@/lib/supabase/admin")

    expect(createClientMock).not.toHaveBeenCalled()
    expect(() => admin.getAdminSupabase()).toThrow("Invalid server environment")
  })

  it("lazily creates one non-persistent typed client with no-store fetch", async () => {
    stubValidEnv()
    const rawClient = { auth: {}, storage: {}, from: vi.fn() }
    createClientMock.mockReturnValue(rawClient)
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const { getAdminSupabase } = await import("@/lib/supabase/admin")

    expect(createClientMock).not.toHaveBeenCalled()
    expect(getAdminSupabase()).toBe(rawClient)
    expect(getAdminSupabase()).toBe(rawClient)
    expect(createClientMock).toHaveBeenCalledOnce()

    const [url, key, options] = createClientMock.mock.calls[0]
    expect(url).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(VALID_ENV.SUPABASE_SECRET_KEY)
    expect(options.auth).toEqual({
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    })

    await options.global.fetch("https://project.test/rest", {
      cache: "force-cache",
      headers: { "x-test": "preserved" },
    })
    expect(fetchMock).toHaveBeenCalledWith("https://project.test/rest", {
      cache: "no-store",
      headers: { "x-test": "preserved" },
    })
  })

  it("keeps secret access and client construction inside the server-only getter", () => {
    const source = readFileSync(resolve("src/lib/supabase/admin.ts"), "utf8")

    expect(source.trimStart()).toMatch(/^import "server-only"/u)
    expect(source).not.toMatch(/export\s+(?:const|let|var)\s+adminClient/u)
    expect(source.indexOf("export function getAdminSupabase")).toBeLessThan(
      source.indexOf("const publicEnv = getPublicEnv()"),
    )
    expect(source.indexOf("export function getAdminSupabase")).toBeLessThan(
      source.indexOf("const serverEnv = getServerEnv()"),
    )
  })
})
