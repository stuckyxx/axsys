import { getCorrelationId } from "@/lib/http/correlation-id"
import { ApiError } from "@/lib/http/api-error"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { listCompanyBankAccounts } from "@/modules/bank-accounts/server/bank-account-service"

export async function GET(request: Request) {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requireCompanyApiContext()
    if (
      context.role !== "company_admin" &&
      !context.modules.includes("financial")
    ) {
      throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
    }
    return withNoStore(Response.json(await listCompanyBankAccounts({ context })))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
