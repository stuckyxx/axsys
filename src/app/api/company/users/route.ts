import { cookies } from "next/headers"

import { z } from "@/lib/validation/zod"
import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { assertMutationOrigin } from "@/lib/security/origin"
import {
  requireCompanyApiContext,
  requireRecentAuthentication,
} from "@/modules/auth/server/guards"
import { createCompanyUserSchema } from "@/modules/users/schemas/user-schemas"
import { provisionCompanyUserWithDefaults } from "@/modules/users/server/user-provisioner"
import { listCompanyUsers } from "@/modules/users/server/user-service"
import { enforceUserMutationRateLimit } from "@/modules/users/server/user-route-security"

const listFiltersSchema = z
  .object({
    cursor: z.uuid().optional(),
    // SQL accepts at most 100 rows; one slot is reserved for keyset lookahead.
    limit: z.coerce.number().int().min(1).max(99).default(20),
    search: z.string().trim().max(100).optional(),
  })
  .strict()

const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\u0021-\u007e]+$/u)

function requireAdmin(role: "company_admin" | "member"): void {
  if (role !== "company_admin") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const actor = await requireCompanyApiContext()
    requireAdmin(actor.role)
    const url = new URL(request.url)
    const filters = listFiltersSchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    })
    return withNoStore(
      Response.json(
        await listCompanyUsers({
          actor,
          cursor: filters.cursor ?? null,
          limit: filters.limit,
          search: filters.search ?? null,
        }),
      ),
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
    const actor = await requireCompanyApiContext()
    requireAdmin(actor.role)
    requireRecentAuthentication(actor, 600)
    const limited = await enforceUserMutationRateLimit(
      "user-provisioning",
      `${actor.userId}:${actor.companyId}`,
      correlationId,
    )
    if (limited) return limited
    const idempotencyKey = idempotencyKeySchema.parse(
      request.headers.get("idempotency-key"),
    )
    const input = createCompanyUserSchema.parse(await request.json())
    const result = await provisionCompanyUserWithDefaults({
      actor,
      companyId: actor.companyId,
      idempotencyKey,
      correlationId,
      input,
      platformAdminOnly: false,
    })
    return withNoStore(Response.json(result, { status: 201 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
