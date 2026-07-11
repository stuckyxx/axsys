import { ZodError } from "zod"

import { ApiError } from "@/lib/http/api-error"
import { withNoStore } from "@/lib/security/no-store"

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof ZodError) {
    return new ApiError(
      "VALIDATION_FAILED",
      422,
      "Revise os campos informados.",
      error.flatten().fieldErrors as Record<string, string[]>,
    )
  }
  return new ApiError(
    "INTERNAL_ERROR",
    500,
    "Não foi possível concluir a operação.",
  )
}

export function toErrorResponse(error: unknown, correlationId: string): Response {
  const normalized = normalizeError(error)
  return withNoStore(
    Response.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message,
          correlationId,
          ...(normalized.fieldErrors
            ? { fieldErrors: normalized.fieldErrors }
            : {}),
        },
      },
      { status: normalized.status },
    ),
  )
}
