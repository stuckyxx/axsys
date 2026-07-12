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
import { updateCompanyUserSchema } from "@/modules/users/schemas/user-schemas"
import {
  getCompanyUser,
  updateCompanyUser,
} from "@/modules/users/server/user-service"
import { enforceUserMutationRateLimit } from "@/modules/users/server/user-route-security"

type RouteContext = Readonly<{
  params: Promise<{ membershipId: string }>
}>

const membershipIdSchema = z.uuid()

function requireAdmin(role: "company_admin" | "member"): void {
  if (role !== "company_admin") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
}

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const actor = await requireCompanyApiContext()
    requireAdmin(actor.role)
    const membershipId = membershipIdSchema.parse((await params).membershipId)
    return withNoStore(
      Response.json(await getCompanyUser({ actor, membershipId })),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function PATCH(
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
    requireAdmin(actor.role)
    requireRecentAuthentication(actor, 600)
    const membershipId = membershipIdSchema.parse((await params).membershipId)
    const limited = await enforceUserMutationRateLimit(
      "user-provisioning",
      `${actor.userId}:${membershipId}`,
      correlationId,
    )
    if (limited) return limited
    const input = updateCompanyUserSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateCompanyUser({
          actor,
          membershipId,
          correlationId,
          ...input,
        }),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
