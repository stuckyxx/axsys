import { forbidden } from "next/navigation"

import { bffDb } from "@/lib/db/bff"
import { requireCompanyContext } from "@/modules/auth/server/guards"
import { CompanyUsersPage } from "@/modules/users/ui/company-users-page"

export const dynamic = "force-dynamic"

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export default async function CompanyUsersRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[]; prevCursor?: string | string[]; q?: string | string[] }>
}) {
  const context = await requireCompanyContext()
  if (context.role !== "company_admin") forbidden()

  const rawSearch = await searchParams
  const rawQuery = typeof rawSearch.q === "string" ? rawSearch.q.trim() : ""
  const query = rawQuery.length > 0 && rawQuery.length <= 100 ? rawQuery : null
  const rawCursor = typeof rawSearch.cursor === "string" ? rawSearch.cursor : null
  const cursor = rawCursor !== null && UUID.test(rawCursor) ? rawCursor : null
  const rawPreviousCursor = typeof rawSearch.prevCursor === "string" ? rawSearch.prevCursor : null
  const previousCursor = rawPreviousCursor !== null && UUID.test(rawPreviousCursor) ? rawPreviousCursor : null

  const users = await bffDb.listCompanyUserDirectory({
    actorUserId: context.userId,
    sessionId: context.sessionId,
    cursor,
    limit: 21,
    searchQuery: query,
  })
  const visibleUsers = users.slice(0, 20)
  const nextCursor = users.length > 20 ? visibleUsers.at(-1)?.membershipId ?? null : null

  return (
    <CompanyUsersPage
      initialUsers={visibleUsers}
      initialNextCursor={nextCursor}
      currentMembershipId={context.membershipId}
      initialQuery={query ?? ""}
      initialCursor={cursor}
      initialPreviousCursor={previousCursor}
    />
  )
}
