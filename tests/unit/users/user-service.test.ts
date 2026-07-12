import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  getCompanyUser,
  listCompanyUsers,
  updateCompanyUser,
} from "@/modules/users/server/user-service"

const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  ban: vi.fn(),
  unban: vi.fn(),
  completeAccessReconciliation: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    listCompanyUserDirectory: mocks.directory,
    getCompanyUser: mocks.getUser,
    completeMemberAuthAccessReconciliation: mocks.completeAccessReconciliation,
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ rpc: mocks.rpc })),
}))
vi.mock("@/modules/users/server/auth-admin-gateway", () => ({
  getAuthAdminGateway: vi.fn(() => ({
    banUser: mocks.ban,
    unbanUser: mocks.unban,
  })),
}))

const actor = {
  kind: "company",
  userId: randomUUID(),
  sessionId: randomUUID(),
  authenticatedAt: 1_800_000_000,
  companyId: randomUUID(),
  membershipId: randomUUID(),
  role: "company_admin",
  modules: [],
  profile: {
    displayName: "Admin",
    email: "admin@example.test",
    preferredTheme: "dark",
    version: 1,
  },
} satisfies Extract<AccessContext, { kind: "company" }>

function managed(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: randomUUID(),
    targetUserId: randomUUID(),
    displayName: "Pessoa Financeiro",
    email: "pessoa@example.test",
    role: "member",
    status: "active",
    modules: ["financial"],
    version: 2,
    mustChangePassword: false,
    temporaryPasswordExpiresAt: null,
    accessState: "active",
    ...overrides,
  }
}

beforeEach(() => {
  mocks.ban.mockResolvedValue(undefined)
  mocks.unban.mockResolvedValue(undefined)
  mocks.completeAccessReconciliation.mockImplementation(
    async ({ succeeded }: { succeeded: boolean }) => ({
      status: succeeded ? "completed" : "pending",
      desiredState: "active",
      attemptCount: 1,
    }),
  )
})

describe("company user service", () => {
  it("uses membership keyset pagination and returns a bounded page", async () => {
    const rows = Array.from({ length: 3 }, () => ({
      membershipId: randomUUID(),
      userId: randomUUID(),
      displayName: "Pessoa",
      email: "pessoa@example.test",
      role: "member",
      status: "active",
      modules: [],
      version: 1,
      createdAt: new Date().toISOString(),
    }))
    mocks.directory.mockResolvedValue(rows)

    await expect(listCompanyUsers({ actor, limit: 2 })).resolves.toEqual({
      items: rows.slice(0, 2),
      nextCursor: rows[1]!.membershipId,
    })
    expect(mocks.directory).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        limit: 3,
      }),
    )
  })

  it("maps an exact cross-tenant lookup to a neutral not-found", async () => {
    mocks.getUser.mockRejectedValue(new Error("AXSYS_MEMBERSHIP_NOT_FOUND"))
    await expect(
      getCompanyUser({ actor, membershipId: randomUUID() }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 })
  })

  it("maps an unknown directory cursor to a neutral validation error", async () => {
    mocks.directory.mockRejectedValue(
      new Error("company_directory_cursor_invalid"),
    )

    await expect(
      listCompanyUsers({ actor, cursor: randomUUID(), limit: 20 }),
    ).rejects.toMatchObject({ code: "CURSOR_INVALID", status: 422 })
  })

  it("commits membership state before reporting Auth reconciliation pending", async () => {
    const persisted = managed({ status: "suspended", accessState: "suspended" })
    mocks.rpc.mockResolvedValue({ data: persisted, error: null })
    mocks.ban.mockRejectedValue(new Error("Auth unavailable"))

    await expect(
      updateCompanyUser({
        actor,
        membershipId: String(persisted.membershipId),
        displayName: String(persisted.displayName),
        role: "member",
        status: "suspended",
        modules: ["financial"],
        suspensionReason: "Desligamento administrativo confirmado.",
        version: 1,
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      id: persisted.membershipId,
      status: "suspended",
      accessReconciliation: "pending",
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      "company_update_membership",
      expect.objectContaining({ p_membership_id: persisted.membershipId }),
    )
    expect(mocks.completeAccessReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        membershipId: persisted.membershipId,
        operationCorrelationId: expect.any(String),
        succeeded: false,
        errorCode: "AUTH_ADMIN_UNAVAILABLE",
        completionCorrelationId: expect.any(String),
      }),
    )
  })

  it("completes the durable marker only after Auth reaches the desired state", async () => {
    const persisted = managed({ status: "active", accessState: "active" })
    const operationCorrelationId = randomUUID()
    mocks.rpc.mockResolvedValue({ data: persisted, error: null })

    await expect(
      updateCompanyUser({
        actor,
        membershipId: String(persisted.membershipId),
        displayName: String(persisted.displayName),
        role: "member",
        status: "active",
        modules: ["financial"],
        suspensionReason: null,
        version: 1,
        correlationId: operationCorrelationId,
      }),
    ).resolves.toMatchObject({ accessReconciliation: "complete" })
    expect(mocks.unban).toHaveBeenCalledWith(persisted.targetUserId)
    expect(mocks.completeAccessReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: persisted.membershipId,
        operationCorrelationId,
        succeeded: true,
        errorCode: null,
      }),
    )
  })
})
