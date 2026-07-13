import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { clientUpdateSchema } from "@/modules/administrative/schemas/client-input"
import {
  deleteClient,
  getClientDetail,
  updateClient,
} from "@/modules/administrative/server/client-service"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"

type RouteContext = Readonly<{ params: Promise<{ clientId: string }> }>

async function clientIdFrom(context: RouteContext): Promise<string> {
  return z.uuid().parse((await context.params).clientId)
}

async function assertMutationRequest(request: Request) {
  assertMutationOrigin(request.headers.get("origin"))
  const cookieStore = await cookies()
  assertCsrf(
    request.headers.get("x-csrf-token"),
    cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
  )
}

export async function GET(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const clientId = await clientIdFrom(routeContext)
    return withNoStore(
      Response.json(await getClientDetail({ context, clientId })),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function PATCH(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    await assertMutationRequest(request)
    const context = await requireCompanyApiContext("administrative")
    const clientId = await clientIdFrom(routeContext)
    const input = clientUpdateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateClient({ context, clientId, input, correlationId }),
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function DELETE(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    await assertMutationRequest(request)
    const context = await requireCompanyApiContext("administrative")
    const clientId = await clientIdFrom(routeContext)
    const { version } = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await request.json())
    await deleteClient({ context, clientId, version, correlationId })
    return withNoStore(new Response(null, { status: 204 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
