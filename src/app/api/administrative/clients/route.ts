import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { strictSearchParams } from "@/lib/http/strict-search-params"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { clientCreateSchema } from "@/modules/administrative/schemas/client-input"
import {
  createClient,
  listClients,
} from "@/modules/administrative/server/client-service"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"

const listClientsSchema = z
  .object({
    q: z.string().trim().min(1).max(160).optional(),
    segment: z.string().trim().min(2).max(80).optional(),
    archived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const url = new URL(request.url)
    const filters = listClientsSchema.parse(strictSearchParams(url.searchParams))
    return withNoStore(
      Response.json(await listClients({ context, ...filters })),
    )
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
    const input = clientCreateSchema.parse(await request.json())
    const result = await createClient({ context, input, correlationId })
    return withNoStore(Response.json(result, { status: 201 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
