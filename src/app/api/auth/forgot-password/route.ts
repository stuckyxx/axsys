import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { forgotPasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import {
  PasswordRecoveryRateLimitError,
  requestPasswordRecovery,
} from "@/modules/auth/server/request-password-recovery"

const MAX_RETRY_AFTER_SECONDS = 3_600

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const store = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      store.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const input = forgotPasswordSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await requestPasswordRecovery(input, request, correlationId),
        { status: 202 },
      ),
    )
  } catch (error) {
    const response = toErrorResponse(error, correlationId)
    if (error instanceof PasswordRecoveryRateLimitError) {
      response.headers.set(
        "Retry-After",
        String(
          Math.min(
            MAX_RETRY_AFTER_SECONDS,
            Math.max(1, Math.trunc(error.retryAfterSeconds)),
          ),
        ),
      )
    }
    return response
  }
}
