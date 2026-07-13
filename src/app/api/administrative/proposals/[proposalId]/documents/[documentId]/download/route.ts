import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { downloadProposalDocument } from "@/modules/documents/server/proposal-pdf-service"

type RouteContext = Readonly<{
  params: Promise<{ proposalId: string; documentId: string }>
}>

export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const params = await routeContext.params
    const proposalId = z.uuid().parse(params.proposalId)
    const documentId = z.uuid().parse(params.documentId)
    return await downloadProposalDocument({
      context,
      proposalId,
      documentId,
      correlationId,
    })
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
