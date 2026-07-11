import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { createServerSupabase } from "@/lib/supabase/server"
import { themeSchema } from "@/modules/auth/schemas/auth-schemas"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

const themeRowSchema = z
  .object({
    preferred_theme: z.enum(["dark", "light"]),
    version: z.int().positive(),
  })
  .strict()

function databaseUnavailable(): ApiError {
  return new ApiError(
    "PROFILE_THEME_UNAVAILABLE",
    500,
    "Não foi possível concluir a operação.",
  )
}

function serializeTheme(row: z.infer<typeof themeRowSchema>) {
  return Object.freeze({
    preferredTheme: row.preferred_theme,
    version: row.version,
  })
}

export async function PATCH(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)

  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const input = themeSchema.parse(await request.json())
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
    const context = resolution.context
    const client = await createServerSupabase()

    const updateResult = await client
      .from("profiles")
      .update({ preferred_theme: input.theme })
      .eq("user_id", context.userId)
      .eq("version", input.version)
      .select("preferred_theme,version")
      .maybeSingle()

    if (updateResult.error !== null) throw databaseUnavailable()

    if (updateResult.data !== null) {
      const persisted = themeRowSchema.safeParse(updateResult.data)
      if (!persisted.success) throw databaseUnavailable()
      return withNoStore(Response.json(serializeTheme(persisted.data)))
    }

    const currentResult = await client
      .from("profiles")
      .select("preferred_theme,version")
      .eq("user_id", context.userId)
      .maybeSingle()
    if (currentResult.error !== null) throw databaseUnavailable()

    const current = themeRowSchema.safeParse(currentResult.data)
    if (!current.success) throw databaseUnavailable()

    return withNoStore(
      Response.json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message: "Os dados mudaram em outra sessão.",
            correlationId,
          },
          current: serializeTheme(current.data),
        },
        { status: 409 },
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
