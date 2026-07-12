import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  provisionCompanyUser,
  type CompanyUserDto,
  type UserProvisioningDependencies,
} from "@/modules/users/server/user-provisioner"

const ids = {
  actor: randomUUID(),
  session: randomUUID(),
  company: randomUUID(),
  otherCompany: randomUUID(),
  operation: randomUUID(),
  user: randomUUID(),
  membership: randomUUID(),
  correlation: randomUUID(),
}

const profile = {
  displayName: "Administradora",
  email: "admin@example.test",
  preferredTheme: "dark" as const,
  version: 1,
}

const companyActor = {
  kind: "company",
  userId: ids.actor,
  sessionId: ids.session,
  authenticatedAt: 1_800_000_000,
  companyId: ids.company,
  membershipId: randomUUID(),
  role: "company_admin",
  modules: [],
  profile,
} satisfies AccessContext

const platformActor = {
  kind: "platform",
  userId: ids.actor,
  sessionId: ids.session,
  authenticatedAt: 1_800_000_000,
  profile,
} satisfies AccessContext

const input = {
  displayName: "Pessoa Financeiro",
  email: "pessoa@example.test",
  temporaryPassword: "Frase provisoria forte 42!",
  role: "member" as const,
  modules: ["financial" as const],
}

function fixture() {
  const result = {
    id: ids.membership,
    userId: ids.user,
    companyId: ids.company,
    displayName: input.displayName,
    role: input.role,
    modules: [...input.modules],
    status: "active" as const,
    version: 1,
    mustChangePassword: true as const,
    temporaryPasswordExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  } satisfies CompanyUserDto
  const reserveProvisioning =
    vi.fn<UserProvisioningDependencies["reserveProvisioning"]>(async () => ({
      operationId: ids.operation,
      status: "reserved",
    }))
  const commitProvisioning =
    vi.fn<UserProvisioningDependencies["commitProvisioning"]>(async () => result)
  const findProvisionedUser = vi.fn<
    NonNullable<
      UserProvisioningDependencies["authAdmin"]["findProvisionedUser"]
    >
  >(async () => null)
  const dependencies = {
    reserveProvisioning,
    markAuthCreated:
      vi.fn<UserProvisioningDependencies["markAuthCreated"]>(async () => undefined),
    commitProvisioning,
    markCompensation:
      vi.fn<UserProvisioningDependencies["markCompensation"]>(async () => undefined),
    authAdmin: {
      createUser: vi.fn<
        UserProvisioningDependencies["authAdmin"]["createUser"]
      >(async () => ({ id: ids.user })),
      findProvisionedUser,
      deleteUser: vi.fn<
        UserProvisioningDependencies["authAdmin"]["deleteUser"]
      >(async () => undefined),
      banUser: vi.fn<UserProvisioningDependencies["authAdmin"]["banUser"]>(
        async () => undefined,
      ),
    },
    fingerprint: vi.fn((purpose: string, value: string) =>
      `${purpose}:${Buffer.from(value).toString("base64url")}`,
    ),
  }
  return { dependencies, result }
}

function command(
  actor: AccessContext = companyActor,
  overrides: Record<string, unknown> = {},
) {
  return {
    actor,
    companyId: ids.otherCompany,
    idempotencyKey: "create-user-2026-00000001",
    correlationId: ids.correlation,
    input,
    platformAdminOnly: false,
    ...overrides,
  }
}

describe("user provisioner", () => {
  it("derives the tenant from the company actor and never persists the password", async () => {
    const { dependencies, result } = fixture()

    await expect(
      provisionCompanyUser(dependencies, command()),
    ).resolves.toEqual(result)

    expect(dependencies.reserveProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ids.actor,
        sessionId: ids.session,
        companyId: ids.company,
        role: "member",
        modules: ["financial"],
      }),
    )
    expect(dependencies.commitProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ids.company }),
    )
    expect(JSON.stringify(dependencies.reserveProvisioning.mock.calls)).not.toContain(
      input.temporaryPassword,
    )
    expect(JSON.stringify(dependencies.commitProvisioning.mock.calls)).not.toContain(
      input.temporaryPassword,
    )
  })

  it("uses exact domain-separated fingerprints for idempotency and the protected request", async () => {
    const { dependencies } = fixture()
    await provisionCompanyUser(dependencies, command())

    expect(dependencies.fingerprint).toHaveBeenCalledWith(
      "company-user-idempotency-key",
      "create-user-2026-00000001",
    )
    expect(dependencies.fingerprint).toHaveBeenCalledWith(
      "company-user-temporary-password",
      input.temporaryPassword,
    )
    expect(dependencies.fingerprint).toHaveBeenCalledWith(
      "company-user-email",
      input.email,
    )
    expect(dependencies.reserveProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKeyHash: expect.any(String),
        requestHash: expect.any(String),
        subjectEmailHash: expect.any(String),
      }),
    )
  })

  it("uses the requested tenant for a platform actor and forces the admin-only path", async () => {
    const { dependencies, result } = fixture()
    dependencies.commitProvisioning.mockResolvedValue({
      ...result,
      companyId: ids.otherCompany,
      role: "company_admin",
    })

    await provisionCompanyUser(
      dependencies,
      command(platformActor, {
        platformAdminOnly: true,
        input: { ...input, role: "company_admin" },
      }),
    )

    expect(dependencies.reserveProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: ids.otherCompany,
        role: "company_admin",
        platformAdminOnly: true,
      }),
    )
  })

  it("rejects a member role on the platform admin-only path before reservation", async () => {
    const { dependencies } = fixture()

    await expect(
      provisionCompanyUser(
        dependencies,
        command(platformActor, { platformAdminOnly: true }),
      ),
    ).rejects.toMatchObject({ code: "PLATFORM_ADMIN_ROLE_REQUIRED", status: 422 })
    expect(dependencies.reserveProvisioning).not.toHaveBeenCalled()
  })

  it("rejects mismatched actor paths and non-admin company actors", async () => {
    const first = fixture()
    await expect(
      provisionCompanyUser(first.dependencies, command(platformActor)),
    ).rejects.toMatchObject({ code: "USER_PROVISIONING_FORBIDDEN", status: 403 })

    const second = fixture()
    await expect(
      provisionCompanyUser(
        second.dependencies,
        command({ ...companyActor, role: "member" }),
      ),
    ).rejects.toMatchObject({ code: "USER_PROVISIONING_FORBIDDEN", status: 403 })
    expect(first.dependencies.reserveProvisioning).not.toHaveBeenCalled()
    expect(second.dependencies.reserveProvisioning).not.toHaveBeenCalled()
  })

  it("validates a weak password before reserving the operation", async () => {
    const { dependencies } = fixture()
    await expect(
      provisionCompanyUser(
        dependencies,
        command(companyActor, { input: { ...input, temporaryPassword: "curta" } }),
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_WEAK" })
    expect(dependencies.reserveProvisioning).not.toHaveBeenCalled()
  })

  it("recovers an Auth identity carrying the exact operation marker", async () => {
    const { dependencies, result } = fixture()
    dependencies.authAdmin.createUser.mockRejectedValue(
      Object.assign(new Error("private duplicate"), { code: "user_already_exists" }),
    )
    dependencies.authAdmin.findProvisionedUser.mockResolvedValue({ id: ids.user })

    await expect(provisionCompanyUser(dependencies, command())).resolves.toEqual(result)
    expect(dependencies.authAdmin.findProvisionedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: ids.operation,
        subjectEmailHash: expect.any(String),
        fingerprintEmail: expect.any(Function),
      }),
    )
    expect(dependencies.markAuthCreated).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: ids.user }),
    )
  })

  it("resumes an auth-created operation without creating a second Auth identity", async () => {
    const { dependencies, result } = fixture()
    dependencies.reserveProvisioning.mockResolvedValue({
      operationId: ids.operation,
      status: "auth_created",
      authUserId: ids.user,
    })

    await expect(provisionCompanyUser(dependencies, command())).resolves.toEqual(result)
    expect(dependencies.authAdmin.createUser).not.toHaveBeenCalled()
    expect(dependencies.commitProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: ids.user }),
    )
  })

  it("compensates a definitive commit failure without leaking its sensitive detail", async () => {
    const { dependencies } = fixture()
    dependencies.commitProvisioning.mockRejectedValue(
      Object.assign(new Error(`constraint rejected ${input.temporaryPassword}`), {
        code: "23514",
      }),
    )

    let thrown: unknown
    try {
      await provisionCompanyUser(dependencies, command())
    } catch (error) {
      thrown = error
    }
    expect(dependencies.authAdmin.deleteUser).toHaveBeenCalledWith(ids.user)
    expect(dependencies.markCompensation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "compensated" }),
    )
    expect(JSON.stringify(thrown)).not.toContain(input.temporaryPassword)
  })

  it("bans an orphan and marks reconciliation when Auth deletion fails", async () => {
    const { dependencies } = fixture()
    dependencies.commitProvisioning.mockRejectedValue(
      Object.assign(new Error("constraint"), { code: "23514" }),
    )
    dependencies.authAdmin.deleteUser.mockRejectedValue(new Error("unavailable"))

    await expect(provisionCompanyUser(dependencies, command())).rejects.toMatchObject({
      code: "USER_CREATE_COMPENSATION_PENDING",
    })
    expect(dependencies.authAdmin.banUser).toHaveBeenCalledWith(ids.user)
    expect(dependencies.markCompensation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "compensation_required" }),
    )
  })

  it("never deletes Auth after an ambiguous commit outcome", async () => {
    const { dependencies } = fixture()
    dependencies.commitProvisioning.mockRejectedValue(new Error("connection lost"))
    dependencies.reserveProvisioning
      .mockResolvedValueOnce({ operationId: ids.operation, status: "reserved" })
      .mockResolvedValueOnce({
        operationId: ids.operation,
        status: "auth_created",
        authUserId: ids.user,
      })

    await expect(provisionCompanyUser(dependencies, command())).rejects.toMatchObject({
      code: "USER_CREATE_RETRY_REQUIRED",
    })
    expect(dependencies.authAdmin.deleteUser).not.toHaveBeenCalled()
    expect(dependencies.authAdmin.banUser).not.toHaveBeenCalled()
  })
})
