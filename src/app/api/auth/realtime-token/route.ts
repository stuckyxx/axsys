import { z } from "zod"

import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { createServerSupabase } from "@/lib/supabase/server"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
})

function authenticationRequired(): ApiError {
  return new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const client = await createServerSupabase()
    const claimsResult = await client.auth.getClaims()
    if (claimsResult.error !== null) {
      throw new Error("Authentication verification unavailable")
    }
    const parsedClaims = claimsSchema.safeParse(claimsResult.data?.claims)
    if (!parsedClaims.success || parsedClaims.data.is_anonymous === true) {
      throw authenticationRequired()
    }

    const resolution = await getAccessContext()
    if (resolution.status === "anonymous") throw authenticationRequired()
    if (resolution.status === "password_change") {
      throw new ApiError(
        "PASSWORD_CHANGE_REQUIRED",
        403,
        "Altere sua senha provisória para continuar.",
      )
    }
    if (
      resolution.context.userId !== parsedClaims.data.sub ||
      resolution.context.sessionId !== parsedClaims.data.session_id
    ) {
      throw authenticationRequired()
    }

    const sessionResult = await client.auth.getSession()
    if (sessionResult.error !== null) {
      throw new Error("Authentication session unavailable")
    }
    const accessToken = sessionResult.data.session?.access_token
    if (
      typeof accessToken !== "string" ||
      accessToken.length === 0 ||
      accessToken !== accessToken.trim()
    ) {
      throw authenticationRequired()
    }

    return withNoStore(Response.json({ accessToken }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
