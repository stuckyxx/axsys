import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  changeCompanyStatus,
  getCompanyDetail,
  updateCompany,
} from "@/modules/companies/server/company-service"

const mocks = vi.hoisted(() => ({
  updateCompany: vi.fn(),
  setCompanyStatus: vi.fn(),
  completeCompanyAccessReconciliation: vi.fn(),
  readCompanyDetail: vi.fn(),
  readCompanies: vi.fn(),
  getAuthAdminGateway: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    updateCompany: mocks.updateCompany,
    setCompanyStatus: mocks.setCompanyStatus,
    completeCompanyAccessReconciliation:
      mocks.completeCompanyAccessReconciliation,
  },
}))

vi.mock("@/modules/platform/server/platform-repository", () => ({
  getCompanyDetail: mocks.readCompanyDetail,
  listCompanies: mocks.readCompanies,
}))

vi.mock("@/modules/users/server/auth-admin-gateway", () => ({
  getAuthAdminGateway: mocks.getAuthAdminGateway,
}))

function platformContext(): Extract<AccessContext, { kind: "platform" }> {
  return {
    kind: "platform",
    userId: randomUUID(),
    sessionId: randomUUID(),
    authenticatedAt: Date.now(),
    profile: {
      displayName: "Operadora Plataforma",
      email: "operator@example.com",
      preferredTheme: "light",
      version: 1,
    },
  }
}

beforeEach(() => {
  mocks.completeCompanyAccessReconciliation.mockResolvedValue({
    status: "complete",
  })
  mocks.getAuthAdminGateway.mockReturnValue({
    banUser: mocks.banUser,
    unbanUser: mocks.unbanUser,
  })
  mocks.banUser.mockResolvedValue(undefined)
  mocks.unbanUser.mockResolvedValue(undefined)
})

describe("company service", () => {
  it("forwards actor, session, correlation, and editable fields when updating", async () => {
    const context = platformContext()
    const companyId = randomUUID()
    const correlationId = randomUUID()
    const persisted = { id: companyId, version: 8 }
    mocks.updateCompany.mockResolvedValue(persisted)

    await expect(
      updateCompany({
        context,
        companyId,
        correlationId,
        legalName: "Axsys Serviços Ltda.",
        tradeName: "Axsys",
        contactEmail: "contato@example.com",
        contactPhone: "+55 85 99999-0000",
        timezone: "America/Fortaleza",
        version: 7,
      }),
    ).resolves.toBe(persisted)

    expect(mocks.updateCompany).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      companyId,
      legalName: "Axsys Serviços Ltda.",
      tradeName: "Axsys",
      contactEmail: "contato@example.com",
      contactPhone: "+55 85 99999-0000",
      timezone: "America/Fortaleza",
      expectedVersion: 7,
      correlationId,
    })
  })

  it.each([
    { action: "archive" as const, targetStatus: "archived", method: "banUser" },
    { action: "reactivate" as const, targetStatus: "active", method: "unbanUser" },
  ])("forwards status metadata and reconciles affected IDs for $action", async ({
    action,
    targetStatus,
    method,
  }) => {
    const context = platformContext()
    const companyId = randomUUID()
    const correlationId = randomUUID()
    const affectedUserIds = [randomUUID(), randomUUID()]
    const reconciliationId = randomUUID()
    const company = { id: companyId, status: targetStatus }
    mocks.setCompanyStatus.mockResolvedValue({
      company,
      affectedUserIds,
      reconciliationId,
    })

    await expect(
      changeCompanyStatus({
        context,
        companyId,
        action,
        version: 4,
        reason: "Solicitação operacional",
        correlationId,
      }),
    ).resolves.toEqual({ company, accessReconciliation: "complete" })

    expect(mocks.setCompanyStatus).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      companyId,
      targetStatus,
      expectedVersion: 4,
      reason: "Solicitação operacional",
      correlationId,
    })
    const authMethod = method === "banUser" ? mocks.banUser : mocks.unbanUser
    expect(authMethod.mock.calls).toEqual(
      affectedUserIds.map((userId) => [userId]),
    )
    expect(mocks.completeCompanyAccessReconciliation).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      reconciliationId,
      failedUserIds: [],
      correlationId,
    })
  })

  it("runs Auth reconciliation in batches of at most ten", async () => {
    const context = platformContext()
    const affectedUserIds = Array.from({ length: 23 }, () => randomUUID())
    let active = 0
    let maxActive = 0
    mocks.banUser.mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
    })
    mocks.setCompanyStatus.mockResolvedValue({
      company: { id: randomUUID(), status: "archived" },
      affectedUserIds,
      reconciliationId: randomUUID(),
    })

    await changeCompanyStatus({
      context,
      companyId: randomUUID(),
      action: "archive",
      version: 1,
      reason: null,
      correlationId: randomUUID(),
    })

    expect(mocks.banUser).toHaveBeenCalledTimes(23)
    expect(maxActive).toBe(10)
  })

  it("bounds inline Auth work and persists the remaining users for retry", async () => {
    const context = platformContext()
    const affectedUserIds = Array.from({ length: 55 }, () => randomUUID())
    const reconciliationId = randomUUID()
    mocks.setCompanyStatus.mockResolvedValue({
      company: { id: randomUUID(), status: "archived" },
      affectedUserIds,
      reconciliationId,
    })
    mocks.completeCompanyAccessReconciliation.mockResolvedValue({
      status: "pending",
    })

    await changeCompanyStatus({
      context,
      companyId: randomUUID(),
      action: "archive",
      version: 1,
      reason: "Solicitação operacional",
      correlationId: randomUUID(),
    })

    expect(mocks.banUser).toHaveBeenCalledTimes(50)
    expect(mocks.completeCompanyAccessReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationId,
        failedUserIds: affectedUserIds.slice(50),
      }),
    )
  })

  it("returns pending after an Auth failure without rolling back persisted status", async () => {
    const context = platformContext()
    const company = { id: randomUUID(), status: "archived" as const }
    const affectedUserIds = [randomUUID(), randomUUID(), randomUUID()]
    const reconciliationId = randomUUID()
    mocks.setCompanyStatus.mockResolvedValue({
      company,
      affectedUserIds,
      reconciliationId,
    })
    mocks.banUser.mockRejectedValueOnce(new Error("private Auth outage"))
    mocks.completeCompanyAccessReconciliation.mockResolvedValue({
      status: "pending",
    })

    await expect(
      changeCompanyStatus({
        context,
        companyId: company.id,
        action: "archive",
        version: 3,
        reason: null,
        correlationId: randomUUID(),
      }),
    ).resolves.toEqual({ company, accessReconciliation: "pending" })

    expect(mocks.setCompanyStatus).toHaveBeenCalledOnce()
    expect(mocks.banUser).toHaveBeenCalledTimes(affectedUserIds.length)
    expect(mocks.setCompanyStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "active" }),
    )
    expect(mocks.completeCompanyAccessReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationId,
        failedUserIds: [affectedUserIds[0]],
      }),
    )
  })

  it("keeps the durable reconciliation pending when completion cannot be recorded", async () => {
    const context = platformContext()
    const company = { id: randomUUID(), status: "archived" as const }
    mocks.setCompanyStatus.mockResolvedValue({
      company,
      affectedUserIds: [randomUUID()],
      reconciliationId: randomUUID(),
    })
    mocks.completeCompanyAccessReconciliation.mockRejectedValue(
      new Error("database unavailable"),
    )

    await expect(
      changeCompanyStatus({
        context,
        companyId: company.id,
        action: "archive",
        version: 3,
        reason: "Solicitação operacional",
        correlationId: randomUUID(),
      }),
    ).resolves.toEqual({ company, accessReconciliation: "pending" })
    expect(mocks.setCompanyStatus).toHaveBeenCalledOnce()
  })

  it("maps a missing company to a neutral not-found error", async () => {
    mocks.readCompanyDetail.mockRejectedValue(
      new Error("AXSYS_COMPANY_NOT_FOUND"),
    )

    await expect(
      getCompanyDetail({
        context: platformContext(),
        companyId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
      status: 404,
      message: "Empresa não encontrada.",
    })
  })

  it("maps database timezone details to a neutral validation error", async () => {
    mocks.updateCompany.mockRejectedValue(
      new Error("AXSYS_INVALID_TIMEZONE"),
    )

    await expect(
      updateCompany({
        context: platformContext(),
        companyId: randomUUID(),
        correlationId: randomUUID(),
        legalName: "Axsys Serviços Ltda.",
        tradeName: "Axsys",
        contactEmail: "contato@example.com",
        contactPhone: null,
        timezone: "Etc/Private",
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_TIMEZONE",
      status: 422,
      message: "Fuso horário inválido.",
    })
  })
})
