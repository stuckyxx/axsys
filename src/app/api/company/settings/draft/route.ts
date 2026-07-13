import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { requireCompanyApiContext, requireRecentAuthentication } from "@/modules/auth/server/guards"
import { deleteCompanySettingsDraft, getCompanySettingsDraft, upsertCompanySettingsDraft } from "@/modules/settings/server/company-settings-draft-service"
import { enforceSettingsDraftRateLimit } from "@/modules/settings/server/company-settings-route-security"

async function mutationContext(request: Request) {
  assertMutationOrigin(request.headers.get("origin"))
  const cookieStore = await cookies()
  assertCsrf(request.headers.get("x-csrf-token"), cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null)
  const context = await requireCompanyApiContext()
  requireRecentAuthentication(context, 600)
  return context
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try { return withNoStore(Response.json(await getCompanySettingsDraft(await requireCompanyApiContext()))) }
  catch (error) { return toErrorResponse(error, correlationId) }
}

export async function PUT(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await mutationContext(request)
    const limited = await enforceSettingsDraftRateLimit(`${context.userId}:${context.companyId}`, correlationId)
    if (limited) return limited
    return withNoStore(Response.json(await upsertCompanySettingsDraft({ context, body: await request.json(), correlationId })))
  } catch (error) { return toErrorResponse(error, correlationId) }
}

export async function DELETE(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try { return withNoStore(Response.json(await deleteCompanySettingsDraft(await mutationContext(request)))) }
  catch (error) { return toErrorResponse(error, correlationId) }
}
