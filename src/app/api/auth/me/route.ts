import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

function safeContext(context: AccessContext) {
  if (context.kind === "platform") {
    return {
      kind: context.kind,
      userId: context.userId,
      modules: [] as const,
      profile: context.profile,
    }
  }
  return {
    kind: context.kind,
    userId: context.userId,
    companyId: context.companyId,
    role: context.role,
    modules: context.modules,
    profile: context.profile,
  }
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const resolution = await getAccessContext()
    if (resolution.status === "anonymous") {
      throw new ApiError(
        "AUTH_REQUIRED",
        401,
        "Faça login para continuar.",
      )
    }
    if (resolution.status === "password_change") {
      throw new ApiError(
        "PASSWORD_CHANGE_REQUIRED",
        403,
        "Altere sua senha provisória para continuar.",
      )
    }
    return withNoStore(Response.json(safeContext(resolution.context)))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
