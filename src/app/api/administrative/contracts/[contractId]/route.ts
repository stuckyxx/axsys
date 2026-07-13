import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { contractUpdateSchema } from "@/modules/contracts/schemas/contract-input"
import {
  deleteContract,
  getContractDetail,
  updateContract,
} from "@/modules/contracts/server/contract-service"

type RouteContext = Readonly<{ params: Promise<{ contractId: string }> }>

const deleteSchema = z.object({ version: z.int().positive() }).strict()

async function contractIdFrom(routeContext: RouteContext): Promise<string> {
  return z.uuid().parse((await routeContext.params).contractId)
}

async function assertMutationRequest(request: Request): Promise<void> {
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
    const contractId = await contractIdFrom(routeContext)
    return withNoStore(
      Response.json(await getContractDetail({ context, contractId })),
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
    const contractId = await contractIdFrom(routeContext)
    const input = contractUpdateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateContract({ context, contractId, input, correlationId }),
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
    const contractId = await contractIdFrom(routeContext)
    const { version } = deleteSchema.parse(await request.json())
    await deleteContract({ context, contractId, version, correlationId })
    return withNoStore(new Response(null, { status: 204 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
