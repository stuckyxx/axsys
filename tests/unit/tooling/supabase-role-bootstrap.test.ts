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

  it("revokes existing and future public object grants from API bearer roles for both owners", () => {
    const rolesSource = readFileSync(resolve("supabase/roles.sql"), "utf8")
    const provisionerSource = readFileSync(
      resolve("scripts/provision-local-env.ts"),
      "utf8",
    )

    for (const objectType of ["tables", "sequences", "functions"] as const) {
      expect(rolesSource).toContain(
        `revoke all privileges on all ${objectType} in schema public from anon, authenticated, service_role;`,
      )
      expect(rolesSource).toMatch(
        new RegExp(
          `alter default privileges for role postgres in schema public\\s+revoke all privileges on ${objectType} from anon, authenticated, service_role;`,
          "u",
        ),
      )
      expect(rolesSource).toMatch(
        new RegExp(
          `alter default privileges for role postgres\\s+revoke all privileges on ${objectType} from anon, authenticated, service_role;`,
          "u",
        ),
      )
      expect(provisionerSource).toMatch(
        new RegExp(
          `alter default privileges for role supabase_admin in schema public\\s+revoke all privileges on ${objectType} from anon, authenticated, service_role;`,
          "u",
        ),
      )
      for (const owner of ["postgres", "supabase_admin"] as const) {
        expect(provisionerSource).toMatch(
          new RegExp(
            `alter default privileges for role ${owner}\\s+revoke all privileges on ${objectType} from anon, authenticated, service_role;`,
            "u",
          ),
        )
      }

      expect(rolesSource).toMatch(
        new RegExp(
          `alter default privileges for role postgres in schema public\\s+revoke all privileges on ${objectType} from public;`,
          "u",
        ),
      )
      expect(rolesSource).toMatch(
        new RegExp(
          `alter default privileges for role postgres\\s+revoke all privileges on ${objectType} from public;`,
          "u",
        ),
      )
      for (const owner of ["postgres", "supabase_admin"] as const) {
        expect(provisionerSource).toMatch(
          new RegExp(
            `alter default privileges for role ${owner} in schema public\\s+revoke all privileges on ${objectType} from public;`,
            "u",
          ),
        )
        expect(provisionerSource).toMatch(
          new RegExp(
            `alter default privileges for role ${owner}\\s+revoke all privileges on ${objectType} from public;`,
            "u",
          ),
        )
      }
    }

    expect(rolesSource).not.toContain("set role supabase_admin")
    expect(provisionerSource).toContain('url.username = "supabase_admin"')
    expect(rolesSource).toMatch(
      /defaults\.defaclnamespace in \(0, 'public'::regnamespace\)[\s\S]*?defaults\.defaclobjtype in \('r', 'S', 'f'\)[\s\S]*?grant_item\.grantee = 0/u,
    )
    expect(provisionerSource).toMatch(
      /defaults\.defaclnamespace in \(0, 'public'::regnamespace\)[\s\S]*?defaults\.defaclobjtype in \('r', 'S', 'f'\)[\s\S]*?grant_item\.grantee = 0/u,
    )
    expect(provisionerSource).toContain("from pg_default_acl")
    expect(provisionerSource).toContain("aclexplode")
    const repeatableHardeningSql = provisionerSource.match(
      /const PUBLIC_PRIVILEGE_HARDENING_SQL = `([\s\S]*?)`/u,
    )?.[1]
    expect(repeatableHardeningSql).toBeDefined()
    for (const objectType of ["tables", "sequences", "functions"] as const) {
      expect(repeatableHardeningSql).toContain(
        `revoke all privileges on all ${objectType} in schema public from public;`,
      )
      expect(repeatableHardeningSql).not.toContain(
        `revoke all privileges on all ${objectType} in schema public from anon, authenticated, service_role;`,
      )
    }
    expect(repeatableHardeningSql).toContain(
      "revoke all privileges on all functions in schema public from axsys_bff;",
    )
    const privateFunctionRevoke = provisionerSource.match(
      /revoke all privileges on all functions in schema private[\s\S]*?;/u,
    )?.[0]
    expect(privateFunctionRevoke).toBeDefined()
    expect(privateFunctionRevoke).toContain("from public;")
    for (const namedRole of [
      "anon",
      "authenticated",
      "service_role",
      "axsys_bff",
    ] as const) {
      expect(privateFunctionRevoke).not.toContain(namedRole)
    }
  })

  it("rejects reverse axsys_bff grants to any non-administrative member", () => {
    const source = readFileSync(resolve("supabase/roles.sql"), "utf8")

    expect(source).toContain(
      "roleid = (select oid from pg_roles where rolname = 'axsys_bff')",
    )
    expect(source).toMatch(/member_role\.rolname not in \('postgres', 'supabase_admin'\)/u)
    expect(source).toContain("unexpected reverse membership")
  })
})
