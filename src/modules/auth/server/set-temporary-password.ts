import "server-only"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { getAdminSupabase } from "@/lib/supabase/admin"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { requireRecentAuthentication } from "@/modules/auth/server/guards"
import { validatePassword } from "@/modules/auth/server/password-policy"
import type { AdministrativeResetReasonCode } from "@/modules/auth/domain/administrative-reset-reason"

type TemporaryPasswordFailureReason =
  | "AUTH_CALL_NOT_ATTEMPTED"
  | "AUTH_PROVIDER_FAILURE"
  | "AUTH_COMPLETION_FAILURE"

export type SetTemporaryPasswordDependencies = {
  beforeAuthUpdate?: () => Promise<void>
  afterAuthUpdate?: () => Promise<void>
  updateAuthPassword?: (targetUserId: string, password: string) => Promise<void>
}

type SetTemporaryPasswordCommand = Readonly<{
  actor: AccessContext
  targetUserId: string
  password: string
  reasonCode: AdministrativeResetReasonCode
  correlationId: string
}>

type TemporaryPasswordResult = Readonly<{
  operationId: string
  status: "completed"
  expiresAt: string
}>

export class TemporaryPasswordRetryRequiredError extends ApiError {
  constructor(
    readonly operationId: string,
    readonly operationStatus: "reserved" | "failed",
  ) {
    super(
      "TEMPORARY_PASSWORD_RETRY_REQUIRED",
      503,
      "A senha provisória não foi concluída. Defina uma nova senha e tente novamente.",
    )
  }
}

function databaseCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }
  return typeof error.code === "string" ? error.code : null
}

function mapReservationError(error: unknown): never {
  const code = databaseCode(error)
  if (code === "P0002") {
    throw new ApiError("USER_NOT_FOUND", 404, "Usuário não encontrado.")
  }
  if (code === "42501") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
  if (code === "23505") {
    throw new ApiError(
      "TEMPORARY_PASSWORD_OPERATION_IN_PROGRESS",
      409,
      "Já existe uma redefinição de senha em andamento.",
    )
  }
  throw error
}

async function markFailureAndThrow(input: {
  actor: AccessContext
  operationId: string
  reasonCode: TemporaryPasswordFailureReason
  correlationId: string
}): Promise<never> {
  let operationStatus: "reserved" | "failed" = "reserved"
  try {
    await bffDb.failTemporaryPasswordReset({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      operationId: input.operationId,
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
    })
    operationStatus = "failed"
  } catch {
    // The prior durable reservation and forced-change flag remain authoritative.
  }
  throw new TemporaryPasswordRetryRequiredError(
    input.operationId,
    operationStatus,
  )
}

async function updateAuthPassword(
  targetUserId: string,
  password: string,
): Promise<void> {
  const result = await getAdminSupabase().auth.admin.updateUserById(
    targetUserId,
    { password },
  )
  if (result.error !== null) throw new Error("Auth update unavailable")
}

export async function setTemporaryPassword(
  command: SetTemporaryPasswordCommand,
  dependencies: SetTemporaryPasswordDependencies = {},
): Promise<TemporaryPasswordResult> {
  requireRecentAuthentication(command.actor)
  await validatePassword(command.password)

  let reservation: Awaited<ReturnType<typeof bffDb.beginTemporaryPasswordReset>>
  try {
    reservation = await bffDb.beginTemporaryPasswordReset({
      actorUserId: command.actor.userId,
      sessionId: command.actor.sessionId,
      targetUserId: command.targetUserId,
      requestReasonCode: command.reasonCode,
      correlationId: command.correlationId,
    })
  } catch (error) {
    return mapReservationError(error)
  }

  try {
    await dependencies.beforeAuthUpdate?.()
  } catch {
    return markFailureAndThrow({
      actor: command.actor,
      operationId: reservation.operationId,
      reasonCode: "AUTH_CALL_NOT_ATTEMPTED",
      correlationId: command.correlationId,
    })
  }

  try {
    await (dependencies.updateAuthPassword ?? updateAuthPassword)(
      command.targetUserId,
      command.password,
    )
  } catch {
    return markFailureAndThrow({
      actor: command.actor,
      operationId: reservation.operationId,
      reasonCode: "AUTH_PROVIDER_FAILURE",
      correlationId: command.correlationId,
    })
  }

  try {
    await dependencies.afterAuthUpdate?.()
    await bffDb.completeTemporaryPasswordReset({
      actorUserId: command.actor.userId,
      sessionId: command.actor.sessionId,
      operationId: reservation.operationId,
      correlationId: command.correlationId,
    })
  } catch {
    return markFailureAndThrow({
      actor: command.actor,
      operationId: reservation.operationId,
      reasonCode: "AUTH_COMPLETION_FAILURE",
      correlationId: command.correlationId,
    })
  }

  return Object.freeze({
    operationId: reservation.operationId,
    status: "completed",
    expiresAt: reservation.expiresAt,
  })
}
