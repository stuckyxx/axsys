import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import {
  proposalDeleteSchema,
  proposalDraftUpdateSchema,
} from "@/modules/proposals/schemas/proposal-input"
import {
  deleteDraftProposal,
  getProposalDetail,
  updateDraftProposal,
} from "@/modules/proposals/server/proposal-service"

type RouteContext = Readonly<{ params: Promise<{ proposalId: string }> }>

async function proposalIdFrom(context: RouteContext): Promise<string> {
  return z.uuid().parse((await context.params).proposalId)
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
    const proposalId = await proposalIdFrom(routeContext)
    return withNoStore(
      Response.json(await getProposalDetail({ context, proposalId })),
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
    const proposalId = await proposalIdFrom(routeContext)
    const input = proposalDraftUpdateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateDraftProposal({ context, proposalId, input, correlationId }),
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
    const proposalId = await proposalIdFrom(routeContext)
    const { version } = proposalDeleteSchema.parse(await request.json())
    await deleteDraftProposal({ context, proposalId, version, correlationId })
    return withNoStore(new Response(null, { status: 204 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
