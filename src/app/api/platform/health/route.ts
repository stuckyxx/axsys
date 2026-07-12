import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import { requirePlatformApiContext } from "@/modules/auth/server/guards"
import { getPlatformHealth } from "@/modules/platform/server/platform-health"

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requirePlatformApiContext()
    const decision = await consumeRateLimit(
      "platform-observability-read",
      `${context.userId}:health`,
    )
    if (!decision.allowed) {
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
    return withNoStore(
      Response.json(
        await getPlatformHealth({
          userId: context.userId,
          sessionId: context.sessionId,
        }),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
