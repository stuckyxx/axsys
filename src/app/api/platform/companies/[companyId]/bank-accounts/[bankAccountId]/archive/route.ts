import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { requirePlatformApiContext, requireRecentAuthentication } from "@/modules/auth/server/guards"
import { archiveBankAccountSchema } from "@/modules/bank-accounts/schemas/bank-account-schemas"
import { archiveBankAccount, listPlatformBankAccounts } from "@/modules/bank-accounts/server/bank-account-service"
import { assertBankMutationRequest, bankVersionConflictResponse, enforceBankMutationRateLimit, neutralBankNotFound, parseBankMutationJson } from "@/modules/bank-accounts/server/bank-account-route-security"

type RouteContext = Readonly<{ params: Promise<{ companyId: string; bankAccountId: string }> }>
const idSchema = z.uuid()

export async function POST(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request)
  try {
    await assertBankMutationRequest(request)
    const context = await requirePlatformApiContext()
    requireRecentAuthentication(context, 600)
    const path = await params
    const companyId = idSchema.parse(path.companyId)
    const bankAccountId = idSchema.parse(path.bankAccountId)
    const limited = await enforceBankMutationRateLimit(context, companyId, correlationId)
    if (limited) return limited
    const input = archiveBankAccountSchema.parse(
      await parseBankMutationJson(request),
    )
    return withNoStore(Response.json(await archiveBankAccount({
      actorUserId: context.userId, sessionId: context.sessionId,
      companyId, bankAccountId, version: input.version,
      replacementDefaultId: input.replacementDefaultId,
      reasonCode: input.reasonCode,
      correlationId,
    })))
  } catch (error) {
    if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
      try {
        const context = await requirePlatformApiContext()
        const path = await params
        const companyId = idSchema.parse(path.companyId)
        const bankAccountId = idSchema.parse(path.bankAccountId)
        const current = (await listPlatformBankAccounts({ context, companyId })).find(({ id }) => id === bankAccountId)
        const conflict = bankVersionConflictResponse(error, current, correlationId)
        if (conflict) return conflict
        return toErrorResponse(neutralBankNotFound(), correlationId)
      } catch (snapshotError) { return toErrorResponse(snapshotError, correlationId) }
    }
    return error instanceof ApiError && error.code === "PLATFORM_FORBIDDEN"
      ? toErrorResponse(neutralBankNotFound(), correlationId)
      : toErrorResponse(error, correlationId)
  }
}
