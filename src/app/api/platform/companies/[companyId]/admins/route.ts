import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import {
  requirePlatformApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { createCompanyUserSchema } from "@/modules/users/schemas/user-schemas"
import { provisionCompanyUserWithDefaults } from "@/modules/users/server/user-provisioner"
import { listPlatformCompanyAdmins } from "@/modules/users/server/user-service"
import { enforceUserMutationRateLimit } from "@/modules/users/server/user-route-security"

type RouteContext = Readonly<{
  params: Promise<{ companyId: string }>
}>

const companyIdSchema = z.uuid()
const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\u0021-\u007e]+$/u)

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const actor = await requirePlatformApiContext()
    const companyId = companyIdSchema.parse((await params).companyId)
    return withNoStore(
      Response.json(await listPlatformCompanyAdmins({ actor, companyId })),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

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
    const actor = await requirePlatformApiContext()
    requireRecentAuthentication(actor, 600)
    const companyId = companyIdSchema.parse((await params).companyId)
    const limited = await enforceUserMutationRateLimit(
      "user-provisioning",
      `${actor.userId}:${companyId}`,
      correlationId,
    )
    if (limited) return limited
    const idempotencyKey = idempotencyKeySchema.parse(
      request.headers.get("idempotency-key"),
    )
    const input = createCompanyUserSchema.parse(await request.json())
    if (input.role !== "company_admin") {
      throw new ApiError(
        "PLATFORM_ADMIN_ROLE_REQUIRED",
        422,
        "A plataforma pode criar somente administradores.",
      )
    }
    const result = await provisionCompanyUserWithDefaults({
      actor,
      companyId,
      idempotencyKey,
      correlationId,
      input,
      platformAdminOnly: true,
    })
    return withNoStore(Response.json(result, { status: 201 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
