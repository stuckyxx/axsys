import "server-only"

import { bffDb, type ManagedCompanyUserSnapshot } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { fingerprintSensitiveExact } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { validatePassword } from "@/modules/auth/server/password-policy"
import {
  createCompanyUserSchema,
  type CreateCompanyUserInput,
} from "@/modules/users/schemas/user-schemas"
import { getAuthAdminGateway } from "@/modules/users/server/auth-admin-gateway"

type ModuleKey = "administrative" | "financial" | "certificates"
type CompanyRole = "company_admin" | "member"

const provisioningOperationSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["reserved", "auth_created", "committed"]),
    authUserId: z.uuid().nullable(),
  })
  .strict()

const managedCompanyUserSchema = z
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
      actorUserId: string
      sessionId: string
      expectedEmail: string
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

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return errorCode(error)
  }
  return typeof error.message === "string" ? error.message : errorCode(error)
}

function mapReservationError(error: unknown): never {
  const token = errorToken(error)
  if (token === "AXSYS_IDEMPOTENCY_KEY_REUSED") {
    throw publicError("IDEMPOTENCY_KEY_REUSED", 409)
  }
  if (token === "AXSYS_COMPANY_ARCHIVED") {
    throw publicError("COMPANY_ARCHIVED", 403)
  }
  if (
    token === "AXSYS_COMPANY_ADMIN_REQUIRED" ||
    token === "AXSYS_SESSION_INVALID"
  ) {
    throw publicError("USER_PROVISIONING_FORBIDDEN", 403)
  }
  throw error
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
  terminalError: ApiError = publicError("USER_CREATE_FAILED"),
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
  throw terminalError
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

  let operation: ProvisioningOperation
  try {
    operation = await dependencies.reserveProvisioning(reservation)
  } catch (error) {
    return mapReservationError(error)
  }
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
          actorUserId: scope.actorUserId,
          sessionId: scope.sessionId,
          expectedEmail: input.email,
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
        errorCode(error) === "23505"
          ? publicError("USER_CONFLICT", 409)
          : publicError("USER_CREATE_FAILED"),
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

function mapManagedUser(
  companyId: string,
  user: ManagedCompanyUserSnapshot,
): CompanyUserDto {
  if (
    user.status !== "active" ||
    !user.mustChangePassword ||
    user.temporaryPasswordExpiresAt === null
  ) {
    throw publicError("USER_CREATE_FAILED")
  }
  return {
    id: user.membershipId,
    userId: user.targetUserId,
    companyId,
    displayName: user.displayName,
    role: user.role,
    modules: [...user.modules],
    status: "active",
    version: user.version,
    mustChangePassword: true,
    temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt,
  }
}

function mapOperation(operation: {
  id: string
  status: string
  authUserId: string | null
}): ProvisioningOperation {
  if (operation.status === "reserved" && operation.authUserId === null) {
    return { operationId: operation.id, status: "reserved" }
  }
  if (
    (operation.status === "auth_created" || operation.status === "committed") &&
    operation.authUserId !== null
  ) {
    return {
      operationId: operation.id,
      status: operation.status,
      authUserId: operation.authUserId,
    }
  }
  throw publicError("USER_CREATE_FAILED")
}

export function getUserProvisioningDependencies(): UserProvisioningDependencies {
  const gateway = getAuthAdminGateway()
  const authAdmin: UserProvisioningDependencies["authAdmin"] = {
    ...gateway,
    async findProvisionedUser(input) {
      const id = await bffDb.findProvisioningAuthUser({
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        operationId: input.operationId,
        expectedEmail: input.expectedEmail,
      })
      return id === null ? null : { id }
    },
  }
  return {
    async reserveProvisioning(input) {
      if (input.platformAdminOnly) {
        const operation = await bffDb.reserveCompanyAdminProvisioning(input)
        return mapOperation(operation)
      }
      const client = await createServerSupabase()
      const result = await client.rpc("company_reserve_member_provisioning", {
        p_idempotency_key: input.idempotencyKeyHash,
        p_request_hash: input.requestHash,
        p_subject_email_hash: input.subjectEmailHash,
        p_correlation_id: input.correlationId,
      })
      if (result.error !== null) throw result.error
      const operation = provisioningOperationSchema.parse(result.data)
      return mapOperation(operation)
    },
    markAuthCreated: (input) =>
      bffDb.markProvisioningAuthCreated({
        operationId: input.operationId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        authUserId: input.authUserId,
      }),
    async commitProvisioning(input) {
      if (input.platformAdminOnly) {
        return mapManagedUser(
          input.companyId,
          await bffDb.commitCompanyAdminProvisioning({
            actorUserId: input.actorUserId,
            sessionId: input.sessionId,
            operationId: input.operationId,
            authUserId: input.authUserId,
            companyId: input.companyId,
            displayName: input.displayName,
            email: input.email,
            modules: [...input.modules],
            correlationId: input.correlationId,
          }),
        )
      }
      const client = await createServerSupabase()
      const result = await client.rpc("company_commit_member_provisioning", {
        p_operation_id: input.operationId,
        p_auth_user_id: input.authUserId,
        p_display_name: input.displayName,
        p_email: input.email,
        p_role: input.role,
        p_modules: [...input.modules],
        p_correlation_id: input.correlationId,
      })
      if (result.error !== null) throw result.error
      return mapManagedUser(
        input.companyId,
        managedCompanyUserSchema.parse(result.data),
      )
    },
    markCompensation: (input) =>
      bffDb.markProvisioningCompensation({
        operationId: input.operationId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        status: input.status,
        errorCode: input.errorCode,
      }),
    authAdmin,
    fingerprint: fingerprintSensitiveExact,
  }
}

export function provisionCompanyUserWithDefaults(command: ProvisionCompanyUserCommand) {
  return provisionCompanyUser(getUserProvisioningDependencies(), command)
}
