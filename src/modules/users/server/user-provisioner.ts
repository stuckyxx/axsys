import "server-only"

import { ApiError } from "@/lib/http/api-error"
import { fingerprintSensitiveExact } from "@/lib/security/redact"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { validatePassword } from "@/modules/auth/server/password-policy"
import {
  createCompanyUserSchema,
  type CreateCompanyUserInput,
} from "@/modules/users/schemas/user-schemas"

type ModuleKey = "administrative" | "financial" | "certificates"
type CompanyRole = "company_admin" | "member"

export type CompanyUserDto = Readonly<{
  id: string
  userId: string
  companyId: string
  displayName: string
  role: CompanyRole
  modules: readonly ModuleKey[]
  status: "active"
  version: number
  mustChangePassword: true
  temporaryPasswordExpiresAt: string
}>

type ProvisioningOperation =
  | Readonly<{ operationId: string; status: "reserved" }>
  | Readonly<{
      operationId: string
      status: "auth_created" | "committed"
      authUserId: string
    }>

type ProvisioningScope = Readonly<{
  actorUserId: string
  sessionId: string
  companyId: string
  platformAdminOnly: boolean
}>

type ReservationInput = ProvisioningScope &
  Readonly<{
    idempotencyKeyHash: string
    requestHash: string
    subjectEmailHash: string
    correlationId: string
    displayName: string
    email: string
    role: CompanyRole
    modules: readonly ModuleKey[]
  }>

type CommitInput = ProvisioningScope &
  Readonly<{
    operationId: string
    authUserId: string
    correlationId: string
    displayName: string
    email: string
    role: CompanyRole
    modules: readonly ModuleKey[]
  }>

export type UserProvisioningDependencies = Readonly<{
  reserveProvisioning(input: ReservationInput): Promise<ProvisioningOperation>
  markAuthCreated(
    input: ProvisioningScope & {
      operationId: string
      authUserId: string
    },
  ): Promise<void>
  commitProvisioning(input: CommitInput): Promise<CompanyUserDto>
  markCompensation(
    input: ProvisioningScope & {
      operationId: string
      status: "compensated" | "compensation_required"
      errorCode: "DB_COMMIT_FAILED" | "AUTH_DELETE_FAILED"
    },
  ): Promise<void>
  authAdmin: Readonly<{
    createUser(input: {
      email: string
      password: string
      emailConfirm: true
      provisioningOperationId: string
    }): Promise<{ id: string }>
    findProvisionedUser?(input: {
      operationId: string
      subjectEmailHash: string
      fingerprintEmail(email: string): string
    }): Promise<{ id: string } | null>
    deleteUser(userId: string): Promise<void>
    banUser(userId: string): Promise<void>
  }>
  fingerprint?(purpose: string, value: string): string
}>

type ProvisionCompanyUserCommand = Readonly<{
  actor: AccessContext
  companyId: string
  idempotencyKey: string
  correlationId: string
  input: CreateCompanyUserInput
  platformAdminOnly: boolean
}>

function publicError(code: string, status = 503): ApiError {
  return new ApiError(code, status, "Não foi possível criar o usuário.")
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }
  return typeof error.code === "string" ? error.code : null
}

function isAuthIdentityConflict(error: unknown): boolean {
  return [
    "email_exists",
    "identity_already_exists",
    "user_already_exists",
  ].includes(errorCode(error) ?? "")
}

function isAmbiguousCommitFailure(error: unknown): boolean {
  const code = errorCode(error)
  if (code !== null) return !/^(?:22|23|42|P0001)/u.test(code)
  if (!(error instanceof Error)) return true
  return /(?:connection|network|socket|timeout|timed out|fetch)/iu.test(
    error.message,
  )
}

function scopeFor(command: ProvisionCompanyUserCommand): ProvisioningScope {
  const { actor } = command
  if (actor.kind === "company") {
    if (actor.role !== "company_admin" || command.platformAdminOnly) {
      throw publicError("USER_PROVISIONING_FORBIDDEN", 403)
    }
    return {
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      companyId: actor.companyId,
      platformAdminOnly: false,
    }
  }
  if (!command.platformAdminOnly) {
    throw publicError("USER_PROVISIONING_FORBIDDEN", 403)
  }
  return {
    actorUserId: actor.userId,
    sessionId: actor.sessionId,
    companyId: command.companyId,
    platformAdminOnly: true,
  }
}

function requestHash(
  fingerprint: (purpose: string, value: string) => string,
  scope: ProvisioningScope,
  input: CreateCompanyUserInput,
): string {
  return fingerprint(
    "company-user-provisioning-request",
    JSON.stringify({
      companyId: scope.companyId,
      platformAdminOnly: scope.platformAdminOnly,
      displayName: input.displayName,
      email: input.email,
      temporaryPassword: fingerprint(
        "company-user-temporary-password",
        input.temporaryPassword,
      ),
      role: input.role,
      modules: input.modules,
    }),
  )
}

async function compensateAuthIdentity(
  dependencies: UserProvisioningDependencies,
  scope: ProvisioningScope,
  operationId: string,
  authUserId: string,
): Promise<never> {
  try {
    await dependencies.authAdmin.deleteUser(authUserId)
  } catch {
    try {
      await dependencies.authAdmin.banUser(authUserId)
    } catch {
      // The durable marker keeps reconciliation mandatory if the defensive ban fails.
    }
    try {
      await dependencies.markCompensation({
        ...scope,
        operationId,
        status: "compensation_required",
        errorCode: "AUTH_DELETE_FAILED",
      })
    } catch {
      throw publicError("USER_CREATE_RECONCILIATION_REQUIRED")
    }
    throw publicError("USER_CREATE_COMPENSATION_PENDING")
  }
  try {
    await dependencies.markCompensation({
      ...scope,
      operationId,
      status: "compensated",
      errorCode: "DB_COMMIT_FAILED",
    })
  } catch {
    throw publicError("USER_CREATE_RECONCILIATION_REQUIRED")
  }
  throw publicError("USER_CREATE_FAILED")
}

export async function provisionCompanyUser(
  dependencies: UserProvisioningDependencies,
  command: ProvisionCompanyUserCommand,
): Promise<CompanyUserDto> {
  const scope = scopeFor(command)
  const input = createCompanyUserSchema.parse(command.input)
  if (scope.platformAdminOnly && input.role !== "company_admin") {
    throw publicError("PLATFORM_ADMIN_ROLE_REQUIRED", 422)
  }
  await validatePassword(input.temporaryPassword)

  const fingerprint = dependencies.fingerprint ?? fingerprintSensitiveExact
  const subjectEmailHash = fingerprint("company-user-email", input.email)
  const reservation: ReservationInput = {
    ...scope,
    idempotencyKeyHash: fingerprint(
      "company-user-idempotency-key",
      command.idempotencyKey,
    ),
    requestHash: requestHash(fingerprint, scope, input),
    subjectEmailHash,
    correlationId: command.correlationId,
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    modules: input.modules,
  }

  let operation = await dependencies.reserveProvisioning(reservation)
  let authUserId: string
  if (operation.status === "auth_created" || operation.status === "committed") {
    authUserId = operation.authUserId
  } else {
    let created: { id: string } | null = null
    try {
      created = await dependencies.authAdmin.createUser({
        email: input.email,
        password: input.temporaryPassword,
        emailConfirm: true,
        provisioningOperationId: operation.operationId,
      })
    } catch (error) {
      if (!isAuthIdentityConflict(error)) {
        throw publicError("USER_CREATE_FAILED")
      }
      operation = await dependencies.reserveProvisioning(reservation)
      if (operation.status === "auth_created" || operation.status === "committed") {
        created = { id: operation.authUserId }
      } else if (dependencies.authAdmin.findProvisionedUser !== undefined) {
        created = await dependencies.authAdmin.findProvisionedUser({
          operationId: operation.operationId,
          subjectEmailHash,
          fingerprintEmail: (email) =>
            fingerprint("company-user-email", email),
        })
      }
      if (created === null) throw publicError("USER_CONFLICT", 409)
    }
    authUserId = created.id
    if (operation.status === "reserved") {
      try {
        await dependencies.markAuthCreated({
          ...scope,
          operationId: operation.operationId,
          authUserId,
        })
      } catch {
        const refreshed = await dependencies.reserveProvisioning(reservation)
        if (
          (refreshed.status === "auth_created" ||
            refreshed.status === "committed") &&
          refreshed.authUserId === authUserId
        ) {
          operation = refreshed
        } else {
          throw publicError("USER_CREATE_RETRY_REQUIRED")
        }
      }
    }
  }

  const commitInput: CommitInput = {
    ...scope,
    operationId: operation.operationId,
    authUserId,
    correlationId: command.correlationId,
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    modules: input.modules,
  }
  try {
    return await dependencies.commitProvisioning(commitInput)
  } catch (error) {
    if (!isAmbiguousCommitFailure(error)) {
      return compensateAuthIdentity(
        dependencies,
        scope,
        operation.operationId,
        authUserId,
      )
    }
    try {
      const refreshed = await dependencies.reserveProvisioning(reservation)
      if (
        refreshed.status === "committed" &&
        refreshed.authUserId === authUserId
      ) {
        return await dependencies.commitProvisioning({
          ...commitInput,
          operationId: refreshed.operationId,
        })
      }
    } catch {
      // Unknown outcomes are retried later; deleting Auth here would be unsafe.
    }
    throw publicError("USER_CREATE_RETRY_REQUIRED")
  }
}
