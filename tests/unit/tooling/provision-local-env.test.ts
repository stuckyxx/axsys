import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildLocalEnvironment,
  formatProvisioningFailure,
  parseEnv,
  parseSupabaseStatus,
  writePrivateEnvFile,
} from "../../../scripts/provision-local-env"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("local environment provisioner", () => {
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

  it("redacts arbitrary failures", () => {
    const sensitiveFailure = new Error(
      "connection failed for postgresql://user:credential@127.0.0.1:54322/postgres",
    )

    const message = formatProvisioningFailure(sensitiveFailure)

    expect(message).toBe("Local environment provisioning failed.\n")
    expect(message).not.toContain("credential")
  })
})
