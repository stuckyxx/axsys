import { execFileSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildLocalEnvironment,
  formatProvisioningFailure,
  parseEnv,
  parseSupabaseStatus,
  provisionLocalEnvironment,
  readPrivateEnvFile,
  runProvisioningCli,
  stagePrivateEnvFile,
  validateLocalDatabaseUrl,
  writePrivateEnvFile,
  type ProvisionRuntime,
} from "../../../scripts/provision-local-env"

const temporaryDirectories: string[] = []

function parseWithNextEnvironment(contents: string, keys: readonly string[]) {
  const source = [
    "const { processEnv } = require('@next/env')",
    "for (const key of JSON.parse(process.argv[1])) delete process.env[key]",
    "const [, parsed] = processEnv([{ path: '.env.local', contents: require('node:fs').readFileSync(0, 'utf8'), env: {} }], process.cwd(), console, true)",
    "process.stdout.write(JSON.stringify(parsed))",
  ].join(";")
  return JSON.parse(
    execFileSync(process.execPath, ["-e", source, JSON.stringify(keys)], {
      encoding: "utf8",
      input: contents,
    }),
  ) as Record<string, string>
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("local environment provisioner", () => {
  const bankEncryptionKey = Buffer.alloc(32, 1).toString("base64")
  const piiEncryptionKey = Buffer.alloc(32, 2).toString("base64")
  const validStatus = [
    "API_URL=http://127.0.0.1:54321",
    `PUBLISHABLE_KEY=sb_publishable_${"p".repeat(20)}`,
    `SECRET_KEY=sb_secret_${"s".repeat(24)}`,
    "DB_URL=postgresql://postgres:admin-local@127.0.0.1:54322/postgres",
  ].join("\n")

  function createRuntime(overrides: Partial<ProvisionRuntime> = {}): ProvisionRuntime {
    return {
      getStatusText: () => validStatus,
      generateSecret: () => "n".repeat(43),
      generateEncryptionKey: () => bankEncryptionKey,
      readEnvironment: () => ({ exists: false, contents: "" }),
      stageEnvironment: () => ({
        commit: () => {},
        discard: () => {},
      }),
      hardenPublicPrivileges: async () => {},
      setBffPassword: async (_databaseUrl, _password, onApplied) => {
        onApplied()
      },
      ...overrides,
    }
  }

  it("parses quoted status values without truncating embedded equals signs", () => {
    expect(
      parseEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY="header.payload=tail"\n'),
    ).toEqual({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "header.payload=tail",
    })
  })

  it("accepts publishable and secret keys with legacy fallbacks", () => {
    const modern = parseSupabaseStatus(
      [
        "API_URL=http://127.0.0.1:54321",
        `PUBLISHABLE_KEY=sb_publishable_${"p".repeat(20)}`,
        `SECRET_KEY=sb_secret_${"s".repeat(24)}`,
        "DB_URL=postgresql://postgres:local@127.0.0.1:54322/postgres",
      ].join("\n"),
    )
    const legacy = parseSupabaseStatus(
      [
        "API_URL=http://127.0.0.1:54321",
        `ANON_KEY=${"a".repeat(24)}`,
        `SERVICE_ROLE_KEY=${"r".repeat(24)}`,
        "DB_URL=postgresql://postgres:local@127.0.0.1:54322/postgres",
      ].join("\n"),
    )

    expect(modern.publishableKey).toMatch(/^sb_publishable_/u)
    expect(modern.secretKey).toMatch(/^sb_secret_/u)
    expect(legacy.publishableKey).toHaveLength(24)
    expect(legacy.secretKey).toHaveLength(24)
  })

  it("rejects incomplete status output with one safe error", () => {
    expect(() => parseSupabaseStatus("API_URL=http://127.0.0.1:54321")).toThrow(
      "Supabase status did not return required local credentials",
    )
  })

  it("overwrites canonical runtime values while preserving secrets and every unknown key", () => {
    const existingText = [
      "NEXT_PUBLIC_SUPABASE_URL=http://old.invalid",
      `CSRF_SECRET=${"c".repeat(43)}`,
      `SECURITY_HASH_PEPPER=${"p".repeat(43)}`,
      `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=${bankEncryptionKey}`,
      `PII_ENCRYPTION_KEY_V1_BASE64=${piiEncryptionKey}`,
      "AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL=owner@example.test",
      "AXSYS_E2E_COMPANY_A_EMAIL=company-a@example.test",
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=provider-placeholder",
      "GEMINI_API_KEY=future-provider-secret # keep this local comment",
      "FUTURE_SINGLE='literal\\nvalue'",
      'FUTURE_MULTILINE="line one\nline two"',
      "FUTURE_FLAG=kept",
    ].join("\n")

    const output = buildLocalEnvironment({
      existingText,
      canonical: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"n".repeat(20)}`,
        SUPABASE_SECRET_KEY: `sb_secret_${"n".repeat(24)}`,
        DATABASE_URL: "postgresql://postgres:local@127.0.0.1:54322/postgres",
        BFF_DATABASE_URL: "postgresql://axsys_bff:local@127.0.0.1:54322/postgres",
        APP_ORIGIN: "http://127.0.0.1:3000",
        TRUST_PROXY: "false",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: "3310",
        SUPABASE_STORAGE_TUS_ENDPOINT:
          "http://127.0.0.1:54321/storage/v1/upload/resumable",
      },
      generateSecret: () => {
        throw new Error("existing secrets must be reused")
      },
      generateEncryptionKey: () => {
        throw new Error("existing encryption keys must be reused")
      },
    })
    const parsed = parseEnv(output)

    expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321")
    expect(parsed.CSRF_SECRET).toBe("c".repeat(43))
    expect(parsed.SECURITY_HASH_PEPPER).toBe("p".repeat(43))
    expect(parsed.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64).toBe(bankEncryptionKey)
    expect(parsed.PII_ENCRYPTION_KEY_V1_BASE64).toBe(piiEncryptionKey)
    expect(parsed.AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL).toBe("owner@example.test")
    expect(parsed.AXSYS_E2E_COMPANY_A_EMAIL).toBe("company-a@example.test")
    expect(parsed.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET).toBe("provider-placeholder")
    expect(parsed.GEMINI_API_KEY).toBe("future-provider-secret")
    expect(parsed.FUTURE_SINGLE).toBe("literal\\nvalue")
    expect(parsed.FUTURE_MULTILINE).toBe("line one\nline two")
    expect(parsed.FUTURE_FLAG).toBe("kept")
    expect(output).toContain(
      "GEMINI_API_KEY=future-provider-secret # keep this local comment",
    )
    expect(output).toContain("FUTURE_SINGLE='literal\\nvalue'")
    expect(output).toContain('FUTURE_MULTILINE="line one\nline two"')
  })

  it("creates missing application secrets independently", () => {
    const generated = ["g".repeat(43), "h".repeat(43)]
    const generatedEncryptionKeys = [bankEncryptionKey, piiEncryptionKey]
    const output = buildLocalEnvironment({
      existingText: "FUTURE_FLAG=kept",
      canonical: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-placeholder-value",
        SUPABASE_SECRET_KEY: "server-secret-placeholder-value",
        DATABASE_URL: "postgresql://postgres:local@127.0.0.1:54322/postgres",
        BFF_DATABASE_URL: "postgresql://axsys_bff:local@127.0.0.1:54322/postgres",
        APP_ORIGIN: "http://127.0.0.1:3000",
        TRUST_PROXY: "false",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: "3310",
        SUPABASE_STORAGE_TUS_ENDPOINT:
          "http://127.0.0.1:54321/storage/v1/upload/resumable",
      },
      generateSecret: () => generated.shift()!,
      generateEncryptionKey: () => generatedEncryptionKeys.shift()!,
    })
    const parsed = parseEnv(output)

    expect(parsed.CSRF_SECRET).toBe("g".repeat(43))
    expect(parsed.SECURITY_HASH_PEPPER).toBe("h".repeat(43))
    expect(parsed.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64).toBe(bankEncryptionKey)
    expect(parsed.PII_ENCRYPTION_KEY_V1_BASE64).toBe(piiEncryptionKey)
  })

  it.each([
    ["blank", "CSRF_SECRET="],
    ["quoted blank", 'CSRF_SECRET=""'],
    [
      "escaped dollar expansion",
      `CSRF_SECRET=${"a".repeat(43)}\\$FUTURE_SECRET`,
    ],
    [
      "valid value followed by a blank duplicate",
      `CSRF_SECRET=${"c".repeat(43)}\nCSRF_SECRET=`,
    ],
  ])(
    "rejects a present %s application secret without rotating it",
    async (_label, csrfAssignment) => {
      const generateSecret = vi.fn()
      const generateEncryptionKey = vi.fn()
      const stageEnvironment = vi.fn()
      const hardenPublicPrivileges = vi.fn()
      const runtime = createRuntime({
        generateSecret,
        generateEncryptionKey,
        readEnvironment: () => ({
          exists: true,
          contents: [
            csrfAssignment,
            `SECURITY_HASH_PEPPER=${"p".repeat(43)}`,
            `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=${bankEncryptionKey}`,
            `PII_ENCRYPTION_KEY_V1_BASE64=${piiEncryptionKey}`,
          ].join("\n"),
        }),
        stageEnvironment,
        hardenPublicPrivileges,
      })

      await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
        new Error("Local environment provisioning failed"),
      )
      expect(generateSecret).toHaveBeenCalledTimes(1)
      expect(generateEncryptionKey).not.toHaveBeenCalled()
      expect(stageEnvironment).not.toHaveBeenCalled()
      expect(hardenPublicPrivileges).not.toHaveBeenCalled()
    },
  )

  it("rejects malformed generated application material before encryption or DB work", async () => {
    const generateSecret = vi
      .fn()
      .mockReturnValueOnce("b".repeat(43))
      .mockReturnValueOnce("not-canonical")
    const generateEncryptionKey = vi.fn()
    const stageEnvironment = vi.fn()
    const hardenPublicPrivileges = vi.fn()
    const runtime = createRuntime({
      generateSecret,
      generateEncryptionKey,
      stageEnvironment,
      hardenPublicPrivileges,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(generateSecret).toHaveBeenCalledTimes(2)
    expect(generateEncryptionKey).not.toHaveBeenCalled()
    expect(stageEnvironment).not.toHaveBeenCalled()
    expect(hardenPublicPrivileges).not.toHaveBeenCalled()
  })

  it("writes fixed local file endpoints and generates both encryption keys once", async () => {
    const generatedKeys = [bankEncryptionKey, piiEncryptionKey]
    const generateEncryptionKey = vi.fn(() => generatedKeys.shift()!)
    let stagedContents = ""
    const runtime = createRuntime({
      generateEncryptionKey,
      stageEnvironment: (_path, contents) => {
        stagedContents = contents
        return { commit: () => {}, discard: () => {} }
      },
    })

    await provisionLocalEnvironment(runtime)

    const parsed = parseEnv(stagedContents)
    expect(parsed.CLAMAV_HOST).toBe("127.0.0.1")
    expect(parsed.CLAMAV_PORT).toBe("3310")
    expect(parsed.SUPABASE_STORAGE_TUS_ENDPOINT).toBe(
      "http://127.0.0.1:54321/storage/v1/upload/resumable",
    )
    expect(parsed.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64).toBe(bankEncryptionKey)
    expect(parsed.PII_ENCRYPTION_KEY_V1_BASE64).toBe(piiEncryptionKey)
    expect(generateEncryptionKey).toHaveBeenCalledTimes(2)
  })

  it("fails safely before staging when generated encryption material is malformed", async () => {
    const stageEnvironment = vi.fn()
    const hardenPublicPrivileges = vi.fn()
    const runtime = createRuntime({
      generateEncryptionKey: () => "not-a-32-byte-base64-key",
      stageEnvironment,
      hardenPublicPrivileges,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(stageEnvironment).not.toHaveBeenCalled()
    expect(hardenPublicPrivileges).not.toHaveBeenCalled()
  })

  it("rejects a malformed existing encryption key without replacing it or touching DB", async () => {
    const stageEnvironment = vi.fn()
    const hardenPublicPrivileges = vi.fn()
    const generateEncryptionKey = vi.fn()
    const runtime = createRuntime({
      generateEncryptionKey,
      readEnvironment: () => ({
        exists: true,
        contents: [
          "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=malformed-existing-key",
          `PII_ENCRYPTION_KEY_V1_BASE64=${piiEncryptionKey}`,
        ].join("\n"),
      }),
      stageEnvironment,
      hardenPublicPrivileges,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(generateEncryptionKey).not.toHaveBeenCalled()
    expect(stageEnvironment).not.toHaveBeenCalled()
    expect(hardenPublicPrivileges).not.toHaveBeenCalled()
  })

  it.each([
    ["empty equals", "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64="],
    ["empty colon", "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64: "],
    ["quoted empty", 'BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=""'],
    [
      "valid value followed by an empty duplicate",
      `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=${bankEncryptionKey}\nBANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=`,
    ],
  ])(
    "fails closed for a present %s encryption key instead of rotating it",
    async (_label, bankAssignment) => {
      const stageEnvironment = vi.fn()
      const hardenPublicPrivileges = vi.fn()
      const generateEncryptionKey = vi.fn()
      const runtime = createRuntime({
        generateEncryptionKey,
        readEnvironment: () => ({
          exists: true,
          contents: [
            bankAssignment,
            `PII_ENCRYPTION_KEY_V1_BASE64=${piiEncryptionKey}`,
          ].join("\n"),
        }),
        stageEnvironment,
        hardenPublicPrivileges,
      })

      await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
        new Error("Local environment provisioning failed"),
      )
      expect(generateEncryptionKey).not.toHaveBeenCalled()
      expect(stageEnvironment).not.toHaveBeenCalled()
      expect(hardenPublicPrivileges).not.toHaveBeenCalled()
    },
  )

  it("keeps both generated encryption keys byte-identical across a real rerun", async () => {
    let environment = "GEMINI_API_KEY=future-secret # preserve\n"
    const generatedKeys = [bankEncryptionKey, piiEncryptionKey]
    const generateEncryptionKey = vi.fn(() => generatedKeys.shift()!)
    const runtime = createRuntime({
      generateEncryptionKey,
      readEnvironment: () => ({
        exists: environment.length > 0,
        contents: environment,
      }),
      stageEnvironment: (_path, contents) => ({
        commit: () => {
          environment = contents
        },
        discard: () => {},
      }),
    })

    await provisionLocalEnvironment(runtime)
    const first = parseEnv(environment)
    const firstOutput = environment
    await provisionLocalEnvironment(runtime)
    const second = parseEnv(environment)

    expect(generateEncryptionKey).toHaveBeenCalledTimes(2)
    expect(second.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64).toBe(
      first.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64,
    )
    expect(second.PII_ENCRYPTION_KEY_V1_BASE64).toBe(
      first.PII_ENCRYPTION_KEY_V1_BASE64,
    )
    expect(second.GEMINI_API_KEY).toBe("future-secret")
    expect(environment).toContain("GEMINI_API_KEY=future-secret # preserve")
    expect(environment).toBe(firstOutput)
    expect(environment.split("\n")).toHaveLength(firstOutput.split("\n").length)
  })

  it("removes BOM and colon-style owned values with parity against Next's loader", () => {
    const existing = [
      "\uFEFFCLAMAV_HOST: scanner.invalid",
      "APP_ORIGIN: https://stale.example.test",
      `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64: ${bankEncryptionKey}`,
      `PII_ENCRYPTION_KEY_V1_BASE64: ${piiEncryptionKey}`,
      "FUTURE_COLON: preserved-value",
    ].join("\n")
    const output = buildLocalEnvironment({
      existingText: existing,
      canonical: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"n".repeat(20)}`,
        SUPABASE_SECRET_KEY: `sb_secret_${"n".repeat(24)}`,
        DATABASE_URL: "postgresql://postgres:local@127.0.0.1:54322/postgres",
        BFF_DATABASE_URL: "postgresql://axsys_bff:local@127.0.0.1:54322/postgres",
        APP_ORIGIN: "http://127.0.0.1:3000",
        TRUST_PROXY: "false",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: "3310",
        SUPABASE_STORAGE_TUS_ENDPOINT:
          "http://127.0.0.1:54321/storage/v1/upload/resumable",
      },
      generateSecret: () => "n".repeat(43),
      generateEncryptionKey: () => {
        throw new Error("colon-style existing keys must be reused")
      },
    })
    const nextParsed = parseWithNextEnvironment(output, [
      "CLAMAV_HOST",
      "APP_ORIGIN",
      "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64",
      "PII_ENCRYPTION_KEY_V1_BASE64",
      "FUTURE_COLON",
    ])

    expect(nextParsed.CLAMAV_HOST).toBe("127.0.0.1")
    expect(nextParsed.APP_ORIGIN).toBe("http://127.0.0.1:3000")
    expect(nextParsed.BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64).toBe(
      bankEncryptionKey,
    )
    expect(nextParsed.PII_ENCRYPTION_KEY_V1_BASE64).toBe(piiEncryptionKey)
    expect(nextParsed.FUTURE_COLON).toBe("preserved-value")
    expect(output).not.toContain("scanner.invalid")
    expect(output).not.toContain("stale.example.test")
  })

  it("forces mode 0600 even when the destination already exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "axsys-env-"))
    temporaryDirectories.push(directory)
    const path = join(directory, ".env.local")
    writeFileSync(path, "OLD=value\n", { mode: 0o644 })
    chmodSync(path, 0o644)

    writePrivateEnvFile(path, "NEW=value\n")

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, "utf8")).toBe("NEW=value\n")
  })

  it.each([
    "https://postgres:admin-local@127.0.0.1:54322/postgres",
    "postgres-evil://postgres:admin-local@127.0.0.1:54322/postgres",
    "postgresql://other:admin-local@127.0.0.1:54322/postgres",
    "postgresql://postgres:admin-local@192.0.2.1:54322/postgres",
    "postgresql://postgres:admin-local@127.0.0.1:5432/postgres",
    "postgresql://postgres:admin-local@127.0.0.1:54322/other",
    "postgresql://postgres:admin-local@127.0.0.1:54322/postgres?sslmode=disable",
    "postgresql://postgres:admin-local@127.0.0.1:54322/postgres#fragment",
  ])("rejects an unsafe DB_URL before disk staging or database connection: %s", async (databaseUrl) => {
    const stageEnvironment = vi.fn()
    const hardenPublicPrivileges = vi.fn()
    const setBffPassword = vi.fn()
    const runtime = createRuntime({
      getStatusText: () => validStatus.replace(
        "postgresql://postgres:admin-local@127.0.0.1:54322/postgres",
        databaseUrl,
      ),
      stageEnvironment,
      hardenPublicPrivileges,
      setBffPassword,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toThrow(
      "Local environment provisioning failed",
    )
    expect(stageEnvironment).not.toHaveBeenCalled()
    expect(hardenPublicPrivileges).not.toHaveBeenCalled()
    expect(setBffPassword).not.toHaveBeenCalled()
  })

  it.each([
    "postgresql://postgres:admin-local@127.0.0.1:54322/postgres",
    "postgres://postgres:admin-local@localhost:54322/postgres",
    "postgresql://postgres:admin-local@[::1]:54322/postgres",
  ])("accepts only the canonical local admin shape: %s", (databaseUrl) => {
    expect(validateLocalDatabaseUrl(databaseUrl).toString()).toBe(databaseUrl)
  })

  it("stages and syncs the environment before rotating the BFF password", async () => {
    const events: string[] = []
    const runtime = createRuntime({
      readEnvironment: () => {
        events.push("read")
        return { exists: false, contents: "" }
      },
      stageEnvironment: () => {
        events.push("stage")
        return {
          commit: () => events.push("rename-and-directory-fsync"),
          discard: () => events.push("discard"),
        }
      },
      hardenPublicPrivileges: async (databaseUrl) => {
        events.push(`harden:${new URL(databaseUrl).username}`)
      },
      setBffPassword: async (_databaseUrl, _password, onApplied) => {
        events.push("rotate")
        onApplied()
      },
    })

    await provisionLocalEnvironment(runtime)

    expect(events).toEqual([
      "read",
      "stage",
      "harden:supabase_admin",
      "rotate",
      "rename-and-directory-fsync",
    ])
  })

  it("does not connect when staging fails on a disk write", async () => {
    const hardenPublicPrivileges = vi.fn()
    const setBffPassword = vi.fn()
    const runtime = createRuntime({
      stageEnvironment: () => {
        throw Object.assign(new Error("disk full with sensitive contents"), {
          code: "ENOSPC",
        })
      },
      hardenPublicPrivileges,
      setBffPassword,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(hardenPublicPrivileges).not.toHaveBeenCalled()
    expect(setBffPassword).not.toHaveBeenCalled()
  })

  it("discards the staged env and never rotates a password when ACL hardening fails", async () => {
    const discard = vi.fn()
    const setBffPassword = vi.fn()
    const runtime = createRuntime({
      stageEnvironment: () => ({ commit: () => {}, discard }),
      hardenPublicPrivileges: async () => {
        throw new Error("catalog assertion failed with sensitive details")
      },
      setBffPassword,
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(setBffPassword).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledOnce()
  })

  it("rolls back the prior validated password and preserves the old env on rename failure", async () => {
    const oldPassword = "o".repeat(43)
    const oldContents = [
      `BFF_DATABASE_URL=postgresql://axsys_bff:${oldPassword}@127.0.0.1:54322/postgres`,
      "KEEP=old",
    ].join("\n")
    const environmentContents = oldContents
    const passwords: Array<string | null> = []
    const discard = vi.fn()
    const runtime = createRuntime({
      readEnvironment: () => ({ exists: true, contents: environmentContents }),
      stageEnvironment: () => ({
        commit: () => {
          throw Object.assign(new Error("rename failed"), { code: "EIO" })
        },
        discard,
      }),
      setBffPassword: async (_databaseUrl, password, onApplied) => {
        passwords.push(password)
        onApplied()
      },
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )

    expect(passwords).toHaveLength(2)
    expect(passwords[0]).toMatch(BASE64URL_SECRET)
    expect(passwords[1]).toBe(oldPassword)
    expect(environmentContents).toBe(oldContents)
    expect(discard).toHaveBeenCalledOnce()
  })

  it("restores the old env and password after rename succeeds but directory fsync fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "axsys-env-"))
    temporaryDirectories.push(directory)
    const path = join(directory, ".env.local")
    const oldPassword = "f".repeat(43)
    const oldContents =
      `BFF_DATABASE_URL=postgresql://axsys_bff:${oldPassword}@127.0.0.1:54322/postgres\n`
    writeFileSync(path, oldContents, { mode: 0o600 })
    const passwords: Array<string | null> = []
    const runtime = createRuntime({
      readEnvironment: () => readPrivateEnvFile(path),
      stageEnvironment: (_ignoredPath, contents, existing) =>
        stagePrivateEnvFile(path, contents, existing, () => {
          throw Object.assign(new Error("directory fsync failed"), { code: "EIO" })
        }),
      setBffPassword: async (_databaseUrl, password, onApplied) => {
        passwords.push(password)
        onApplied()
      },
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(readFileSync(path, "utf8")).toBe(oldContents)
    expect(passwords).toEqual(["n".repeat(43), oldPassword])
  })

  it("rolls back when a post-query connection failure occurs before rename", async () => {
    const oldPassword = "p".repeat(43)
    const passwords: Array<string | null> = []
    const commit = vi.fn()
    const discard = vi.fn()
    const runtime = createRuntime({
      readEnvironment: () => ({
        exists: true,
        contents:
          `BFF_DATABASE_URL=postgresql://axsys_bff:${oldPassword}@127.0.0.1:54322/postgres\n`,
      }),
      stageEnvironment: () => ({ commit, discard }),
      setBffPassword: async (_databaseUrl, password, onApplied) => {
        passwords.push(password)
        onApplied()
        if (password !== oldPassword) throw new Error("connection close failed")
      },
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toEqual(
      new Error("Local environment provisioning failed"),
    )
    expect(passwords).toEqual(["n".repeat(43), oldPassword])
    expect(commit).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledOnce()
  })

  it("removes the BFF password when rollback has no validated prior credential", async () => {
    const passwords: Array<string | null> = []
    const runtime = createRuntime({
      readEnvironment: () => ({
        exists: true,
        contents:
          "BFF_DATABASE_URL=postgresql://axsys_bff:not-valid@127.0.0.1:54322/postgres\n",
      }),
      stageEnvironment: () => ({
        commit: () => {
          throw new Error("rename failed")
        },
        discard: () => {},
      }),
      setBffPassword: async (_databaseUrl, password, onApplied) => {
        passwords.push(password)
        onApplied()
      },
    })

    await expect(provisionLocalEnvironment(runtime)).rejects.toThrow(
      "Local environment provisioning failed",
    )
    expect(passwords.at(-1)).toBeNull()
  })

  it("rejects symlink and non-file destinations without changing their targets", () => {
    const directory = mkdtempSync(join(tmpdir(), "axsys-env-"))
    temporaryDirectories.push(directory)
    const target = join(directory, "actual-env")
    const symlink = join(directory, ".env.local")
    writeFileSync(target, "UNCHANGED=value\n", { mode: 0o600 })
    symlinkSync(target, symlink)

    expect(() => writePrivateEnvFile(symlink, "NEW=value\n")).toThrow()
    expect(readFileSync(target, "utf8")).toBe("UNCHANGED=value\n")

    rmSync(symlink)
    mkdirSync(symlink)
    expect(() => writePrivateEnvFile(symlink, "NEW=value\n")).toThrow()
  })

  it("redacts arbitrary failures", () => {
    const sensitiveFailure = new Error(
      "connection failed for postgresql://user:credential@127.0.0.1:54322/postgres",
    )

    const message = formatProvisioningFailure(sensitiveFailure)

    expect(message).toBe("Local environment provisioning failed.\n")
    expect(message).not.toContain("credential")
  })

  it("writes only fixed redacted CLI messages on success and sensitive failure", async () => {
    const sensitive =
      "postgresql://user:credential@127.0.0.1:54322/postgres?token=raw"
    let stdout = ""
    let stderr = ""
    const failureCode = await runProvisioningCli({
      provision: async () => {
        throw new Error(sensitive)
      },
      writeStderr: (value) => {
        stderr += value
      },
      writeStdout: (value) => {
        stdout += value
      },
    })

    expect(failureCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toBe("Local environment provisioning failed.\n")
    expect(stderr).not.toContain("credential")
    expect(stderr).not.toContain("token")

    stdout = ""
    stderr = ""
    const successCode = await runProvisioningCli({
      provision: async () => {},
      writeStderr: (value) => {
        stderr += value
      },
      writeStdout: (value) => {
        stdout += value
      },
    })

    expect(successCode).toBe(0)
    expect(stdout).toBe("Local environment provisioned without printing secrets.\n")
    expect(stderr).toBe("")
  })
})

const BASE64URL_SECRET = /^[A-Za-z0-9_-]{43}$/u
