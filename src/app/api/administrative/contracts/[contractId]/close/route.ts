import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { closeContractSchema } from "@/modules/contracts/schemas/contract-input"
import { closeContract } from "@/modules/contracts/server/contract-service"

type RouteContext = Readonly<{ params: Promise<{ contractId: string }> }>

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
    const contractId = z.uuid().parse((await routeContext.params).contractId)
    const input = closeContractSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await closeContract({
          context,
          contractId,
          version: input.version,
          reason: input.reason,
          correlationId,
        }),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
