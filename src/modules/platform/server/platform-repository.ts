import "server-only"

import { z } from "@/lib/validation/zod"
import { bffDb } from "@/lib/db/bff"
import type { CompanyListFilters } from "@/modules/companies/schemas/company-schemas"

const cursorSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict()

type PlatformIdentity = Readonly<{ userId: string; sessionId: string }>

function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    )
  } catch {
    throw new z.ZodError([])
  }
}

function encodeCursor(cursor: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export async function listCompanies(
  identity: PlatformIdentity,
  filters: CompanyListFilters,
) {
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  const result = await bffDb.listCompanies({
    actorUserId: identity.userId,
    sessionId: identity.sessionId,
    search: filters.search ?? null,
    status: filters.status ?? null,
    cursorCreatedAt: cursor?.createdAt ?? null,
    cursorId: cursor?.id ?? null,
    limit: filters.limit,
  })
  return {
    items: result.items,
    nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
  }
}

export function getCompanyDetail(
  identity: PlatformIdentity,
  companyId: string,
) {
  return bffDb.getCompanyDetail({
    actorUserId: identity.userId,
    sessionId: identity.sessionId,
    companyId,
  })
}

export const platformRepository = Object.freeze({
  getCompanyDetail,
  listCompanies,
})
