import "server-only"

import { cookies } from "next/headers"

import { ApiError } from "@/lib/http/api-error"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { assertMutationOrigin } from "@/lib/security/origin"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

type CompanyAccessContext = Extract<AccessContext, { kind: "company" }>

export async function authorizeFileMutation(
  request: Request,
): Promise<CompanyAccessContext> {
  assertMutationOrigin(request.headers.get("origin"))
  const cookieStore = await cookies()
  assertCsrf(
    request.headers.get("x-csrf-token"),
    cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
  )

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
  if (resolution.context.kind !== "company") {
    throw new ApiError("FILE_FORBIDDEN", 403, "Operação não autorizada.")
  }

  const decision = await consumeRateLimit(
    "file-mutation-user",
    resolution.context.userId,
  )
  if (!decision.allowed) {
    throw new ApiError(
      "FILE_RATE_LIMITED",
      429,
      "Muitas solicitações. Tente novamente em instantes.",
    )
  }
  return resolution.context
}

export async function authorizeFileDownload(): Promise<CompanyAccessContext> {
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
  if (resolution.context.kind !== "company") {
    throw new ApiError("FILE_FORBIDDEN", 403, "Operação não autorizada.")
  }

  const decision = await consumeRateLimit(
    "file-download-user",
    resolution.context.userId,
  )
  if (!decision.allowed) {
    throw new ApiError(
      "FILE_RATE_LIMITED",
      429,
      "Muitas solicitações. Tente novamente em instantes.",
    )
  }
  return resolution.context
}
