import "server-only"

import { bffDb, type PlatformAuditEventSnapshot } from "@/lib/db/bff"
import { z } from "@/lib/validation/zod"

const auditCursorSchema = z
  .object({ occurredAt: z.iso.datetime({ offset: true }), id: z.uuid() })
  .strict()

type PlatformIdentity = Readonly<{ userId: string; sessionId: string }>
type SafeAuditMetadata = Readonly<{
  moduleCount?: number
  bankCode?: string
  accountLast4?: string
  madeDefault?: boolean
  previousStatus?: string
  nextStatus?: string
  accessReconciliation?: "complete" | "pending"
}>

export type PlatformAuditFilters = Readonly<{
  action?: string
  resourceType?: string
  outcome?: "success" | "denied" | "failure"
  cursor?: string
  limit: number
}>

function decodeCursor(value: string): z.infer<typeof auditCursorSchema> {
  try {
    return auditCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    )
  } catch {
    throw new z.ZodError([])
  }
}

function encodeCursor(cursor: z.infer<typeof auditCursorSchema>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): SafeAuditMetadata {
  const safe: Record<string, string | number | boolean> = {}
  if (Number.isInteger(metadata.moduleCount) && Number(metadata.moduleCount) >= 0 && Number(metadata.moduleCount) <= 3) safe.moduleCount = Number(metadata.moduleCount)
  if (typeof metadata.bankCode === "string" && /^\d{3,4}$/u.test(metadata.bankCode)) safe.bankCode = metadata.bankCode
  if (typeof metadata.accountLast4 === "string" && /^\d{1,4}$/u.test(metadata.accountLast4)) safe.accountLast4 = metadata.accountLast4
  if (typeof metadata.madeDefault === "boolean") safe.madeDefault = metadata.madeDefault
  const statuses = new Set(["active", "archived", "invited", "suspended", "pending", "complete"])
  if (typeof metadata.previousStatus === "string" && statuses.has(metadata.previousStatus)) safe.previousStatus = metadata.previousStatus
  if (typeof metadata.nextStatus === "string" && statuses.has(metadata.nextStatus)) safe.nextStatus = metadata.nextStatus
  if (metadata.accessReconciliation === "complete" || metadata.accessReconciliation === "pending") safe.accessReconciliation = metadata.accessReconciliation
  return safe
}

export async function listPlatformAuditEvents(
  identity: PlatformIdentity,
  filters: PlatformAuditFilters,
): Promise<{ items: PlatformAuditEventSnapshot[]; nextCursor: string | null }> {
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  const rows = await bffDb.listPlatformAuditEvents({
    actorUserId: identity.userId,
    sessionId: identity.sessionId,
    action: filters.action ?? null,
    resourceType: filters.resourceType ?? null,
    outcome: filters.outcome ?? null,
    cursorOccurredAt: cursor?.occurredAt ?? null,
    cursorId: cursor?.id ?? null,
    limit: filters.limit + 1,
  })
  const hasNextPage = rows.length > filters.limit
  const items = rows.slice(0, filters.limit).map((event) => ({
    ...event,
    metadata: sanitizeAuditMetadata(event.metadata),
  }))
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      hasNextPage && last
        ? encodeCursor({ occurredAt: last.occurredAt, id: last.id })
        : null,
  }
}
