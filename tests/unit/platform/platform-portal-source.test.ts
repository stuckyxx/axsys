import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = path.join(process.cwd(), "src")
const source = (relative: string) => readFile(path.join(root, relative), "utf8")

describe("Task 9 platform portal boundaries", () => {
  it("keeps every platform page dynamic and protected by the platform context", async () => {
    const pages = await Promise.all([
      source("app/(protected)/platform/page.tsx"),
      source("app/(protected)/platform/empresas/page.tsx"),
      source("app/(protected)/platform/empresas/[companyId]/page.tsx"),
      source("app/(protected)/platform/administradores/page.tsx"),
    ])

    for (const page of pages) {
      expect(page).toContain('export const dynamic = "force-dynamic"')
      expect(page).toContain("requirePlatformContext()")
      expect(page).not.toMatch(/createAdminSupabase|service[_-]?role|unstable_cache/u)
    }
  })

  it("validates the company id before its direct BFF read and returns not found neutrally", async () => {
    const detail = await source(
      "app/(protected)/platform/empresas/[companyId]/page.tsx",
    )

    expect(detail).toContain("z.uuid().safeParse")
    expect(detail).toContain("notFound()")
    expect(detail).toContain("bffDb.getCompanyDetail")
    expect(detail).toContain("actorUserId: context.userId")
    expect(detail).toContain("sessionId: context.sessionId")
  })

  it("continues the company directory with the existing keyset cursor", async () => {
    const [page, list] = await Promise.all([
      source("app/(protected)/platform/empresas/page.tsx"),
      source("modules/platform/ui/company-list.tsx"),
    ])

    expect(page).toContain("cursorCreatedAt: cursor?.createdAt ?? null")
    expect(page).toContain("cursorId: cursor?.id ?? null")
    expect(page).toContain("encodeCursor(result.nextCursor)")
    expect(list).toContain("nextCursor")
    expect(list).toContain("Próxima página")
  })

  it("uses no-store mutations, CAS versions and memory-only secrets", async () => {
    const files = await Promise.all([
      source("modules/platform/ui/company-form.tsx"),
      source("modules/platform/ui/admin-form.tsx"),
      source("modules/platform/ui/bank-account-dialog.tsx"),
      source("modules/platform/ui/platform-mutation.ts"),
    ])
    const joined = files.join("\n")

    expect(joined).toContain('cache: "no-store"')
    expect(joined).toContain("router.refresh()")
    expect(joined).toContain("ReauthenticationDialog")
    expect(joined).toContain('autoComplete="new-password"')
    expect(joined).toContain('autoComplete="off"')
    expect(joined).toContain("version")
    expect(joined).not.toMatch(/localStorage|sessionStorage|indexedDB/u)
  })

  it("retries company provisioning after reauthentication without leaving the password in the form", async () => {
    const create = await source("modules/companies/ui/company-create-form.tsx")

    expect(create).toContain("ReauthenticationDialog")
    expect(create).toContain('code === "REAUTHENTICATION_REQUIRED"')
    expect(create).toContain('passwordInput.value = ""')
    expect(create).toContain("retryPayload")
  })
})
