import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION_SUFFIX = "_platform_users_settings_schema.sql"

function readSchemaMigration(): string {
  const migrationsDirectory = join(process.cwd(), "supabase", "migrations")
  const matches = readdirSync(migrationsDirectory).filter((entry) =>
    entry.endsWith(MIGRATION_SUFFIX),
  )

  expect(matches).toHaveLength(1)
  return readFileSync(join(migrationsDirectory, matches[0]!), "utf8")
}

describe("platform users settings schema migration", () => {
  it("installs the quota trigger before backfill and attests that no company was missed", () => {
    const migration = readSchemaMigration()
    const triggerOffset = migration.indexOf("create trigger companies_initialize_storage_usage")
    const backfillOffset = migration.lastIndexOf(
      "insert into private.company_storage_usage(company_id)",
    )

    expect(triggerOffset).toBeGreaterThan(-1)
    expect(backfillOffset).toBeGreaterThan(triggerOffset)
    expect(migration).toContain("AXSYS_COMPANY_STORAGE_USAGE_BACKFILL_INCOMPLETE")
  })

  it("uses the cron schema boundary and leaves ordinary pg_catalog access untouched", () => {
    const migration = readSchemaMigration()

    expect(migration).toContain("revoke all on schema cron")
    expect(migration).toContain("AXSYS_PG_CRON_SCHEMA_ACL_INVALID")
    expect(migration).toContain("revoke all on all sequences in schema cron")
    expect(migration).toContain("AXSYS_PG_CRON_SEQUENCE_ACL_INVALID")
    expect(migration).not.toMatch(/revoke\s+all\s+on\s+schema\s+pg_catalog/i)
    expect(migration).not.toMatch(/revoke\s+all\s+on\s+all\s+functions\s+in\s+schema\s+pg_catalog/i)
  })
})
