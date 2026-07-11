import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { changePasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { resetRecoveredPassword } from "@/modules/auth/server/reset-recovered-password"

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const store = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      store.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const input = changePasswordSchema.parse(await request.json())
    return withNoStore(
      Response.json(await resetRecoveredPassword(input, correlationId)),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
