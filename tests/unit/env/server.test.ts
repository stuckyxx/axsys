import { afterEach, describe, expect, it, vi } from "vitest"

describe("serverEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("rejects startup without BFF_DATABASE_URL and server secrets", async () => {
    vi.stubEnv("BFF_DATABASE_URL", "")
    vi.stubEnv("SUPABASE_SECRET_KEY", "")

    const { getServerEnv } = await import("@/lib/env/server")

    expect(() => getServerEnv()).toThrow("Invalid server environment")
  })

  it("returns validated server-only values and defaults TRUST_PROXY to false", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv("BFF_DATABASE_URL", "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres")
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv("TRUST_PROXY", undefined)

    const { getServerEnv } = await import("@/lib/env/server")

    expect(getServerEnv()).toEqual({
      SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(24)}`,
      BFF_DATABASE_URL: "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
      APP_ORIGIN: "http://127.0.0.1:3000",
      CSRF_SECRET: "c".repeat(32),
      SECURITY_HASH_PEPPER: "p".repeat(32),
      TRUST_PROXY: "false",
    })
  })

  it("uses one generic error that never contains a rejected secret", async () => {
    const rejectedSecret = `sb_secret_${"r".repeat(24)}`
    vi.stubEnv("SUPABASE_SECRET_KEY", rejectedSecret)
    vi.stubEnv("BFF_DATABASE_URL", "https://not-a-postgres-connection.invalid")
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv("TRUST_PROXY", "false")

    const { getServerEnv } = await import("@/lib/env/server")

    let thrown: unknown
    try {
      getServerEnv()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("Invalid server environment"))
    expect(String(thrown)).not.toContain(rejectedSecret)
  })

  it.each([
    "postgres-evil://axsys_bff:local-only@127.0.0.1:54322/postgres",
    "postgresqlx://axsys_bff:local-only@127.0.0.1:54322/postgres",
    "postgresql://postgres:local-only@127.0.0.1:54322/postgres",
    "postgres://service_role:local-only@127.0.0.1:54322/postgres",
  ])("rejects a non-BFF database identity without echoing the URL: %s", async (databaseUrl) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv("BFF_DATABASE_URL", databaseUrl)
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv("TRUST_PROXY", "false")

    const { getServerEnv } = await import("@/lib/env/server")

    let thrown: unknown
    try {
      getServerEnv()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toEqual(new Error("Invalid server environment"))
    expect(String(thrown)).not.toContain(databaseUrl)
  })
})
