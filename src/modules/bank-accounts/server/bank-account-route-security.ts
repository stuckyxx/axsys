import "server-only"

import { cookies } from "next/headers"

import { ApiError } from "@/lib/http/api-error"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type { BankAccountSummary } from "@/modules/bank-accounts/server/bank-account-service"

export async function assertBankMutationRequest(request: Request): Promise<void> {
  assertMutationOrigin(request.headers.get("origin"))
  const cookieStore = await cookies()
  assertCsrf(
    request.headers.get("x-csrf-token"),
    cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
  )
}

export async function parseBankMutationJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError(
      "INVALID_JSON",
      400,
      "O corpo da solicitação contém JSON inválido.",
    )
  }
}

export async function enforceBankMutationRateLimit(
  context: Extract<AccessContext, { kind: "platform" }>,
  companyId: string,
  correlationId: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit(
    "bank-account-mutation",
    `${context.userId}:${companyId}`,
  )
  if (decision.allowed) return null
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

export function neutralBankNotFound(): ApiError {
  return new ApiError(
    "BANK_ACCOUNT_NOT_FOUND",
    404,
    "Conta bancária não encontrada.",
  )
}

export function bankVersionConflictResponse(
  error: unknown,
  current: BankAccountSummary | undefined,
  correlationId: string,
): Response | null {
  if (!(error instanceof ApiError) || error.code !== "VERSION_CONFLICT") {
    return null
  }
  if (current === undefined) return null
  return withNoStore(
    Response.json(
      {
        error: {
          code: "VERSION_CONFLICT",
          message: "A conta bancária foi alterada por outra sessão.",
          correlationId,
        },
        current,
      },
      { status: 409 },
    ),
  )
}
