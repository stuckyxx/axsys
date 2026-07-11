import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

const LEGACY_SIGNATURE = btoa("s".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "")

function encodeJwtSegment(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function legacyJwt(role: unknown): string {
  return [
    encodeJwtSegment({ alg: "HS256", typ: "JWT" }),
    encodeJwtSegment({ role }),
    LEGACY_SIGNATURE,
  ].join(".")
}

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

  it("accepts a canonical legacy JWT only when its decoded role is anon", async () => {
    const anonKey = legacyJwt("anon")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", anonKey)

    const { getPublicEnv } = await import("@/lib/env/public")

    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(anonKey)
  })

  it.each([
    `sb_secret_${"s".repeat(24)}`,
    `sb_service_role_${"s".repeat(24)}`,
    legacyJwt("service_role"),
    legacyJwt("authenticated"),
  ])("rejects a server-capable or non-anon credential from the browser: %s", async (key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key)

    const { getPublicEnv } = await import("@/lib/env/public")

    expect(() => getPublicEnv()).toThrow("Invalid public environment")
  })

  it.each([
    `sb_publishable_${"p".repeat(19)}`,
    `sb_publishable_${"p".repeat(129)}`,
    `sb_publishable_${"p".repeat(20)}!`,
    `sb_publishable_${"p".repeat(20)}.extra`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "anon" })}`,
    `${encodeJwtSegment({ alg: "HS256" })}.not-json.${LEGACY_SIGNATURE}`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment(["anon"])}.${LEGACY_SIGNATURE}`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "anon" })}.${"s".repeat(42)}t`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "anon" })}.${"s".repeat(513)}`,
  ])("rejects malformed, non-canonical, or overlong public credentials: %s", async (key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key)

    const { getPublicEnv } = await import("@/lib/env/public")

    expect(() => getPublicEnv()).toThrow("Invalid public environment")
  })

  it("never echoes a rejected credential", async () => {
    const rejectedCredential = `sb_secret_${"r".repeat(24)}`
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      rejectedCredential,
    )

    const { getPublicEnv } = await import("@/lib/env/public")

    let thrown: unknown
    try {
      getPublicEnv()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("Invalid public environment"))
    expect(String(thrown)).not.toContain(rejectedCredential)
  })

  it("routes client-reachable Zod values through one CSP-safe jitless boundary", () => {
    const wrapperPath = resolve("src/lib/validation/zod.ts")
    for (const sourcePath of [
      "src/lib/env/public.ts",
      "src/modules/auth/schemas/auth-schemas.ts",
    ]) {
      const source = readFileSync(resolve(sourcePath), "utf8")
      expect.soft(source).toContain('from "@/lib/validation/zod"')
      expect.soft(source).not.toMatch(/import\s+\{\s*z\s*\}\s+from\s+"zod"/u)
    }

    expect.soft(existsSync(wrapperPath)).toBe(true)
    if (!existsSync(wrapperPath)) return

    const wrapper = readFileSync(wrapperPath, "utf8")
    expect(wrapper).toMatch(/z\.config\(\{\s*jitless:\s*true\s*\}\)/u)
  })
})
