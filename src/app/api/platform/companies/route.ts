import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import { requirePlatformApiContext, requireRecentAuthentication } from "@/modules/auth/server/guards"
import { createCompanySchema } from "@/modules/companies/schemas/company-schemas"
import {
  getCompanyProvisioningDependencies,
  provisionCompany,
} from "@/modules/companies/server/company-provisioner"

const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\u0021-\u007e]+$/u)

const AUTH_IDENTITY_CONFLICT_CODES = new Set([
  "email_exists",
  "identity_already_exists",
  "user_already_exists",
])

function errorProperty(error: unknown, property: "code" | "message"): string | null {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return null
  }
  const value = (error as Record<string, unknown>)[property]
  return typeof value === "string" ? value : null
}

function mapCompanyCreationError(error: unknown): unknown {
  const code = errorProperty(error, "code")
  const message = errorProperty(error, "message")
  if (
    code === "AXSYS_IDEMPOTENCY_KEY_REUSED" ||
    message === "AXSYS_IDEMPOTENCY_KEY_REUSED"
  ) {
    return new ApiError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "A chave de idempotência não pode ser reutilizada para esta solicitação.",
    )
  }
  if (code === "23505" || (code !== null && AUTH_IDENTITY_CONFLICT_CODES.has(code))) {
    return new ApiError(
      "COMPANY_CONFLICT",
      409,
      "Não foi possível criar a empresa com os dados informados.",
    )
  }
  return error
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const context = await requirePlatformApiContext()
    requireRecentAuthentication(context, 600)
    const rateLimit = await consumeRateLimit(
      "platform-company-create",
      context.userId,
    )
    if (!rateLimit.allowed) {
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
    const idempotencyKey = idempotencyKeySchema.parse(
      request.headers.get("idempotency-key"),
    )
    const input = createCompanySchema.parse(await request.json())
    const result = await provisionCompany(getCompanyProvisioningDependencies(), {
      actorUserId: context.userId,
      sessionId: context.sessionId,
      idempotencyKey,
      correlationId,
      input,
    })
    return withNoStore(Response.json(result, { status: 201 }))
  } catch (error) {
    return toErrorResponse(mapCompanyCreationError(error), correlationId)
  }
}
