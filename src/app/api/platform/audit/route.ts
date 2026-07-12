import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import { z } from "@/lib/validation/zod"
import { requirePlatformApiContext } from "@/modules/auth/server/guards"
import { listPlatformAuditEvents } from "@/modules/audit/server/list-platform-audit-events"

const auditFiltersSchema = z
  .object({
    action: z
      .string()
      .min(3)
      .max(128)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u)
      .optional(),
    resourceType: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/u)
      .optional(),
    outcome: z.enum(["success", "denied", "failure"]).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(99).default(25),
  })
  .strict()

function rateLimited(correlationId: string): Response {
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

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requirePlatformApiContext()
    const decision = await consumeRateLimit(
      "platform-observability-read",
      `${context.userId}:audit`,
    )
    if (!decision.allowed) return rateLimited(correlationId)
    const url = new URL(request.url)
    const filters = auditFiltersSchema.parse({
      action: url.searchParams.get("action") ?? undefined,
      resourceType: url.searchParams.get("resourceType") ?? undefined,
      outcome: url.searchParams.get("outcome") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    })
    return withNoStore(
      Response.json(
        await listPlatformAuditEvents(
          { userId: context.userId, sessionId: context.sessionId },
          filters,
        ),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
