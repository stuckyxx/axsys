import "server-only"

import { randomUUID } from "node:crypto"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type { AdministrativeResetReasonCode } from "@/modules/auth/domain/administrative-reset-reason"
import { requireRecentAuthentication } from "@/modules/auth/server/guards"
import { setTemporaryPassword } from "@/modules/auth/server/set-temporary-password"
import { temporaryPasswordResetSchema } from "@/modules/users/schemas/user-schemas"
import type { UpdateCompanyUserInput } from "@/modules/users/schemas/user-schemas"
import { getAuthAdminGateway } from "@/modules/users/server/auth-admin-gateway"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
type PlatformContext = Extract<AccessContext, { kind: "platform" }>

const managedUserSchema = z
  .object({
    membershipId: z.uuid(),
    targetUserId: z.uuid(),
    displayName: z.string().min(2).max(120),
    email: z.email().max(254),
    role: z.enum(["company_admin", "member"]),
    status: z.enum(["active", "suspended"]),
    modules: z.array(z.enum(["administrative", "financial", "certificates"])),
    version: z.int().positive(),
    mustChangePassword: z.boolean(),
    temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    accessState: z.enum([
      "active",
      "suspended",
      "password_change_required",
      "archived_company",
    ]),
  })
  .strict()

type ResetTemporaryPasswordDependencies = Readonly<{
  requireRecentAuthentication: typeof requireRecentAuthentication
  setTemporaryPassword: typeof setTemporaryPassword
}>

type ResetTemporaryPasswordCommand = Readonly<{
  actor: AccessContext
  targetUserId: string
  temporaryPassword: string
  reasonCode: AdministrativeResetReasonCode
  correlationId: string
}>

const defaultResetDependencies: ResetTemporaryPasswordDependencies = {
  requireRecentAuthentication,
  setTemporaryPassword,
}

export async function resetCompanyUserTemporaryPassword(
  dependencies: ResetTemporaryPasswordDependencies,
  command: ResetTemporaryPasswordCommand,
) {
  if (command.actor.userId === command.targetUserId) {
    throw new ApiError(
      "SELF_PASSWORD_RESET",
      403,
      "Você não pode redefinir a própria senha por esta operação.",
    )
  }
  const input = temporaryPasswordResetSchema.parse({
    temporaryPassword: command.temporaryPassword,
    reasonCode: command.reasonCode,
  })
  dependencies.requireRecentAuthentication(command.actor, 600)
  return dependencies.setTemporaryPassword({
    actor: command.actor,
    targetUserId: command.targetUserId,
    password: input.temporaryPassword,
    reasonCode: input.reasonCode,
    correlationId: command.correlationId,
  })
}

export function resetTemporaryPassword(command: ResetTemporaryPasswordCommand) {
  return resetCompanyUserTemporaryPassword(defaultResetDependencies, command)
}

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string"
    ? value.message
    : typeof value.code === "string"
      ? value.code
      : null
}

function mapUserError(error: unknown): never {
  const token = errorToken(error)
  if (token === "company_directory_cursor_invalid") {
    throw new ApiError(
      "CURSOR_INVALID",
      422,
      "O cursor de paginação é inválido.",
    )
  }
  if (token === "AXSYS_MEMBERSHIP_NOT_FOUND") {
    throw new ApiError("USER_NOT_FOUND", 404, "Usuário não encontrado.")
  }
  if (token === "AXSYS_COMPANY_NOT_FOUND") {
    throw new ApiError("COMPANY_NOT_FOUND", 404, "Empresa não encontrada.")
  }
  if (token === "AXSYS_COMPANY_ARCHIVED") {
    throw new ApiError("COMPANY_ARCHIVED", 403, "Empresa arquivada.")
  }
  if (token === "AXSYS_SELF_PRIVILEGE_CHANGE") {
    throw new ApiError(
      "SELF_PRIVILEGE_CHANGE",
      403,
      "Você não pode alterar o próprio acesso.",
    )
  }
  if (token === "AXSYS_LAST_ACTIVE_ADMIN") {
    throw new ApiError(
      "LAST_ACTIVE_ADMIN",
      409,
      "A empresa precisa manter ao menos um administrador ativo.",
    )
  }
  if (token === "AXSYS_VERSION_CONFLICT") {
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "O usuário foi alterado por outra sessão.",
    )
  }
  if (token === "AXSYS_COMPANY_ADMIN_REQUIRED") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
  throw error
}

function publicUser(
  actor: CompanyContext,
  user: z.infer<typeof managedUserSchema>,
) {
  return {
    id: user.membershipId,
    userId: user.targetUserId,
    companyId: actor.companyId,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    modules: [...user.modules],
    version: user.version,
    mustChangePassword: user.mustChangePassword,
    temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt,
    accessState: user.accessState,
  }
}

function assertCompanyAdmin(actor: CompanyContext): void {
  if (actor.role !== "company_admin") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
}

async function reconcileMemberAuthAccess(input: {
  actor: AccessContext
  membershipId: string
  targetUserId: string
  status: "active" | "suspended"
  operationCorrelationId: string
}): Promise<"complete" | "pending"> {
  let succeeded = true
  try {
    const auth = getAuthAdminGateway()
    if (input.status === "suspended") {
      await auth.banUser(input.targetUserId)
    } else {
      await auth.unbanUser(input.targetUserId)
    }
  } catch {
    succeeded = false
  }

  try {
    const result = await bffDb.completeMemberAuthAccessReconciliation({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      membershipId: input.membershipId,
      operationCorrelationId: input.operationCorrelationId,
      succeeded,
      errorCode: succeeded ? null : "AUTH_ADMIN_UNAVAILABLE",
      completionCorrelationId: randomUUID(),
    })
    return result.status === "completed" ? "complete" : "pending"
  } catch {
    // The mutation persisted a pending desired state before any Auth call.
    return "pending"
  }
}

export async function listCompanyUsers(input: {
  actor: CompanyContext
  cursor?: string | null
  limit?: number
  search?: string | null
}) {
  assertCompanyAdmin(input.actor)
  const requestedLimit = Math.min(input.limit ?? 20, 99)
  try {
    const rows = await bffDb.listCompanyUserDirectory({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      cursor: input.cursor ?? null,
      limit: requestedLimit + 1,
      searchQuery: input.search ?? null,
    })
    const hasMore = rows.length > requestedLimit
    const items = hasMore ? rows.slice(0, requestedLimit) : rows
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.membershipId ?? null) : null,
    }
  } catch (error) {
    return mapUserError(error)
  }
}

export async function getCompanyUser(input: {
  actor: CompanyContext
  membershipId: string
}) {
  assertCompanyAdmin(input.actor)
  try {
    const result = managedUserSchema.parse(
      await bffDb.getCompanyUser({
        actorUserId: input.actor.userId,
        sessionId: input.actor.sessionId,
        membershipId: input.membershipId,
      }),
    )
    return publicUser(input.actor, result)
  } catch (error) {
    return mapUserError(error)
  }
}

export async function updateCompanyUser(
  input: UpdateCompanyUserInput & {
    actor: CompanyContext
    membershipId: string
    correlationId: string
  },
) {
  assertCompanyAdmin(input.actor)
  try {
    const client = await createServerSupabase()
    const result = await client.rpc("company_update_membership", {
      p_membership_id: input.membershipId,
      p_display_name: input.displayName,
      p_role: input.role,
      p_status: input.status,
      p_modules: [...input.modules],
      // Postgres accepts NULL here; generated RPC Args cannot express nullable params.
      p_reason: input.suspensionReason as string,
      p_expected_version: input.version,
      p_correlation_id: input.correlationId,
    })
    if (result.error !== null) throw result.error
    const managed = managedUserSchema.parse(result.data)
    const accessReconciliation = await reconcileMemberAuthAccess({
      actor: input.actor,
      membershipId: managed.membershipId,
      targetUserId: managed.targetUserId,
      status: managed.status,
      operationCorrelationId: input.correlationId,
    })
    return {
      ...publicUser(input.actor, managed),
      accessReconciliation,
    }
  } catch (error) {
    return mapUserError(error)
  }
}

export const companyUserService = Object.freeze({
  getCompanyUser,
  listCompanyUsers,
  updateCompanyUser,
})

export async function listPlatformCompanyAdmins(input: {
  actor: PlatformContext
  companyId: string
}) {
  try {
    const detail = await bffDb.getCompanyDetail({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      companyId: input.companyId,
    })
    return { items: detail.admins }
  } catch (error) {
    return mapUserError(error)
  }
}

export async function getPlatformCompanyAdmin(input: {
  actor: PlatformContext
  membershipId: string
}) {
  try {
    return managedUserSchema.parse(
      await bffDb.getPlatformCompanyAdmin({
        actorUserId: input.actor.userId,
        sessionId: input.actor.sessionId,
        membershipId: input.membershipId,
      }),
    )
  } catch (error) {
    return mapUserError(error)
  }
}

export async function updatePlatformCompanyAdmin(
  input: UpdateCompanyUserInput & {
    actor: PlatformContext
    membershipId: string
    correlationId: string
  },
) {
  if (input.role !== "company_admin") {
    throw new ApiError(
      "PLATFORM_ADMIN_ROLE_REQUIRED",
      422,
      "O acesso da plataforma deve permanecer administrador.",
    )
  }
  try {
    const managed = managedUserSchema.parse(
      await bffDb.updatePlatformCompanyAdmin({
        actorUserId: input.actor.userId,
        sessionId: input.actor.sessionId,
        membershipId: input.membershipId,
        displayName: input.displayName,
        status: input.status,
        modules: [...input.modules],
        reason: input.suspensionReason,
        expectedVersion: input.version,
        correlationId: input.correlationId,
      }),
    )
    const accessReconciliation = await reconcileMemberAuthAccess({
      actor: input.actor,
      membershipId: managed.membershipId,
      targetUserId: managed.targetUserId,
      status: managed.status,
      operationCorrelationId: input.correlationId,
    })
    return { ...managed, accessReconciliation }
  } catch (error) {
    return mapUserError(error)
  }
}
