import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe("platform company creation form source", () => {
  it("keeps credentials memory-only and uses the guarded provisioning route", () => {
    const source = readFileSync(
      resolve("src/modules/companies/ui/company-create-form.tsx"),
      "utf8",
    )

    expect(source).toContain('fetch("/api/auth/csrf"')
    expect(source).toContain('fetch("/api/platform/companies"')
    expect(source).toContain('"idempotency-key"')
    expect(source).toContain('autoComplete="new-password"')
    expect(source).not.toMatch(/localStorage|sessionStorage|getSession/u)
    expect(source).not.toMatch(/companyId\s*:|status\s*:/u)
  })
})
