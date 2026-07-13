import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const source = (relative: string) => readFile(path.join(process.cwd(), relative), "utf8")

describe("company settings source boundaries", () => {
  it("uses only remote drafts and authoritative conflict snapshots", async () => {
    const ui = await source("src/modules/settings/ui/company-settings-form.tsx")
    expect(ui).toContain("/api/company/settings/draft")
    expect(ui).toContain("baseVersion")
    expect(ui).toContain("expectedDraftVersion")
    expect(ui).toContain("Sua edição")
    expect(ui).toContain("Versão atual")
    expect(ui).not.toMatch(/localStorage|sessionStorage/u)
  })

  it("keeps page authorization server-side and assets on the secured upload pipeline", async () => {
    const [page, ui] = await Promise.all([
      source("src/app/(protected)/app/configuracoes/empresa/page.tsx"),
      source("src/modules/settings/ui/company-settings-form.tsx"),
    ])
    expect(page).toContain("requireCompanyContext()")
    expect(page).toContain("companySettingsAccess(context)")
    expect(page).toContain("forbidden()")
    expect(ui).toContain('purpose="company_letterhead"')
    expect(ui).toContain('purpose="company_signature"')
    expect(ui).not.toMatch(/signedUrl|service[_-]?role/iu)
  })
})
