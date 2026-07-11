import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  bootstrapLocalSuperAdmin,
  formatBootstrapFailure,
  type BootstrapRuntimeFactory,
  type BootstrapRuntime,
} from "../../../scripts/bootstrap-local"

const USER_ID = "10000000-0000-4000-8000-000000000001"
const PASSWORD = "Forte e longa 2026!"

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL: "  Admin.PLATFORM@Example.Test  ",
    AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD: PASSWORD,
    DATABASE_URL:
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "local-test-secret-key",
    ...overrides,
  }
}

function runtime(): BootstrapRuntime {
  return {
    createAuthUser: vi.fn(async () => USER_ID),
    deleteAuthUser: vi.fn(async () => undefined),
    insertPlatformIdentity: vi.fn(async () => undefined),
    validatePassword: vi.fn(async () => undefined),
  }
}

describe("Task 15 local super-admin bootstrap", () => {
  it.each([
    "AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL",
    "AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD",
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ])("fails before side effects when %s is missing", async (missingKey) => {
    const dependencies = runtime()
    const env = environment({ [missingKey]: undefined })

    let caught: unknown
    try {
      await bootstrapLocalSuperAdmin(env, dependencies)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(formatBootstrapFailure(caught)).toBe(
      `Missing required local bootstrap environment: ${missingKey}.\n`,
    )
    expect(dependencies.validatePassword).not.toHaveBeenCalled()
    expect(dependencies.createAuthUser).not.toHaveBeenCalled()
  })

  it("normalizes the email, preserves password bytes and creates explicit identity", async () => {
    const dependencies = runtime()

    await expect(
      bootstrapLocalSuperAdmin(environment(), dependencies),
    ).resolves.toBe(USER_ID)

    expect(dependencies.validatePassword).toHaveBeenCalledWith(PASSWORD)
    expect(dependencies.createAuthUser).toHaveBeenCalledWith({
      email: "admin.platform@example.test",
      password: PASSWORD,
    })
    expect(dependencies.insertPlatformIdentity).toHaveBeenCalledWith({
      databaseUrl:
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      displayName: "Administrador da Plataforma",
      email: "admin.platform@example.test",
      userId: USER_ID,
    })
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled()
  })

  it("binds the default runtime to the same validated environment object", async () => {
    const dependencies = runtime()
    const factory = vi.fn<BootstrapRuntimeFactory>(() => dependencies)
    const networkFetch = vi.fn(async () => {
      throw new Error("unexpected network access")
    })
    vi.stubGlobal("fetch", networkFetch)

    try {
      await expect(
        bootstrapLocalSuperAdmin(environment(), undefined, factory),
      ).resolves.toBe(USER_ID)
      expect(networkFetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }

    expect(factory).toHaveBeenCalledWith({
      secretKey: "local-test-secret-key",
      supabaseUrl: "http://127.0.0.1:54321",
    })
  })

  it.each([
    ["database", "insertPlatformIdentity"],
    ["password policy", "validatePassword"],
  ])("redacts a %s failure", async (_name, failingMethod) => {
    const dependencies = runtime()
    const failing =
      failingMethod === "insertPlatformIdentity"
        ? dependencies.insertPlatformIdentity
        : dependencies.validatePassword
    vi.mocked(failing).mockRejectedValueOnce(new Error(`sensitive ${PASSWORD}`))

    let caught: unknown
    try {
      await bootstrapLocalSuperAdmin(environment(), dependencies)
    } catch (error) {
      caught = error
    }

    const output = formatBootstrapFailure(caught)
    expect(output).toBe("Local super-admin bootstrap failed.\n")
    expect(output).not.toContain(PASSWORD)
  })

  it("deletes the Auth user when identity insertion fails", async () => {
    const dependencies = runtime()
    vi.mocked(dependencies.insertPlatformIdentity).mockRejectedValueOnce(
      new Error("database failure"),
    )

    await expect(
      bootstrapLocalSuperAdmin(environment(), dependencies),
    ).rejects.toThrow("Local super-admin bootstrap failed")
    expect(dependencies.deleteAuthUser).toHaveBeenCalledWith(USER_ID)
  })

  it("still returns a fixed failure after compensation itself fails", async () => {
    const dependencies = runtime()
    vi.mocked(dependencies.insertPlatformIdentity).mockRejectedValueOnce(
      new Error("database failure"),
    )
    vi.mocked(dependencies.deleteAuthUser).mockRejectedValueOnce(
      new Error(`provider leaked ${PASSWORD}`),
    )

    let caught: unknown
    try {
      await bootstrapLocalSuperAdmin(environment(), dependencies)
    } catch (error) {
      caught = error
    }
    expect(formatBootstrapFailure(caught)).toBe(
      "Local super-admin bootstrap failed.\n",
    )
  })

  it.each([
    ["remote database", { DATABASE_URL: "postgresql://postgres:x@db.example.com:5432/postgres" }],
    ["BFF database role", { DATABASE_URL: "postgresql://axsys_bff:x@127.0.0.1:54322/postgres" }],
    ["remote Auth API", { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }],
  ])("rejects a %s before creating Auth state", async (_name, override) => {
    const dependencies = runtime()

    await expect(
      bootstrapLocalSuperAdmin(environment(override), dependencies),
    ).rejects.toThrow("Invalid local bootstrap environment")
    expect(dependencies.createAuthUser).not.toHaveBeenCalled()
  })

  it("keeps the actual persistence transactional and the CLI output UUID-only", () => {
    const source = readFileSync(resolve("scripts/bootstrap-local.ts"), "utf8")

    expect(source).toContain("await sql.begin")
    expect(source).toContain("insert into public.profiles")
    expect(source).toContain("insert into public.platform_roles")
    expect(source).toContain("process.stdout.write(`${userId}\\n`)")
    expect(source).not.toMatch(/console\.(?:log|error)/u)
    expect(source).not.toContain("user_metadata")
  })
})
