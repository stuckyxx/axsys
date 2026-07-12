import { bffDb } from "@/lib/db/bff"
import { z } from "@/lib/validation/zod"
import { requirePlatformContext } from "@/modules/auth/server/guards"
import { CompanyForm } from "@/modules/platform/ui/company-form"
import { CompanyList } from "@/modules/platform/ui/company-list"

export const dynamic = "force-dynamic"

const cursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() }).strict()
function decodeCursor(value: string | null) {
  if (!value || value.length > 500) return null
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))) } catch { return null }
}
function encodeCursor(value: { createdAt: string; id: string } | null) {
  return value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url") : null
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ cursor?: string | string[]; q?: string | string[]; status?: string | string[] }> }) {
  const context = await requirePlatformContext()
  const params = await searchParams
  const rawQuery = typeof params.q === "string" ? params.q.trim() : ""
  const query = rawQuery.length <= 100 ? rawQuery : ""
  const status = params.status === "active" || params.status === "archived" ? params.status : null
  const rawCursor = typeof params.cursor === "string" ? params.cursor : null
  const cursor = decodeCursor(rawCursor)
  const result = await bffDb.listCompanies({ actorUserId: context.userId, sessionId: context.sessionId, search: query || null, status, cursorCreatedAt: cursor?.createdAt ?? null, cursorId: cursor?.id ?? null, limit: 25 })

  return <div className="space-y-10"><CompanyList companies={result.items} currentCursor={cursor ? rawCursor : null} nextCursor={encodeCursor(result.nextCursor)} query={query} state={result.items.length === 0 && query ? "no-results" : "ready"} /><details className="rounded-2xl border bg-card"><summary className="min-h-12 cursor-pointer px-5 py-4 font-medium">Cadastrar nova empresa</summary><div className="border-t border-border/70 p-5 sm:p-7"><CompanyForm /></div></details></div>
}
