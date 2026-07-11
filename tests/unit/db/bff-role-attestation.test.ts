import { afterEach, describe, expect, it, vi } from "vitest"
import { TEST_FILE_SERVICE_ENV } from "../../helpers/file-service-env"

const validEnvironment = {
  SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(24)}`,
  BFF_DATABASE_URL:
    "postgresql://axsys_bff:credential-that-must-not-leak@127.0.0.1:54322/postgres",
  APP_ORIGIN: "http://127.0.0.1:3000",
  CSRF_SECRET: "c".repeat(32),
  SECURITY_HASH_PEPPER: "p".repeat(32),
  TRUST_PROXY: "false",
  ...TEST_FILE_SERVICE_ENV,
}

async function loadFacadeWithCurrentUser(valid: boolean) {
  const end = vi.fn(async () => {})
  const taggedSql = vi.fn(async (strings: TemplateStringsArray) => {
    const statement = strings.join("?")
    if (statement.includes("current_user")) return [{ valid }]
    if (statement.includes("assert_auth_session")) return [{ active: true }]
    throw new Error("unexpected test SQL")
  })
  Object.assign(taggedSql, { end })
  const createClient = vi.fn(() => taggedSql)

  vi.doMock("postgres", () => ({ default: createClient }))
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value)
  }
  const { bffDb } = await import("@/lib/db/bff")
  return { bffDb, createClient, taggedSql, end }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock("postgres")
  vi.resetModules()
})

describe("bffDb runtime role attestation", () => {
  it("attests axsys_bff exactly once before allowing domain methods", async () => {
    const { bffDb, taggedSql } = await loadFacadeWithCurrentUser(true)

    await expect(bffDb.assertAuthSession("session", "user")).resolves.toBe(true)
    await expect(bffDb.assertAuthSession("session", "user")).resolves.toBe(true)

    const statements = taggedSql.mock.calls.map(([strings]) => strings.join("?"))
    expect(statements.filter((statement) => statement.includes("current_user"))).toHaveLength(1)
    expect(statements[0]).toContain("current_user")
  })

  it("closes a mismatched connection and fails generically before a domain query", async () => {
    const { bffDb, taggedSql, end } = await loadFacadeWithCurrentUser(false)

    let thrown: unknown
    try {
      await bffDb.assertAuthSession("session", "user")
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("BFF database unavailable"))
    expect(String(thrown)).not.toContain("credential-that-must-not-leak")
    expect(end).toHaveBeenCalledOnce()
    expect(taggedSql).toHaveBeenCalledOnce()
  })
})
