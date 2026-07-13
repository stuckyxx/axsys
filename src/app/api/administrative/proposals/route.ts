import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { strictSearchParams } from "@/lib/http/strict-search-params"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { proposalCreateSchema } from "@/modules/proposals/schemas/proposal-input"
import {
  createProposal,
  listProposals,
} from "@/modules/proposals/server/proposal-service"

const listSchema = z
  .object({
    q: z.string().trim().min(1).max(160).optional(),
    clientId: z.uuid().optional(),
    segment: z.string().trim().min(2).max(80).optional(),
    status: z.enum(["draft", "sent", "approved", "rejected"]).optional(),
    issuedFrom: z.iso.date().optional(),
    issuedTo: z.iso.date().optional(),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (value) => !value.issuedFrom || !value.issuedTo || value.issuedFrom <= value.issuedTo,
    { message: "Intervalo de datas inválido.", path: ["issuedTo"] },
  )

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const filters = listSchema.parse(
      strictSearchParams(new URL(request.url).searchParams),
    )
    return withNoStore(Response.json(await listProposals({ context, ...filters })))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const context = await requireCompanyApiContext("administrative")
    const input = proposalCreateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await createProposal({ context, input, correlationId }),
        { status: 201 },
      ),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
