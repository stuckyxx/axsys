import { cookies } from "next/headers"

import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { requireCompanyApiContext, requireRecentAuthentication } from "@/modules/auth/server/guards"
import { companySettingsSchema } from "@/modules/settings/schemas/company-settings-schemas"
import { CompanySettingsVersionConflictError, getCompanySettings, updateCompanySettings } from "@/modules/settings/server/company-settings-service"

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext()
    return withNoStore(Response.json(await getCompanySettings(context)))
  } catch (error) {
    if (error instanceof CompanySettingsVersionConflictError) {
      return withNoStore(Response.json({ current: error.current, error: {
        code: "VERSION_CONFLICT",
        message: "As configurações foram alteradas por outra sessão.",
        correlationId,
      } }, { status: 409 }))
    }
    return toErrorResponse(error, correlationId)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(request.headers.get("x-csrf-token"), cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null)
    const context = await requireCompanyApiContext()
    requireRecentAuthentication(context, 600)
    const settings = companySettingsSchema.parse(await request.json())
    return withNoStore(Response.json(await updateCompanySettings({ context, settings, correlationId })))
  } catch (error) {
    if (error instanceof CompanySettingsVersionConflictError) {
      return withNoStore(Response.json({ current: error.current, error: {
        code: "VERSION_CONFLICT",
        message: "As configurações foram alteradas por outra sessão.",
        correlationId,
      } }, { status: 409 }))
    }
    return toErrorResponse(error, correlationId)
  }
}
