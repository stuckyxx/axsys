import "server-only"

import { randomUUID } from "node:crypto"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { fingerprintSensitiveExact } from "@/lib/security/redact"
import {
  createCompanySchema,
  type CreateCompanyInput,
} from "@/modules/companies/schemas/company-schemas"
import { validatePassword } from "@/modules/auth/server/password-policy"
import { getAuthAdminGateway } from "@/modules/users/server/auth-admin-gateway"

type ProvisionedCompany = Readonly<{
  company: Readonly<{ id: string; status: "active" }>
  membership: Readonly<{ id: string; role: "company_admin" }>
  modules: readonly ("administrative" | "financial" | "certificates")[]
}>

type ProvisioningOperation =
  | Readonly<{ id: string; status: "reserved" }>
  | Readonly<{ id: string; status: "auth_created"; authUserId: string }>
  | Readonly<{ id: string; status: "committed"; authUserId: string }>

export type CompanyProvisioningDependencies = Readonly<{
  repository: Readonly<{
    reserve(input: {
      actorUserId: string
      sessionId: string
      idempotencyKeyHash: string
      requestHash: string
      subjectEmailHash: string
      correlationId: string
    }): Promise<ProvisioningOperation>
    markAuthCreated(input: {
      operationId: string
      actorUserId: string
      sessionId: string
      authUserId: string
    }): Promise<void>
    commit(input: {
      operationId: string
      actorUserId: string
      sessionId: string
      authUserId: string
      companyId: string
      correlationId: string
      company: Omit<CreateCompanyInput, "firstAdmin">
      firstAdmin: Omit<CreateCompanyInput["firstAdmin"], "temporaryPassword">
    }): Promise<ProvisionedCompany>
    markCompensated(input: {
      operationId: string
      actorUserId: string
      sessionId: string
      reason: "DB_COMMIT_FAILED"
    }): Promise<void>
    markCompensationRequired(input: {
      operationId: string
      actorUserId: string
      sessionId: string
      reason: "AUTH_DELETE_FAILED"
    }): Promise<void>
  }>
  auth: Readonly<{
    createUser(input: {
      email: string
      password: string
      emailConfirm: true
    }): Promise<{ id: string }>
    deleteUser(userId: string): Promise<void>
    banUser(userId: string): Promise<void>
  }>
  fingerprint(purpose: string, value: string): string
  uuid(): string
}>

function provisioningError(code: string): ApiError {
  return new ApiError(code, 503, "Não foi possível provisionar a empresa.")
}

function companyConflictError(): ApiError {
  return new ApiError(
    "COMPANY_CONFLICT",
    409,
    "Não foi possível criar a empresa com os dados informados.",
  )
}

function externalErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }
  return typeof error.code === "string" ? error.code : null
}

function isNeutralCompanyConflict(error: unknown): boolean {
  return [
    "23505",
    "email_exists",
    "identity_already_exists",
    "user_already_exists",
  ].includes(externalErrorCode(error) ?? "")
}

function requestFingerprint(
  deps: CompanyProvisioningDependencies,
  input: CreateCompanyInput,
): string {
  const protectedInput = {
    ...input,
    firstAdmin: {
      ...input.firstAdmin,
      temporaryPassword: deps.fingerprint(
        "company-temporary-password",
        input.firstAdmin.temporaryPassword,
      ),
    },
  }
  return deps.fingerprint(
    "company-provisioning-request",
    JSON.stringify(protectedInput),
  )
}

async function compensateAuthUser(
  deps: CompanyProvisioningDependencies,
  operationId: string,
  authUserId: string,
  actorUserId: string,
  sessionId: string,
  terminalError: ApiError = provisioningError("COMPANY_CREATE_FAILED"),
): Promise<never> {
  try {
    await deps.auth.deleteUser(authUserId)
    await deps.repository.markCompensated({
      operationId,
      actorUserId,
      sessionId,
      reason: "DB_COMMIT_FAILED",
    })
    throw terminalError
  } catch (error) {
    if (error instanceof ApiError) throw error
    try {
      await deps.auth.banUser(authUserId)
    } catch {
      // Reconciliation remains mandatory even if the defensive ban also fails.
    }
    await deps.repository.markCompensationRequired({
      operationId,
      actorUserId,
      sessionId,
      reason: "AUTH_DELETE_FAILED",
    })
    throw provisioningError("COMPANY_CREATE_COMPENSATION_PENDING")
  }
}

export async function provisionCompany(
  deps: CompanyProvisioningDependencies,
  command: Readonly<{
    actorUserId: string
    sessionId: string
    idempotencyKey: string
    correlationId: string
    input: CreateCompanyInput
  }>,
): Promise<ProvisionedCompany> {
  const input = createCompanySchema.parse(command.input)
  await validatePassword(input.firstAdmin.temporaryPassword)
  const operation = await deps.repository.reserve({
    actorUserId: command.actorUserId,
    sessionId: command.sessionId,
    idempotencyKeyHash: deps.fingerprint(
      "company-idempotency-key",
      command.idempotencyKey,
    ),
    requestHash: requestFingerprint(deps, input),
    subjectEmailHash: deps.fingerprint(
      "company-first-admin-email",
      input.firstAdmin.email,
    ),
    correlationId: command.correlationId,
  })
  let authUserId: string
  if (operation.status === "auth_created" || operation.status === "committed") {
    authUserId = operation.authUserId
  } else {
    let created: { id: string }
    try {
      created = await deps.auth.createUser({
        email: input.firstAdmin.email,
        password: input.firstAdmin.temporaryPassword,
        emailConfirm: true,
      })
    } catch (error) {
      if (isNeutralCompanyConflict(error)) throw companyConflictError()
      throw provisioningError("COMPANY_CREATE_FAILED")
    }
    authUserId = created.id
    try {
      await deps.repository.markAuthCreated({
        operationId: operation.id,
        actorUserId: command.actorUserId,
        sessionId: command.sessionId,
        authUserId,
      })
    } catch {
      return compensateAuthUser(
        deps,
        operation.id,
        authUserId,
        command.actorUserId,
        command.sessionId,
      )
    }
  }

  const { firstAdmin, ...company } = input
  const safeFirstAdmin = {
    displayName: firstAdmin.displayName,
    email: firstAdmin.email,
    modules: firstAdmin.modules,
  }
  try {
    return await deps.repository.commit({
      operationId: operation.id,
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      authUserId,
      companyId: deps.uuid(),
      correlationId: command.correlationId,
      company,
      firstAdmin: safeFirstAdmin,
    })
  } catch (error) {
    return compensateAuthUser(
      deps,
      operation.id,
      authUserId,
      command.actorUserId,
      command.sessionId,
      isNeutralCompanyConflict(error)
        ? companyConflictError()
        : provisioningError("COMPANY_CREATE_FAILED"),
    )
  }
}

export function getCompanyProvisioningDependencies(): CompanyProvisioningDependencies {
  const auth = getAuthAdminGateway()
  return {
    repository: {
      async reserve(input) {
        const operation = await bffDb.reserveCompanyProvisioning(input)
        if (operation.status === "reserved") {
          return { id: operation.id, status: "reserved" }
        }
        if (
          (operation.status === "auth_created" ||
            operation.status === "committed") &&
          operation.authUserId !== null
        ) {
          return {
            id: operation.id,
            status: operation.status,
            authUserId: operation.authUserId,
          }
        }
        throw provisioningError("COMPANY_CREATE_FAILED")
      },
      markAuthCreated: (input) =>
        bffDb.markProvisioningAuthCreated(input),
      commit: (input) =>
        bffDb.commitCompanyProvisioning({
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          authUserId: input.authUserId,
          companyId: input.companyId,
          legalName: input.company.legalName,
          tradeName: input.company.tradeName,
          cnpj: input.company.cnpj,
          contactEmail: input.company.contactEmail,
          contactPhone: input.company.contactPhone,
          timezone: input.company.timezone,
          adminDisplayName: input.firstAdmin.displayName,
          adminEmail: input.firstAdmin.email,
          modules: input.firstAdmin.modules,
          correlationId: input.correlationId,
        }),
      markCompensated: (input) =>
        bffDb.markProvisioningCompensation({
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          status: "compensated",
          errorCode: input.reason,
        }),
      markCompensationRequired: (input) =>
        bffDb.markProvisioningCompensation({
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          status: "compensation_required",
          errorCode: input.reason,
        }),
    },
    auth,
    fingerprint: fingerprintSensitiveExact,
    uuid: randomUUID,
  }
}
