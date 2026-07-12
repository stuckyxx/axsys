import { cookies } from "next/headers"

import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { temporaryPasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { getAccessContext } from "@/modules/auth/server/get-access-context"
import {
  setTemporaryPassword,
  TemporaryPasswordRetryRequiredError,
} from "@/modules/auth/server/set-temporary-password"

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const store = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      store.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const input = temporaryPasswordSchema.parse(await request.json())
    const resolution = await getAccessContext()
    if (resolution.status === "anonymous") {
      throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
    }
    if (resolution.status === "password_change") {
      throw new ApiError(
        "PASSWORD_CHANGE_REQUIRED",
        403,
        "Altere sua senha provisória para continuar.",
      )
    }

    return withNoStore(
      Response.json(
        await setTemporaryPassword({
          actor: resolution.context,
          targetUserId: input.targetUserId,
          password: input.password,
          reasonCode: input.reasonCode,
          correlationId,
        }),
      ),
    )
  } catch (error) {
    if (error instanceof TemporaryPasswordRetryRequiredError) {
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
