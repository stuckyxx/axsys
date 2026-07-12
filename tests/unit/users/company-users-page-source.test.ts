import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const pagePath = path.join(
  process.cwd(),
  "src/app/(protected)/app/usuarios/page.tsx",
)
const uiPath = path.join(
  process.cwd(),
  "src/modules/users/ui/company-users-page.tsx",
)
const formPath = path.join(process.cwd(), "src/modules/users/ui/user-form.tsx")
const resetPath = path.join(
  process.cwd(),
  "src/modules/users/ui/reset-password-dialog.tsx",
)

describe("company users page security boundaries", () => {
  it("loads the directory through the authenticated BFF and never a privileged client", async () => {
    const source = await readFile(pagePath, "utf8")

    expect(source).toContain("requireCompanyContext()")
    expect(source).toContain("context.role !== \"company_admin\"")
    expect(source).toContain("forbidden()")
    expect(source).not.toContain("redirect(\"/app/dashboard\")")
    expect(source).toContain("bffDb.listCompanyUserDirectory")
    expect(source).toContain("actorUserId: context.userId")
    expect(source).toContain("sessionId: context.sessionId")
    expect(source).not.toMatch(/service[_-]?role/i)
    expect(source).not.toContain("supabase.from(")
  })

  it("bounds and validates user-controlled filters before the BFF call", async () => {
    const source = await readFile(pagePath, "utf8")

    expect(source).toContain("rawQuery.length <= 100")
    expect(source).toContain("UUID.test(rawCursor)")
    expect(source).toContain("limit: 21")
  })

  it("uses membership ids for stable pagination and management actions", async () => {
    const source = await readFile(pagePath, "utf8")

    expect(source).toContain("visibleUsers.at(-1)?.membershipId")
    expect(source).toContain("currentMembershipId={context.membershipId}")
    expect(source).toContain("<CompanyUsersPage")
  })

  it("ships accessible responsive user management without persistent passwords", async () => {
    const [ui, form, reset] = await Promise.all([
      readFile(uiPath, "utf8"),
      readFile(formPath, "utf8"),
      readFile(resetPath, "utf8"),
    ])

    expect(ui).toContain('fetch("/api/company/users?')
    expect(ui).toContain('cache: "no-store"')
    expect(ui).toContain("md:hidden")
    expect(ui).toContain("hidden md:block")
    expect(ui).toContain("VERSION_CONFLICT")
    expect(ui).toContain("currentMembershipId")
    expect(ui).toContain("initialPreviousCursor")
    expect(ui).toContain("ReauthenticationDialog")
    expect(ui).toContain("DialogPrimitive.Content")
    expect(form).toContain('autoComplete="new-password"')
    expect(form).toContain('crypto.randomUUID()')
    expect(form).toContain('"idempotency-key"')
    expect(form).not.toMatch(/localStorage|sessionStorage/u)
    expect(form).toContain("ReauthenticationDialog")
    expect(form).toContain("DialogPrimitive.Content")
    expect(reset).toContain('autoComplete="new-password"')
    expect(reset).toContain("passwordConfirmation")
    expect(reset).not.toMatch(/localStorage|sessionStorage/u)
    expect(reset).toContain("ReauthenticationDialog")
    expect(reset).toContain("DialogPrimitive.Content")
  })
})
