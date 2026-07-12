import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findProvisioningAuthUser: vi.fn(),
  rawFindProvisionedUser: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    findProvisioningAuthUser: mocks.findProvisioningAuthUser,
  },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ rpc: mocks.rpc })),
}))

vi.mock("@/modules/users/server/auth-admin-gateway", () => ({
  getAuthAdminGateway: vi.fn(() => ({
    createUser: vi.fn(),
    findProvisionedUser: mocks.rawFindProvisionedUser,
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    deleteUser: vi.fn(),
  })),
}))

import { getCompanyProvisioningDependencies } from "@/modules/companies/server/company-provisioner"
import { getUserProvisioningDependencies } from "@/modules/users/server/user-provisioner"

const scope = {
  actorUserId: "27100000-0000-4000-8000-000000000001",
  sessionId: "97100000-0000-4000-8000-000000000001",
  operationId: "67100000-0000-4000-8000-000000000001",
  expectedEmail: "new-member@example.test",
}

describe("production provisioning identity recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("recovers a company member through the exact private BFF lookup", async () => {
    mocks.findProvisioningAuthUser.mockResolvedValue(
      "28100000-0000-4000-8000-000000000001",
    )
    const dependencies = getUserProvisioningDependencies()

    await expect(
      dependencies.authAdmin.findProvisionedUser?.({
        operationId: scope.operationId,
        subjectEmailHash: "a".repeat(64),
        fingerprintEmail: vi.fn(),
        actorUserId: scope.actorUserId,
        sessionId: scope.sessionId,
        expectedEmail: scope.expectedEmail,
      }),
    ).resolves.toEqual({ id: "28100000-0000-4000-8000-000000000001" })
    expect(mocks.findProvisioningAuthUser).toHaveBeenCalledWith(scope)
    expect(mocks.rawFindProvisionedUser).not.toHaveBeenCalled()
  })

  it("recovers a first company administrator without enumerating Auth", async () => {
    mocks.findProvisioningAuthUser.mockResolvedValue(null)
    const dependencies = getCompanyProvisioningDependencies()

    await expect(
      dependencies.auth.findProvisionedUser({
        operationId: scope.operationId,
        subjectEmailHash: "b".repeat(64),
        fingerprintEmail: vi.fn(),
        actorUserId: scope.actorUserId,
        sessionId: scope.sessionId,
        expectedEmail: scope.expectedEmail,
      }),
    ).resolves.toBeNull()
    expect(mocks.findProvisioningAuthUser).toHaveBeenCalledWith(scope)
    expect(mocks.rawFindProvisionedUser).not.toHaveBeenCalled()
  })

  it("rejects malformed authenticated reservation payloads at runtime", async () => {
    mocks.rpc.mockResolvedValue({
      data: { id: "not-a-uuid", status: "reserved", authUserId: null },
      error: null,
    })
    const dependencies = getUserProvisioningDependencies()

    await expect(
      dependencies.reserveProvisioning({
        actorUserId: scope.actorUserId,
        sessionId: scope.sessionId,
        companyId: "37100000-0000-4000-8000-000000000001",
        platformAdminOnly: false,
        idempotencyKeyHash: "a".repeat(64),
        requestHash: "b".repeat(64),
        subjectEmailHash: "c".repeat(64),
        correlationId: "87100000-0000-4000-8000-000000000001",
        displayName: "Novo Membro",
        email: scope.expectedEmail,
        role: "member",
        modules: ["financial"],
      }),
    ).rejects.toBeDefined()
  })

  it("rejects malformed authenticated commit payloads at runtime", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        membershipId: "not-a-uuid",
        targetUserId: "28100000-0000-4000-8000-000000000001",
        displayName: "Novo Membro",
        email: scope.expectedEmail,
        role: "member",
        status: "active",
        modules: ["financial"],
        version: 1,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: "2026-07-13T18:00:00.000Z",
        accessState: "password_change_required",
      },
      error: null,
    })
    const dependencies = getUserProvisioningDependencies()

    await expect(
      dependencies.commitProvisioning({
        actorUserId: scope.actorUserId,
        sessionId: scope.sessionId,
        companyId: "37100000-0000-4000-8000-000000000001",
        platformAdminOnly: false,
        operationId: scope.operationId,
        authUserId: "28100000-0000-4000-8000-000000000001",
        correlationId: "87100000-0000-4000-8000-000000000001",
        displayName: "Novo Membro",
        email: scope.expectedEmail,
        role: "member",
        modules: ["financial"],
      }),
    ).rejects.toBeDefined()
  })
})
