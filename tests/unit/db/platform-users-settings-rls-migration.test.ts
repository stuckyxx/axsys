import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION_SUFFIX = "_platform_users_settings_rls.sql"

function readRlsMigration(): string {
  const migrationsDirectory = join(process.cwd(), "supabase", "migrations")
  const matches = readdirSync(migrationsDirectory).filter((entry) =>
    entry.endsWith(MIGRATION_SUFFIX),
  )

  expect(matches).toHaveLength(1)
  return readFileSync(join(migrationsDirectory, matches[0]!), "utf8")
}

describe("platform users settings RLS migration", () => {
  it("leaves transaction ownership to the migration runner", () => {
    const migration = readRlsMigration()

    expect(migration).not.toMatch(/^\s*(?:begin|commit)\s*;/gimu)
  })

  it("exposes only SELECT policies and security-invoker safe views", () => {
    const migration = readRlsMigration()

    expect(migration).toContain("create policy file_objects_tenant_select")
    expect(migration).toContain("create policy upload_intents_own_select")
    expect(migration).toContain("create policy company_bank_accounts_tenant_select")
    expect(migration).toContain("create policy company_settings_tenant_select")
    expect(migration).toContain("create policy company_settings_drafts_own_select")
    expect(migration).toContain("with (security_invoker = true)")
    const policyStatements = migration.match(/create\s+policy[\s\S]*?;/giu) ?? []
    expect(policyStatements).toHaveLength(5)
    for (const statement of policyStatements) {
      expect(statement).toMatch(/for\s+select/iu)
      expect(statement).not.toMatch(/for\s+(?:all|insert|update|delete)/iu)
    }
    expect(migration).not.toMatch(/on\s+storage\.objects/iu)
  })

  it("keeps the quota core owner-only and grants only four typed BFF facades", () => {
    const migration = readRlsMigration()

    expect(migration).toContain("private.reserve_upload_capability_core(")
    expect(migration).toContain("private.reserve_image_upload_intent(")
    expect(migration).toContain("private.activate_file_upload_authorization(")
    expect(migration).toContain("private.cancel_unissued_file_reservation(")
    expect(migration).toContain("private.list_company_user_directory(")
    expect(migration).toMatch(
      /revoke execute on function private\.reserve_upload_capability_core\([\s\S]*?from public, anon, authenticated, service_role, axsys_bff/iu,
    )
    expect(migration).not.toMatch(
      /grant execute on function private\.reserve_upload_capability_core/iu,
    )
    expect(migration.match(/grant execute on function private\./giu)).toHaveLength(4)
  })

  it("persists authorization before TUS and never cancels an issued capability", () => {
    const migration = readRlsMigration()

    expect(migration).toContain("upload_authorization_expires_at = v_issued_at + interval '2 hours'")
    expect(migration).toContain(
      "cleanup_not_before = v_issued_at + interval '26 hours 15 minutes'",
    )
    expect(migration).toContain("upload_reservation_not_cancellable")
    expect(migration).toMatch(
      /v_intent\.status\s+is distinct from 'reserved'[\s\S]*?v_intent\.authorization_issued_at is not null[\s\S]*?v_intent\.upload_authorization_expires_at is not null[\s\S]*?v_intent\.cleanup_not_before is not null/iu,
    )
    expect(migration).toContain("upload_capability_count_exceeded")
    expect(migration).toContain("upload_capability_bytes_exceeded")
    expect(migration).toContain("104857600")
  })

  it("derives random paths and freezes directory, membership and branding guards", () => {
    const migration = readRlsMigration()

    expect(migration).toContain("v_intent_id := pg_catalog.gen_random_uuid()")
    expect(migration).toContain("v_random_id := pg_catalog.gen_random_uuid()")
    expect(migration).toContain("company_directory_cursor_invalid")
    expect(migration).toMatch(
      /where membership\.company_id = v_company_id\s+and membership\.user_id = p_cursor/iu,
    )
    expect(migration).not.toMatch(
      /where membership\.company_id = v_company_id\s+and membership\.id = p_cursor/iu,
    )
    expect(migration).toContain("AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE")
    expect(migration).toContain("membership_delete_forbidden")
    expect(migration).toContain("last_active_company_admin")
    expect(migration).toContain("AXSYS_INVALID_LETTERHEAD_FILE")
    expect(migration).toContain("AXSYS_INVALID_SIGNATURE_FILE")
  })
})
