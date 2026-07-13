import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { archiveClient } from "@/modules/administrative/server/client-service"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"

type RouteContext = Readonly<{ params: Promise<{ clientId: string }> }>
const bodySchema = z.object({ version: z.number().int().positive() }).strict()

export async function POST(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const context = await requireCompanyApiContext("administrative")
    const clientId = z.uuid().parse((await routeContext.params).clientId)
    const { version } = bodySchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await archiveClient({ context, clientId, version, correlationId }),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
