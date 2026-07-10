import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("Supabase custom role bootstrap", () => {
  it("does not ask the non-superuser bootstrap role to alter protected PG17 flags", () => {
    const source = readFileSync(resolve("supabase/roles.sql"), "utf8")
    const alterRole = source.match(/alter role axsys_bff[\s\S]*?;/u)?.[0]

    expect(alterRole).toBeDefined()
    expect(alterRole).not.toMatch(/\b(?:nosuperuser|noreplication|nobypassrls)\b/u)
  })

  it("creates protected flags safely and asserts all dangerous attributes fail-closed", () => {
    const source = readFileSync(resolve("supabase/roles.sql"), "utf8")
    const createRole = source.match(/create role axsys_bff[\s\S]*?;/u)?.[0]

    expect(createRole).toMatch(/\bnosuperuser\b/u)
    expect(createRole).toMatch(/\bnoreplication\b/u)
    expect(createRole).toMatch(/\bnobypassrls\b/u)
    expect(source).toContain("role_state.rolsuper")
    expect(source).toContain("role_state.rolreplication")
    expect(source).toContain("role_state.rolbypassrls")
  })

  it("removes PUBLIC schema access and restores usage only to the platform allowlist", () => {
    const source = readFileSync(resolve("supabase/roles.sql"), "utf8")
    const usageGrant = source.match(/grant usage on schema public to ([^;]+);/u)?.[1]

    expect(source).toContain("revoke all privileges on schema public from public;")
    expect(usageGrant?.split(",").map((role) => role.trim()).sort()).toEqual([
      "anon",
      "authenticated",
      "authenticator",
      "service_role",
      "supabase_admin",
    ])
    expect(usageGrant).not.toContain("axsys_bff")
  })
})
