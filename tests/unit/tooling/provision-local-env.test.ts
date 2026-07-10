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
  stagePrivateEnvFile,
  validateLocalDatabaseUrl,
  writePrivateEnvFile,
  type ProvisionRuntime,
} from "../../../scripts/provision-local-env"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("local environment provisioner", () => {
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
      `CSRF_SECRET=${"c".repeat(32)}`,
      `SECURITY_HASH_PEPPER=${"p".repeat(32)}`,
      "AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL=owner@example.test",
      "AXSYS_E2E_COMPANY_A_EMAIL=company-a@example.test",
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=provider-placeholder",
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
      },
      generateSecret: () => {
        throw new Error("existing secrets must be reused")
      },
    })
    const parsed = parseEnv(output)

    expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321")
    expect(parsed.CSRF_SECRET).toBe("c".repeat(32))
    expect(parsed.SECURITY_HASH_PEPPER).toBe("p".repeat(32))
    expect(parsed.AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL).toBe("owner@example.test")
    expect(parsed.AXSYS_E2E_COMPANY_A_EMAIL).toBe("company-a@example.test")
    expect(parsed.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET).toBe("provider-placeholder")
    expect(parsed.FUTURE_FLAG).toBe("kept")
  })

  it("creates missing application secrets independently", () => {
    const generated = ["generated-csrf", "generated-pepper"]
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
      },
      generateSecret: () => generated.shift()!,
    })
    const parsed = parseEnv(output)

    expect(parsed.CSRF_SECRET).toBe("generated-csrf")
    expect(parsed.SECURITY_HASH_PEPPER).toBe("generated-pepper")
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
})

const BASE64URL_SECRET = /^[A-Za-z0-9_-]{43}$/u
