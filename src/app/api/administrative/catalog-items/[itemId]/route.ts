import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { z } from "@/lib/validation/zod"
import { catalogItemUpdateSchema } from "@/modules/administrative/schemas/catalog-item-input"
import {
  deleteCatalogItem,
  getCatalogItem,
  updateCatalogItem,
} from "@/modules/administrative/server/catalog-item-service"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"

type RouteContext = Readonly<{ params: Promise<{ itemId: string }> }>

async function itemIdFrom(context: RouteContext): Promise<string> {
  return z.uuid().parse((await context.params).itemId)
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
    const itemId = await itemIdFrom(routeContext)
    return withNoStore(
      Response.json(await getCatalogItem({ context, itemId })),
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
    const itemId = await itemIdFrom(routeContext)
    const input = catalogItemUpdateSchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateCatalogItem({ context, itemId, input, correlationId }),
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
    const itemId = await itemIdFrom(routeContext)
    const { version } = z
      .object({ version: z.int().positive() })
      .strict()
      .parse(await request.json())
    await deleteCatalogItem({ context, itemId, version, correlationId })
    return withNoStore(new Response(null, { status: 204 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
