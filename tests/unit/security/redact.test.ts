import { Buffer } from "node:buffer"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TEST_FILE_SERVICE_ENV } from "../../helpers/file-service-env"

const VALID_SERVER_ENV = {
  SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(24)}`,
  BFF_DATABASE_URL:
    "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
  APP_ORIGIN: "http://127.0.0.1:3000",
  CSRF_SECRET: "c".repeat(32),
  SECURITY_HASH_PEPPER: "p".repeat(32),
  TRUST_PROXY: "false",
  ...TEST_FILE_SERVICE_ENV,
} as const

function stubServerEnv(): void {
  for (const [name, value] of Object.entries(VALID_SERVER_ENV)) {
    vi.stubEnv(name, value)
  }
}

describe("security redaction", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("loads without evaluating server secrets and hashes normalized values lazily", async () => {
    vi.stubEnv("SECURITY_HASH_PEPPER", "")
    const redaction = await import("@/lib/security/redact")

    expect(() => redaction.hashSensitive("account-1")).toThrow(
      "Invalid server environment",
    )

    stubServerEnv()
    expect(redaction.hashSensitive("  Account-1 ")).toBe(
      redaction.hashSensitive("account-1"),
    )
    expect(redaction.hashSensitive("account-1")).toMatch(/^[0-9a-f]{64}$/u)
  })

  it("redacts nested case-insensitive sensitive keys and array entries", async () => {
    stubServerEnv()
    const { redactRecord } = await import("@/lib/security/redact")
    const input = {
      safe: "visible",
      nested: {
        PaSsWoRd: "never-visible",
        items: [{ Authorization: "Bearer raw" }, { ok: true }],
      },
    }

    const result = redactRecord(input)

    expect(result).toEqual({
      safe: "visible",
      nested: {
        PaSsWoRd: "[REDACTED]",
        items: [{ Authorization: "[REDACTED]" }, { ok: true }],
      },
    })
    expect(JSON.stringify(result)).not.toContain("never-visible")
    expect(JSON.stringify(result)).not.toContain("Bearer raw")
  })

  it.each([
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_value",
    `sb_secret_${"x".repeat(32)}`,
    `sb_service_role_${"x".repeat(32)}`,
    `sb_publishable_${"x".repeat(32)}`,
    `t_${"x".repeat(43)}`,
    "https://project.supabase.co/storage/v1/object/sign/private/file.pdf?token=raw-token",
    "https://s3.example.test/private/file.pdf?X-Amz-Signature=raw-signature",
    "postgresql://axsys_bff:password@127.0.0.1:54322/postgres",
    "postgresql://db.internal.example/axsys?sslmode=require",
    "123.456.789-01",
    "12345678901",
    "https://axsys.test/public/certidoes/acme-public-slug",
    "/api/public/certificates/acme-public-slug/download/version-public-id",
  ])("redacts a sensitive scalar value: %s", async (sensitive) => {
    stubServerEnv()
    const { redactRecord } = await import("@/lib/security/redact")

    expect(redactRecord({ value: sensitive })).toEqual({ value: "[REDACTED]" })
  })

  it.each([
    "bankAccount",
    "bank_branch",
    "fileBytes",
    "modelOutput",
    "publicCertificateToken",
    "publicDocumentPath",
    "cpf",
    "cookie",
  ])("redacts the full value behind sensitive key %s", async (key) => {
    stubServerEnv()
    const { redactRecord } = await import("@/lib/security/redact")

    expect(redactRecord({ [key]: { deeply: ["raw-value"] } })).toEqual({
      [key]: "[REDACTED]",
    })
  })

  it("bounds cycles, depth, arrays, keys, strings, and the global node budget", async () => {
    stubServerEnv()
    const { redactRecord } = await import("@/lib/security/redact")
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let index = 0; index < 8; index += 1) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }
    const manyKeys = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`field${index}`, index]),
    )
    const manyNodes = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `group${index}`,
        Array.from({ length: 25 }, (__, item) => `${index}-${item}`),
      ]),
    )

    const result = redactRecord({
      cyclic,
      deep,
      array: Array.from({ length: 30 }, (_, index) => index),
      manyFields: manyKeys,
      long: "x".repeat(600),
      manyNodes,
    })
    const serialized = JSON.stringify(result)

    expect(serialized).toContain("[CYCLE]")
    expect(serialized).toContain("[TRUNCATED]")
    expect((result.array as unknown[])).toHaveLength(25)
    expect(Object.keys(result.manyFields as object)).toHaveLength(50)
    expect(result.long).toBe(`${"x".repeat(512)}…`)
  })

  it("always returns canonical JSON below the 16 KiB UTF-8 ceiling", async () => {
    stubServerEnv()
    const { redactRecord } = await import("@/lib/security/redact")
    const result = redactRecord(
      Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [
          `safe${index}`,
          "🚀".repeat(512),
        ]),
      ),
    )
    const serialized = JSON.stringify(result)

    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(16_384)
    expect(result).toEqual({ _redacted: "[TRUNCATED]" })
  })
})
