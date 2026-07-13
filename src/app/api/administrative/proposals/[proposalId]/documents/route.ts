import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import {
  generateProposalPdf,
  listProposalDocuments,
} from "@/modules/documents/server/proposal-pdf-service"

type RouteContext = Readonly<{ params: Promise<{ proposalId: string }> }>

async function proposalIdFrom(context: RouteContext) {
  return z.uuid().parse((await context.params).proposalId)
}

export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const proposalId = await proposalIdFrom(routeContext)
    return withNoStore(
      Response.json(await listProposalDocuments({ context, proposalId })),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const context = await requireCompanyApiContext("administrative")
    const proposalId = await proposalIdFrom(routeContext)
    return withNoStore(
      Response.json(
        await generateProposalPdf({ context, proposalId, correlationId }),
        { status: 201 },
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
