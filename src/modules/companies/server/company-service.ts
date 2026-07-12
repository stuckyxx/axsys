import "server-only"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type {
  CompanyListFilters,
  UpdateCompanyInput,
} from "@/modules/companies/schemas/company-schemas"
import {
  getCompanyDetail as readCompanyDetail,
  listCompanies as readCompanies,
} from "@/modules/platform/server/platform-repository"
import { getAuthAdminGateway } from "@/modules/users/server/auth-admin-gateway"

type PlatformAccessContext = Extract<AccessContext, { kind: "platform" }>

const AUTH_RECONCILIATION_BATCH_SIZE = 10
const MAX_INLINE_RECONCILIATION_USERS = 50
const AUTH_RECONCILIATION_BATCH_TIMEOUT_MS = 5_000

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string"
    ? value.message
    : typeof value.code === "string"
      ? value.code
      : null
}

function mapCompanyError(error: unknown): never {
  const token = errorToken(error)
  if (token === "AXSYS_COMPANY_NOT_FOUND") {
    throw new ApiError("COMPANY_NOT_FOUND", 404, "Empresa não encontrada.")
  }
  if (token === "AXSYS_INVALID_TIMEZONE") {
    throw new ApiError("INVALID_TIMEZONE", 422, "Fuso horário inválido.")
  }
  throw error
}

export async function listCompanies(
  input: CompanyListFilters & { context: PlatformAccessContext },
) {
  return readCompanies(input.context, {
    search: input.search,
    status: input.status,
    cursor: input.cursor,
    limit: input.limit,
  })
}

export async function getCompanyDetail(input: {
  context: PlatformAccessContext
  companyId: string
}) {
  try {
    return await readCompanyDetail(input.context, input.companyId)
  } catch (error) {
    return mapCompanyError(error)
  }
}

export const getCompany = getCompanyDetail

export async function updateCompany(
  input: UpdateCompanyInput & {
    context: PlatformAccessContext
    companyId: string
    correlationId: string
  },
) {
  try {
    return await bffDb.updateCompany({
      actorUserId: input.context.userId,
      sessionId: input.context.sessionId,
      companyId: input.companyId,
      legalName: input.legalName,
      tradeName: input.tradeName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      timezone: input.timezone,
      expectedVersion: input.version,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapCompanyError(error)
  }
}

async function reconcileAccess(
  action: "archive" | "reactivate",
  userIds: readonly string[],
): Promise<string[]> {
  let auth: ReturnType<typeof getAuthAdminGateway>
  try {
    auth = getAuthAdminGateway()
  } catch {
    return [...userIds]
  }
  const failedUserIds: string[] = []
  const inlineUserIds = userIds.slice(0, MAX_INLINE_RECONCILIATION_USERS)
  for (
    let offset = 0;
    offset < inlineUserIds.length;
    offset += AUTH_RECONCILIATION_BATCH_SIZE
  ) {
    const batch = inlineUserIds.slice(
      offset,
      offset + AUTH_RECONCILIATION_BATCH_SIZE,
    )
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(
        () => resolve(null),
        AUTH_RECONCILIATION_BATCH_TIMEOUT_MS,
      )
    })
    const results = await Promise.race([
      Promise.allSettled(
        batch.map((userId) =>
          action === "archive" ? auth.banUser(userId) : auth.unbanUser(userId),
        ),
      ),
      timeout,
    ])
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (results === null) {
      failedUserIds.push(...inlineUserIds.slice(offset))
      break
    }
    results.forEach((result, index) => {
      if (result.status === "rejected") failedUserIds.push(batch[index]!)
    })
  }
  failedUserIds.push(...userIds.slice(MAX_INLINE_RECONCILIATION_USERS))
  return failedUserIds
}

export async function changeCompanyStatus(input: {
  context: PlatformAccessContext
  companyId: string
  action: "archive" | "reactivate"
  version: number
  reason: string | null
  correlationId: string
}) {
  try {
    const result = await bffDb.setCompanyStatus({
      actorUserId: input.context.userId,
      sessionId: input.context.sessionId,
      companyId: input.companyId,
      targetStatus: input.action === "archive" ? "archived" : "active",
      expectedVersion: input.version,
      reason: input.reason,
      correlationId: input.correlationId,
    })
    const failedUserIds = await reconcileAccess(
      input.action,
      result.affectedUserIds,
    )
    let accessReconciliation: "complete" | "pending" = "pending"
    try {
      const completion = await bffDb.completeCompanyAccessReconciliation({
        actorUserId: input.context.userId,
        sessionId: input.context.sessionId,
        reconciliationId: result.reconciliationId,
        failedUserIds,
        correlationId: input.correlationId,
      })
      accessReconciliation = completion.status
    } catch {
      // The database operation remains durably pending for health reconciliation.
    }
    return { company: result.company, accessReconciliation }
  } catch (error) {
    return mapCompanyError(error)
  }
}

export const setCompanyStatus = changeCompanyStatus
