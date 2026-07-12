import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import {
  requirePlatformApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { updateCompanyUserSchema } from "@/modules/users/schemas/user-schemas"
import { updatePlatformCompanyAdmin } from "@/modules/users/server/user-service"
import { enforceUserMutationRateLimit } from "@/modules/users/server/user-route-security"

type RouteContext = Readonly<{
  params: Promise<{ membershipId: string }>
}>

const membershipIdSchema = z.uuid()

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
    const actor = await requirePlatformApiContext()
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
        await updatePlatformCompanyAdmin({
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
