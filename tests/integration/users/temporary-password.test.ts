import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { createCompanyContext } from "../../helpers/auth"

type CompanyContext = ReturnType<typeof createCompanyContext>

type ProvisioningCommand = Readonly<{
  actor: CompanyContext
  companyId: string
  idempotencyKey: string
  correlationId: string
  input: {
    displayName: string
    email: string
    temporaryPassword: string
    role: "company_admin" | "member"
    modules: Array<"administrative" | "financial" | "certificates">
  }
  platformAdminOnly: false
}>

type ProvisioningDependencies = Readonly<{
  fingerprint?: (purpose: string, value: string) => string
  reserveProvisioning: ReturnType<typeof vi.fn>
  markAuthCreated: ReturnType<typeof vi.fn>
  commitProvisioning: ReturnType<typeof vi.fn>
  markCompensation: ReturnType<typeof vi.fn>
  authAdmin: {
    createUser: ReturnType<typeof vi.fn>
    deleteUser: ReturnType<typeof vi.fn>
    banUser: ReturnType<typeof vi.fn>
  }
}>

type ProvisionerModule = Readonly<{
  provisionCompanyUser(
    dependencies: ProvisioningDependencies,
    command: ProvisioningCommand,
  ): Promise<Record<string, unknown>>
}>

type ResetDependencies = Readonly<{
  requireRecentAuthentication: ReturnType<typeof vi.fn>
  setTemporaryPassword: ReturnType<typeof vi.fn>
}>

type UserServiceModule = Readonly<{
  resetCompanyUserTemporaryPassword(
    dependencies: ResetDependencies,
    command: Readonly<{
      actor: CompanyContext
      targetUserId: string
      temporaryPassword: string
      reasonCode:
        | "ADMIN_RESET_USER_REQUEST"
        | "ADMIN_RESET_ACCESS_RECOVERY"
        | "ADMIN_RESET_SECURITY_INCIDENT"
        | "ADMIN_RESET_ADMINISTRATIVE_CORRECTION"
      correlationId: string
    }>,
  ): Promise<Record<string, unknown>>
}>


const fixtures = {
  actorMembershipId: "81000000-0000-4000-8000-000000000001",
  actorUserId: "82000000-0000-4000-8000-000000000001",
  companyId: "83000000-0000-4000-8000-000000000001",
  correlationId: "84000000-0000-4000-8000-000000000001",
  operationId: "85000000-0000-4000-8000-000000000001",
  targetMembershipId: "81000000-0000-4000-8000-000000000002",
  targetUserId: "82000000-0000-4000-8000-000000000002",
} as const

const TEMPORARY_PASSWORD = "Frase provisória forte 42!"
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()

const moduleLoaders = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<ProvisionerModule | UserServiceModule>(
  "/src/modules/users/server/{user-provisioner,user-service}.ts",
)


async function loadProvisioner(): Promise<ProvisionerModule> {
  const load = moduleLoaders["/src/modules/users/server/user-provisioner.ts"]
  if (!load) throw new Error("Missing service module: user-provisioner.ts")
  return (await load()) as ProvisionerModule
}

async function loadUserService(): Promise<UserServiceModule> {
  const load = moduleLoaders["/src/modules/users/server/user-service.ts"]
  if (!load) throw new Error("Missing service module: user-service.ts")
  return (await load()) as UserServiceModule
}


function actor(authenticatedAt = Math.floor(Date.now() / 1_000)): CompanyContext {
  return Object.freeze({
    ...createCompanyContext(),
    userId: fixtures.actorUserId,
    membershipId: fixtures.actorMembershipId,
    companyId: fixtures.companyId,
    authenticatedAt,
    modules: Object.freeze([]),
  })
}

function command(): ProvisioningCommand {
  return {
    actor: actor(),
    companyId: fixtures.companyId,
    idempotencyKey: "company-user-create-00000001",
    correlationId: fixtures.correlationId,
    input: {
      displayName: "Pessoa Financeiro",
      email: "pessoa@example.test",
      temporaryPassword: TEMPORARY_PASSWORD,
      role: "member",
      modules: ["financial"],
    },
    platformAdminOnly: false,
  }
}

function provisioningDependencies(): ProvisioningDependencies {
  return {
    fingerprint: (purpose, value) =>
      `${purpose}:${Buffer.from(value).toString("base64url")}`,
    reserveProvisioning: vi.fn(async () => ({
      operationId: fixtures.operationId,
      status: "reserved",
    })),
    markAuthCreated: vi.fn(async () => undefined),
    commitProvisioning: vi.fn(async () => ({
      id: fixtures.targetMembershipId,
      userId: fixtures.targetUserId,
      companyId: fixtures.companyId,
      displayName: "Pessoa Financeiro",
      role: "member",
      modules: ["financial"],
      status: "active",
      version: 1,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: expiresAt,
    })),
    markCompensation: vi.fn(async () => undefined),
    authAdmin: {
      createUser: vi.fn(async () => ({ id: fixtures.targetUserId })),
      deleteUser: vi.fn(async () => undefined),
      banUser: vi.fn(async () => undefined),
    },
  }
}


beforeEach(() => {
  vi.clearAllMocks()
})

describe.sequential("Task 7 provisional company-user creation contract", () => {
  it("creates Auth on the server and commits profile, membership, modules, and 24-hour expiry as one unit", async () => {
    const { provisionCompanyUser } = await loadProvisioner()
    const dependencies = provisioningDependencies()
    const input = command()
    const startedAt = Date.now()

    const result = await provisionCompanyUser(dependencies, input)

    expect(dependencies.reserveProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: fixtures.actorUserId,
        companyId: fixtures.companyId,
        displayName: input.input.displayName,
        email: input.input.email,
        role: "member",
        modules: ["financial"],
      }),
    )
    expect(dependencies.authAdmin.createUser).toHaveBeenCalledWith({
      email: input.input.email,
      password: TEMPORARY_PASSWORD,
      emailConfirm: true,
      provisioningOperationId: fixtures.operationId,
    })
    expect(dependencies.markAuthCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixtures.operationId,
        authUserId: fixtures.targetUserId,
      }),
    )
    expect(dependencies.commitProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixtures.operationId,
        authUserId: fixtures.targetUserId,
        companyId: fixtures.companyId,
        displayName: input.input.displayName,
        role: "member",
        modules: ["financial"],
      }),
    )
    expect(dependencies.authAdmin.createUser.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.commitProvisioning.mock.invocationCallOrder[0],
    )
    const expiry = Date.parse(String(result.temporaryPasswordExpiresAt))
    expect(expiry).toBeGreaterThan(startedAt + 23 * 60 * 60 * 1_000)
    expect(expiry).toBeLessThanOrEqual(startedAt + 24 * 60 * 60 * 1_000 + 1_000)
    expect(result).toMatchObject({
      mustChangePassword: true,
      modules: ["financial"],
      role: "member",
      status: "active",
    })
  })

  it("deletes the just-created Auth identity and records compensation when the atomic commit fails", async () => {
    const { provisionCompanyUser } = await loadProvisioner()
    const dependencies = provisioningDependencies()
    dependencies.commitProvisioning.mockRejectedValueOnce(
      new Error(`database rejected ${TEMPORARY_PASSWORD}`),
    )

    let thrown: unknown
    try {
      await provisionCompanyUser(dependencies, command())
    } catch (error) {
      thrown = error
    }

    expect(dependencies.authAdmin.deleteUser).toHaveBeenCalledWith(
      fixtures.targetUserId,
    )
    expect(dependencies.markCompensation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixtures.operationId,
        status: "compensated",
      }),
    )
    expect(JSON.stringify(thrown)).not.toContain(TEMPORARY_PASSWORD)
  })

  it("bans the orphan and leaves reconciliation required if Auth deletion fails", async () => {
    const { provisionCompanyUser } = await loadProvisioner()
    const dependencies = provisioningDependencies()
    dependencies.commitProvisioning.mockRejectedValueOnce(new Error("commit failed"))
    dependencies.authAdmin.deleteUser.mockRejectedValueOnce(new Error("delete failed"))

    await expect(provisionCompanyUser(dependencies, command())).rejects.toBeDefined()

    expect(dependencies.authAdmin.banUser).toHaveBeenCalledWith(fixtures.targetUserId)
    expect(dependencies.markCompensation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixtures.operationId,
        status: "compensation_required",
      }),
    )
  })
})

describe.sequential("Task 7 administrative reset adapter contract", () => {
  it("rejects self reset before recent-authentication or credential mutation", async () => {
    const { resetCompanyUserTemporaryPassword } = await loadUserService()
    const context = actor()
    const dependencies: ResetDependencies = {
      requireRecentAuthentication: vi.fn(),
      setTemporaryPassword: vi.fn(),
    }

    await expect(
      resetCompanyUserTemporaryPassword(dependencies, {
        actor: context,
        targetUserId: context.userId,
        temporaryPassword: TEMPORARY_PASSWORD,
        reasonCode: "ADMIN_RESET_USER_REQUEST",
        correlationId: fixtures.correlationId,
      }),
    ).rejects.toMatchObject({ code: "SELF_PASSWORD_RESET", status: 403 })
    expect(dependencies.requireRecentAuthentication).not.toHaveBeenCalled()
    expect(dependencies.setTemporaryPassword).not.toHaveBeenCalled()
  })

  it("requires recent authentication with a 600-second maximum before reset", async () => {
    const { resetCompanyUserTemporaryPassword } = await loadUserService()
    const dependencies: ResetDependencies = {
      requireRecentAuthentication: vi.fn(() => {
        throw new ApiError(
          "REAUTHENTICATION_REQUIRED",
          403,
          "Confirme sua senha novamente para continuar.",
        )
      }),
      setTemporaryPassword: vi.fn(),
    }

    await expect(
      resetCompanyUserTemporaryPassword(dependencies, {
        actor: actor(Math.floor(Date.now() / 1_000) - 601),
        targetUserId: fixtures.targetUserId,
        temporaryPassword: TEMPORARY_PASSWORD,
        reasonCode: "ADMIN_RESET_USER_REQUEST",
        correlationId: fixtures.correlationId,
      }),
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" })
    expect(dependencies.requireRecentAuthentication).toHaveBeenCalledWith(
      expect.any(Object),
      600,
    )
    expect(dependencies.setTemporaryPassword).not.toHaveBeenCalled()
  })

  it("delegates to the existing fail-closed saga and never leaks the password on failure", async () => {
    const { resetCompanyUserTemporaryPassword } = await loadUserService()
    const capturedLogs: string[] = []
    const consoleError = vi.spyOn(console, "error").mockImplementation((...values) => {
      capturedLogs.push(values.map(String).join(" "))
    })
    const dependencies: ResetDependencies = {
      requireRecentAuthentication: vi.fn(),
      setTemporaryPassword: vi.fn(async () => {
        throw Object.assign(new Error("Redefinição pendente de reconciliação."), {
          code: "TEMPORARY_PASSWORD_RETRY_REQUIRED",
          operationId: fixtures.operationId,
          operationStatus: "failed",
        })
      }),
    }

    let thrown: unknown
    try {
      await resetCompanyUserTemporaryPassword(dependencies, {
        actor: actor(),
        targetUserId: fixtures.targetUserId,
        temporaryPassword: TEMPORARY_PASSWORD,
        reasonCode: "ADMIN_RESET_USER_REQUEST",
        correlationId: fixtures.correlationId,
      })
    } catch (error) {
      thrown = error
    } finally {
      consoleError.mockRestore()
    }

    expect(dependencies.setTemporaryPassword).toHaveBeenCalledWith({
      actor: expect.any(Object),
      targetUserId: fixtures.targetUserId,
      password: TEMPORARY_PASSWORD,
      reasonCode: "ADMIN_RESET_USER_REQUEST",
      correlationId: fixtures.correlationId,
    })
    expect(thrown).toMatchObject({
      code: "TEMPORARY_PASSWORD_RETRY_REQUIRED",
      operationStatus: "failed",
    })
    expect(JSON.stringify(thrown)).not.toContain(TEMPORARY_PASSWORD)
    expect(capturedLogs.join("\n")).not.toContain(TEMPORARY_PASSWORD)
  })
})
