import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { strictSearchParams } from "@/lib/http/strict-search-params"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import {
  contractCreateSchema,
  listContractSchema,
} from "@/modules/contracts/schemas/contract-input"
import {
  createContract,
  listContracts,
} from "@/modules/contracts/server/contract-service"

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext("administrative")
    const filters = listContractSchema.parse(
      strictSearchParams(new URL(request.url).searchParams),
    )
    return withNoStore(
      Response.json(await listContracts({ context, ...filters })),
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
    const input = contractCreateSchema.parse(await request.json())
    return withNoStore(
      Response.json(await createContract({ context, input, correlationId }), {
        status: 201,
      }),
    )
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
