import { cookies } from "next/headers"

import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { changePasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { changeTemporaryPassword } from "@/modules/auth/server/change-temporary-password"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

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
    const resolution = await getAccessContext()
    if (resolution.status === "anonymous") {
      throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
    }
    if (resolution.status === "authenticated") {
      throw new ApiError(
        "PASSWORD_CHANGE_NOT_REQUIRED",
        403,
        "A troca de senha provisória não está disponível.",
      )
    }
    if (resolution.expired) {
      throw new ApiError(
        "TEMPORARY_PASSWORD_EXPIRED",
        403,
        "A senha provisória expirou. Solicite uma nova senha.",
      )
    }

    return withNoStore(
      Response.json(await changeTemporaryPassword(input, correlationId)),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
