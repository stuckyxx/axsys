import { afterEach, describe, expect, it, vi } from "vitest"

describe("publicEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns only browser-safe Supabase values", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `sb_publishable_${"p".repeat(20)}`)
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv("BFF_DATABASE_URL", "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres")

    const { getPublicEnv } = await import("@/lib/env/public")
    const publicEnv = getPublicEnv()

    expect(publicEnv).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
    })
    expect(publicEnv).not.toHaveProperty("SUPABASE_SECRET_KEY")
    expect(publicEnv).not.toHaveProperty("BFF_DATABASE_URL")
  })

  it("rejects an invalid public URL and short key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "short")

    const { getPublicEnv } = await import("@/lib/env/public")

    expect(() => getPublicEnv()).toThrow()
  })
})
