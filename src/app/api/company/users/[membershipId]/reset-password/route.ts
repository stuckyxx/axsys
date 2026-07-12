import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import {
  requireCompanyApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { temporaryPasswordResetSchema } from "@/modules/users/schemas/user-schemas"
import {
  getCompanyUser,
  resetTemporaryPassword,
} from "@/modules/users/server/user-service"
import { enforceUserMutationRateLimit } from "@/modules/users/server/user-route-security"

type RouteContext = Readonly<{
  params: Promise<{ membershipId: string }>
}>

const membershipIdSchema = z.uuid()

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const actor = await requireCompanyApiContext()
    if (actor.role !== "company_admin") {
      throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
    }
    requireRecentAuthentication(actor, 600)
    const membershipId = membershipIdSchema.parse((await params).membershipId)
    const limited = await enforceUserMutationRateLimit(
      "administrative-password-reset",
      `${actor.userId}:${membershipId}`,
      correlationId,
    )
    if (limited) return limited
    const input = temporaryPasswordResetSchema.parse(await request.json())
    const target = await getCompanyUser({ actor, membershipId })
    const result = await resetTemporaryPassword({
      actor,
      targetUserId: target.userId,
      temporaryPassword: input.temporaryPassword,
      reasonCode: input.reasonCode,
      correlationId,
    })
    return withNoStore(Response.json(result))
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "TEMPORARY_PASSWORD_RETRY_REQUIRED" &&
      "operationId" in error &&
      "operationStatus" in error
    ) {
      return withNoStore(
        Response.json(
          {
            error: {
              code: error.code,
              message: error.message,
              correlationId,
              operationId: error.operationId,
              operationStatus: error.operationStatus,
            },
          },
          { status: error.status },
        ),
      )
    }
    return toErrorResponse(error, correlationId)
  }
}
