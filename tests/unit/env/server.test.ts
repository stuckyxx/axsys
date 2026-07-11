import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

function stubValidServerEnv(secretKey: string): void {
  vi.stubEnv("SUPABASE_SECRET_KEY", secretKey)
  vi.stubEnv(
    "BFF_DATABASE_URL",
    "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
  )
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
  vi.stubEnv("CSRF_SECRET", "c".repeat(32))
  vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
  vi.stubEnv("TRUST_PROXY", "false")
}

describe("serverEnv", () => {
  beforeEach(() => {
    vi.stubEnv("CLAMAV_HOST", "127.0.0.1")
    vi.stubEnv("CLAMAV_PORT", "3310")
    vi.stubEnv(
      "SUPABASE_STORAGE_TUS_ENDPOINT",
      "http://127.0.0.1:54321/storage/v1/upload/resumable",
    )
    vi.stubEnv("BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64", Buffer.alloc(32, 1).toString("base64"))
    vi.stubEnv("PII_ENCRYPTION_KEY_V1_BASE64", Buffer.alloc(32, 2).toString("base64"))
  })

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
      CLAMAV_HOST: "127.0.0.1",
      CLAMAV_PORT: "3310",
      SUPABASE_STORAGE_TUS_ENDPOINT:
        "http://127.0.0.1:54321/storage/v1/upload/resumable",
      BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64: Buffer.alloc(32, 1).toString("base64"),
      PII_ENCRYPTION_KEY_V1_BASE64: Buffer.alloc(32, 2).toString("base64"),
    })
  })

  it.each([
    ["BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64", Buffer.alloc(31).toString("base64")],
    ["PII_ENCRYPTION_KEY_V1_BASE64", `${Buffer.alloc(32).toString("base64")}!`],
    ["BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64", "not-base64"],
  ])("rejects malformed 32-byte encryption material without echoing %s", async (name, value) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv(
      "BFF_DATABASE_URL",
      "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
    )
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv(name, value)

    const { getServerEnv } = await import("@/lib/env/server")

    let thrown: unknown
    try {
      getServerEnv()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toEqual(new Error("Invalid server environment"))
    expect(String(thrown)).not.toContain(value)
  })

  it.each([
    ["CLAMAV_HOST", "scanner.example.test"],
    ["CLAMAV_HOST", "[::1]"],
    ["CLAMAV_PORT", "0"],
    ["CLAMAV_PORT", "65536"],
    ["SUPABASE_STORAGE_TUS_ENDPOINT", "https://storage.example.test/upload"],
    [
      "SUPABASE_STORAGE_TUS_ENDPOINT",
      "http://127.0.0.1:54321/storage/v1/upload/resumable?token=secret",
    ],
  ])("rejects unsafe local file-service configuration in %s", async (name, value) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv(
      "BFF_DATABASE_URL",
      "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
    )
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv(name, value)

    const { getServerEnv } = await import("@/lib/env/server")

    expect(() => getServerEnv()).toThrow("Invalid server environment")
  })

  it("accepts raw IPv6 for the scanner and bracketed IPv6 in the local TUS URL", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv(
      "BFF_DATABASE_URL",
      "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
    )
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv("CLAMAV_HOST", "::1")
    vi.stubEnv(
      "SUPABASE_STORAGE_TUS_ENDPOINT",
      "http://[::1]:54321/storage/v1/upload/resumable",
    )

    const { getServerEnv } = await import("@/lib/env/server")
    const env = getServerEnv()

    expect(env.CLAMAV_HOST).toBe("::1")
    expect(env.SUPABASE_STORAGE_TUS_ENDPOINT).toBe(
      "http://[::1]:54321/storage/v1/upload/resumable",
    )
  })

  it("accepts explicit private scanner and HTTPS TUS endpoints in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv(
      "BFF_DATABASE_URL",
      "postgresql://axsys_bff:production-only@database.internal:5432/axsys",
    )
    vi.stubEnv("APP_ORIGIN", "https://app.axsys.example")
    vi.stubEnv("CSRF_SECRET", "c".repeat(32))
    vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
    vi.stubEnv("CLAMAV_HOST", "clamav.internal")
    vi.stubEnv("CLAMAV_PORT", "3310")
    vi.stubEnv(
      "SUPABASE_STORAGE_TUS_ENDPOINT",
      "https://storage.axsys.example/storage/v1/upload/resumable",
    )

    const { getServerEnv } = await import("@/lib/env/server")
    const env = getServerEnv()

    expect(env.CLAMAV_HOST).toBe("clamav.internal")
    expect(env.SUPABASE_STORAGE_TUS_ENDPOINT).toBe(
      "https://storage.axsys.example/storage/v1/upload/resumable",
    )
  })

  it.each(["-clamav.internal", "clamav..internal", "clamav_internal"])(
    "rejects a malformed production scanner host: %s",
    async (host) => {
      vi.stubEnv("NODE_ENV", "production")
      vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
      vi.stubEnv(
        "BFF_DATABASE_URL",
        "postgresql://axsys_bff:production-only@database.internal:5432/axsys",
      )
      vi.stubEnv("APP_ORIGIN", "https://app.axsys.example")
      vi.stubEnv("CSRF_SECRET", "c".repeat(32))
      vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
      vi.stubEnv("CLAMAV_HOST", host)
      vi.stubEnv(
        "SUPABASE_STORAGE_TUS_ENDPOINT",
        "https://storage.axsys.example/storage/v1/upload/resumable",
      )

      const { getServerEnv } = await import("@/lib/env/server")

      expect(() => getServerEnv()).toThrow("Invalid server environment")
    },
  )

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
    "https://axsys.test/",
    "https://axsys.test/path",
    "https://axsys.test?next=/private",
    "https://axsys.test#fragment",
    "https://user:password@axsys.test",
    "https://AXSYS.test",
    "https://axsys.test:443",
    "https://áxsys.test",
    "ftp://axsys.test",
  ])("rejects a non-canonical HTTP(S) APP_ORIGIN without echoing it: %s", async (appOrigin) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
    vi.stubEnv(
      "BFF_DATABASE_URL",
      "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
    )
    vi.stubEnv("APP_ORIGIN", appOrigin)
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
    expect(String(thrown)).not.toContain(appOrigin)
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

  it("accepts a canonical legacy JWT only when its decoded role is service_role", async () => {
    const serviceRoleKey = legacyJwt("service_role")
    stubValidServerEnv(serviceRoleKey)

    const { getServerEnv } = await import("@/lib/env/server")

    expect(getServerEnv().SUPABASE_SECRET_KEY).toBe(serviceRoleKey)
  })

  it.each([
    `sb_publishable_${"p".repeat(20)}`,
    `sb_service_role_${"s".repeat(24)}`,
    legacyJwt("anon"),
    legacyJwt("authenticated"),
  ])("rejects a public or non-service-role credential on the server: %s", async (key) => {
    stubValidServerEnv(key)

    const { getServerEnv } = await import("@/lib/env/server")

    expect(() => getServerEnv()).toThrow("Invalid server environment")
  })

  it.each([
    `sb_secret_${"s".repeat(19)}`,
    `sb_secret_${"s".repeat(129)}`,
    `sb_secret_${"s".repeat(20)}!`,
    `sb_secret_${"s".repeat(20)}.extra`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "service_role" })}`,
    `${encodeJwtSegment({ alg: "HS256" })}.not-json.${LEGACY_SIGNATURE}`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment(["service_role"])}.${LEGACY_SIGNATURE}`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "service_role" })}.${"s".repeat(42)}t`,
    `${encodeJwtSegment({ alg: "HS256" })}.${encodeJwtSegment({ role: "service_role" })}.${"s".repeat(513)}`,
  ])("rejects malformed, non-canonical, or overlong server credentials: %s", async (key) => {
    stubValidServerEnv(key)

    const { getServerEnv } = await import("@/lib/env/server")

    expect(() => getServerEnv()).toThrow("Invalid server environment")
  })

  it("never echoes a rejected server credential", async () => {
    const rejectedCredential = `sb_publishable_${"r".repeat(20)}`
    stubValidServerEnv(rejectedCredential)

    const { getServerEnv } = await import("@/lib/env/server")

    let thrown: unknown
    try {
      getServerEnv()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("Invalid server environment"))
    expect(String(thrown)).not.toContain(rejectedCredential)
  })
})
