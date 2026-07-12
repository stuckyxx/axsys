import "server-only"

import { ApiError } from "@/lib/http/api-error"
import {
  createCompanySchema,
  type CreateCompanyInput,
} from "@/modules/companies/schemas/company-schemas"
import { validatePassword } from "@/modules/auth/server/password-policy"

type ProvisionedCompany = Readonly<{
  company: Readonly<{ id: string; status: "active" }>
  membership: Readonly<{ id: string; role: "company_admin" }>
  modules: readonly ("administrative" | "financial" | "certificates")[]
}>

type ProvisioningOperation =
  | Readonly<{ id: string; status: "reserved" }>
  | Readonly<{ id: string; status: "auth_created"; authUserId: string }>
  | Readonly<{
      id: string
      status: "committed"
      result: ProvisionedCompany
    }>

export type CompanyProvisioningDependencies = Readonly<{
  repository: Readonly<{
    reserve(input: {
      actorUserId: string
      idempotencyKeyHash: string
      requestHash: string
      subjectEmailHash: string
      correlationId: string
    }): Promise<ProvisioningOperation>
    markAuthCreated(operationId: string, authUserId: string): Promise<void>
    commit(input: {
      operationId: string
      actorUserId: string
      authUserId: string
      correlationId: string
      company: Omit<CreateCompanyInput, "firstAdmin">
      firstAdmin: Omit<CreateCompanyInput["firstAdmin"], "temporaryPassword">
    }): Promise<ProvisionedCompany>
    markCompensated(operationId: string, reason: "DB_COMMIT_FAILED"): Promise<void>
    markCompensationRequired(
      operationId: string,
      reason: "AUTH_DELETE_FAILED",
    ): Promise<void>
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
}>

function provisioningError(code: string): ApiError {
  return new ApiError(code, 503, "Não foi possível provisionar a empresa.")
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
): Promise<never> {
  try {
    await deps.auth.deleteUser(authUserId)
    await deps.repository.markCompensated(operationId, "DB_COMMIT_FAILED")
    throw provisioningError("COMPANY_CREATE_FAILED")
  } catch (error) {
    if (error instanceof ApiError) throw error
    try {
      await deps.auth.banUser(authUserId)
    } catch {
      // Reconciliation remains mandatory even if the defensive ban also fails.
    }
    await deps.repository.markCompensationRequired(
      operationId,
      "AUTH_DELETE_FAILED",
    )
    throw provisioningError("COMPANY_CREATE_COMPENSATION_PENDING")
  }
}

export async function provisionCompany(
  deps: CompanyProvisioningDependencies,
  command: Readonly<{
    actorUserId: string
    idempotencyKey: string
    correlationId: string
    input: CreateCompanyInput
  }>,
): Promise<ProvisionedCompany> {
  const input = createCompanySchema.parse(command.input)
  await validatePassword(input.firstAdmin.temporaryPassword)
  const operation = await deps.repository.reserve({
    actorUserId: command.actorUserId,
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
  if (operation.status === "committed") return operation.result

  let authUserId: string
  if (operation.status === "auth_created") {
    authUserId = operation.authUserId
  } else {
    let created: { id: string }
    try {
      created = await deps.auth.createUser({
        email: input.firstAdmin.email,
        password: input.firstAdmin.temporaryPassword,
        emailConfirm: true,
      })
    } catch {
      throw provisioningError("COMPANY_CREATE_FAILED")
    }
    authUserId = created.id
    try {
      await deps.repository.markAuthCreated(operation.id, authUserId)
    } catch {
      return compensateAuthUser(deps, operation.id, authUserId)
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
      authUserId,
      correlationId: command.correlationId,
      company,
      firstAdmin: safeFirstAdmin,
    })
  } catch {
    return compensateAuthUser(deps, operation.id, authUserId)
  }
}
