import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import {
  requirePlatformApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { createBankAccountSchema } from "@/modules/bank-accounts/schemas/bank-account-schemas"
import {
  createBankAccount,
  listPlatformBankAccounts,
} from "@/modules/bank-accounts/server/bank-account-service"
import {
  assertBankMutationRequest,
  enforceBankMutationRateLimit,
  neutralBankNotFound,
  parseBankMutationJson,
} from "@/modules/bank-accounts/server/bank-account-route-security"

type RouteContext = Readonly<{ params: Promise<{ companyId: string }> }>
const companyIdSchema = z.uuid()

function responseError(error: unknown, correlationId: string): Response {
  return error instanceof ApiError && error.code === "PLATFORM_FORBIDDEN"
    ? toErrorResponse(neutralBankNotFound(), correlationId)
    : toErrorResponse(error, correlationId)
}

export async function GET(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requirePlatformApiContext()
    const companyId = companyIdSchema.parse((await params).companyId)
    return withNoStore(
      Response.json(await listPlatformBankAccounts({ context, companyId })),
    )
  } catch (error) {
    return responseError(error, correlationId)
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request)
  try {
    await assertBankMutationRequest(request)
    const context = await requirePlatformApiContext()
    requireRecentAuthentication(context, 600)
    const companyId = companyIdSchema.parse((await params).companyId)
    const limited = await enforceBankMutationRateLimit(
      context,
      companyId,
      correlationId,
    )
    if (limited) return limited
    const input = createBankAccountSchema.parse(
      await parseBankMutationJson(request),
    )
    return withNoStore(
      Response.json(
        await createBankAccount({
          actorUserId: context.userId,
          sessionId: context.sessionId,
          companyId,
          correlationId,
          input,
        }),
        { status: 201 },
      ),
    )
  } catch (error) {
    return responseError(error, correlationId)
  }
}
