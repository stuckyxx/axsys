import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { loginSchema } from "@/modules/auth/schemas/auth-schemas"
import {
  AuthenticationRateLimitError,
  login,
} from "@/modules/auth/server/login"

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
    const input = loginSchema.parse(await request.json())
    return withNoStore(
      Response.json(await login(input, request, correlationId)),
    )
  } catch (error) {
    const response = toErrorResponse(error, correlationId)
    if (error instanceof AuthenticationRateLimitError) {
      response.headers.set(
        "Retry-After",
        String(
          Math.min(
            MAX_RETRY_AFTER_SECONDS,
            Math.max(1, error.retryAfterSeconds),
          ),
        ),
      )
    }
    return response
  }
}
