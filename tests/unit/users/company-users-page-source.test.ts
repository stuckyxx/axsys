import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const pagePath = path.join(
  process.cwd(),
  "src/app/(protected)/app/usuarios/page.tsx",
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
})
