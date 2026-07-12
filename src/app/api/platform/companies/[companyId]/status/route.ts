import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import {
  requirePlatformApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import {
  changeCompanyStatus,
  getCompanyDetail,
} from "@/modules/companies/server/company-service"

type RouteContext = Readonly<{
  params: Promise<{ companyId: string }>
}>

const companyIdSchema = z.uuid()
const statusSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("archive"),
      version: z.int().positive(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("reactivate"),
      version: z.int().positive(),
      reason: z.null(),
    })
    .strict(),
])

function isVersionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const value = error as Record<string, unknown>
  return (
    value.code === "AXSYS_VERSION_CONFLICT" ||
    value.message === "AXSYS_VERSION_CONFLICT"
  )
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
    const context = await requirePlatformApiContext()
    requireRecentAuthentication(context, 600)
    const companyId = companyIdSchema.parse((await params).companyId)
    const rateLimit = await consumeRateLimit(
      "platform-company-status",
      `${context.userId}:${companyId}`,
    )
    if (!rateLimit.allowed) {
      return withNoStore(
        Response.json(
          {
            error: {
              code: "PLATFORM_RATE_LIMITED",
              message: "Muitas solicitações. Tente novamente mais tarde.",
              correlationId,
            },
          },
          { status: 429 },
        ),
      )
    }
    const input = statusSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await changeCompanyStatus({ context, companyId, correlationId, ...input }),
      ),
    )
  } catch (error) {
    if (isVersionConflict(error)) {
      try {
        const context = await requirePlatformApiContext()
        const companyId = companyIdSchema.parse((await params).companyId)
        const current = await getCompanyDetail({ context, companyId })
        return withNoStore(
          Response.json(
            {
              error: {
                code: "VERSION_CONFLICT",
                message: "A empresa foi alterada por outra sessão.",
                correlationId,
              },
              current: current.company,
            },
            { status: 409 },
          ),
        )
      } catch (snapshotError) {
        return toErrorResponse(snapshotError, correlationId)
      }
    }
    return toErrorResponse(error, correlationId)
  }
}
