import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import {
  requirePlatformApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { updateCompanySchema } from "@/modules/companies/schemas/company-schemas"
import {
  getCompanyDetail,
  updateCompany,
} from "@/modules/companies/server/company-service"

type RouteContext = Readonly<{
  params: Promise<{ companyId: string }>
}>

const companyIdSchema = z.uuid()

function isVersionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const value = error as Record<string, unknown>
  return (
    value.code === "AXSYS_VERSION_CONFLICT" ||
    value.message === "AXSYS_VERSION_CONFLICT"
  )
}

function neutralNotFound(): ApiError {
  return new ApiError("COMPANY_NOT_FOUND", 404, "Empresa não encontrada.")
}

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await requirePlatformApiContext()
    const companyId = companyIdSchema.parse((await params).companyId)
    return withNoStore(
      Response.json(await getCompanyDetail({ context, companyId })),
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === "PLATFORM_FORBIDDEN") {
      return toErrorResponse(neutralNotFound(), correlationId)
    }
    return toErrorResponse(error, correlationId)
  }
}

export async function PATCH(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    assertMutationOrigin(request.headers.get("origin"))
    const cookieStore = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null,
    )
    const context = await requirePlatformApiContext()
    requireRecentAuthentication(context, 600)
    const companyId = companyIdSchema.parse((await params).companyId)
    const input = updateCompanySchema.parse(await request.json())
    return withNoStore(
      Response.json(
        await updateCompany({ context, companyId, correlationId, ...input }),
      ),
    )
  } catch (error) {
    if (isVersionConflict(error)) {
      try {
        const context = await requirePlatformApiContext()
        const companyId = companyIdSchema.parse((await params).companyId)
        const current = await getCompanyDetail({ context, companyId })
        return withNoStore(
          Response.json(
            {
              error: {
                code: "VERSION_CONFLICT",
                message: "A empresa foi alterada por outra sessão.",
                correlationId,
              },
              current: current.company,
            },
            { status: 409 },
          ),
        )
      } catch (snapshotError) {
        return toErrorResponse(snapshotError, correlationId)
      }
    }
    return toErrorResponse(error, correlationId)
  }
}
