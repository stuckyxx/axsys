import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { ApiError } from "@/lib/http/api-error"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { requireAccessApiContext } from "@/modules/auth/server/guards"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { profileUpdateSchema } from "@/modules/settings/schemas/profile-schemas"
import {
  getOwnProfile,
  updateOwnDisplayName,
} from "@/modules/settings/server/profile-service"

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const actor = await requireAccessApiContext()
    return withNoStore(Response.json(await getOwnProfile(actor)))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  let actor: AccessContext | null = null
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    actor = await requireAccessApiContext()
    const input = profileUpdateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateOwnDisplayName({
          actor,
          displayName: input.displayName,
          version: input.version,
          correlationId,
        }),
      ),
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === "VERSION_CONFLICT" && actor) {
      try {
        const current = await getOwnProfile(actor)
        return withNoStore(
          Response.json(
            {
              error: {
                code: error.code,
                message: error.message,
                correlationId,
              },
              current,
            },
            { status: 409 },
          ),
        )
      } catch {
        // Fall through to the stable conflict response without a stale snapshot.
      }
    }
    return toErrorResponse(error, correlationId)
  }
}
