import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { provisionCompany } from "@/modules/companies/server/company-provisioner"
import type { CreateCompanyInput } from "@/modules/companies/schemas/company-schemas"

const input = {
  legalName: "Axsys Serviços Ltda.",
  tradeName: "Axsys",
  cnpj: "11222333000181",
  contactEmail: "contato@example.com",
  contactPhone: null,
  timezone: "America/Fortaleza",
  firstAdmin: {
    displayName: "Maria Administradora",
    email: "maria@example.com",
    temporaryPassword: "frase provisoria segura 2026",
    modules: ["administrative", "financial"],
  },
} satisfies CreateCompanyInput

function fixture() {
  const operationId = randomUUID()
  const authUserId = randomUUID()
  const companyId = randomUUID()
  const result = {
    company: { id: companyId, status: "active" as const },
    membership: { id: randomUUID(), role: "company_admin" as const },
    modules: [...input.firstAdmin.modules],
  }
  const repository = {
    reserve: vi.fn().mockResolvedValue({ id: operationId, status: "reserved" }),
    markAuthCreated: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(result),
    markCompensated: vi.fn().mockResolvedValue(undefined),
    markCompensationRequired: vi.fn().mockResolvedValue(undefined),
  }
  const auth = {
    createUser: vi.fn().mockResolvedValue({ id: authUserId }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    banUser: vi.fn().mockResolvedValue(undefined),
  }
  return {
    operationId,
    authUserId,
    companyId,
    result,
    repository,
    auth,
    uuid: vi.fn(() => companyId),
  }
}

const command = {
  actorUserId: randomUUID(),
  sessionId: randomUUID(),
  idempotencyKey: "idempotency-key-2026-0001",
  correlationId: randomUUID(),
  input,
}

describe("company provisioner", () => {
  it("creates Auth before committing the company and returns persisted data", async () => {
    const deps = fixture()
    await expect(
      provisionCompany({ ...deps, fingerprint: vi.fn(() => "a".repeat(64)) }, command),
    ).resolves.toEqual(deps.result)
    expect(deps.auth.createUser).toHaveBeenCalledWith({
      email: "maria@example.com",
      password: "frase provisoria segura 2026",
      emailConfirm: true,
    })
    expect(deps.repository.markAuthCreated).toHaveBeenCalledWith({
      operationId: deps.operationId,
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      authUserId: deps.authUserId,
    })
    expect(deps.repository.commit.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.auth.createUser.mock.invocationCallOrder[0]!,
    )
  })

  it("deletes Auth and marks compensation when SQL commit fails", async () => {
    const deps = fixture()
    deps.repository.commit.mockRejectedValue(new Error("unique cnpj details"))

    await expect(
      provisionCompany({ ...deps, fingerprint: vi.fn(() => "b".repeat(64)) }, command),
    ).rejects.toMatchObject({ code: "COMPANY_CREATE_FAILED" })
    expect(deps.auth.deleteUser).toHaveBeenCalledWith(deps.authUserId)
    expect(deps.repository.markCompensated).toHaveBeenCalledWith({
      operationId: deps.operationId,
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      reason: "DB_COMMIT_FAILED",
    })
  })

  it("replays a committed operation without creating another Auth user", async () => {
    const deps = fixture()
    deps.repository.reserve.mockResolvedValue({
      id: deps.operationId,
      status: "committed",
      authUserId: deps.authUserId,
    })

    await expect(
      provisionCompany({ ...deps, fingerprint: vi.fn(() => "e".repeat(64)) }, command),
    ).resolves.toEqual(deps.result)
    expect(deps.auth.createUser).not.toHaveBeenCalled()
    expect(deps.repository.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: deps.operationId,
        authUserId: deps.authUserId,
      }),
    )
  })

  it("bans an orphan and schedules reconciliation if deletion fails", async () => {
    const deps = fixture()
    deps.repository.commit.mockRejectedValue(new Error("database unavailable"))
    deps.auth.deleteUser.mockRejectedValue(new Error("auth unavailable"))

    await expect(
      provisionCompany({ ...deps, fingerprint: vi.fn(() => "c".repeat(64)) }, command),
    ).rejects.toMatchObject({
      code: "COMPANY_CREATE_COMPENSATION_PENDING",
    })
    expect(deps.auth.banUser).toHaveBeenCalledWith(deps.authUserId)
    expect(deps.repository.markCompensationRequired).toHaveBeenCalledWith({
      operationId: deps.operationId,
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      reason: "AUTH_DELETE_FAILED",
    })
  })

  it("rejects weak provisional passwords before reserving the saga", async () => {
    const deps = fixture()
    await expect(
      provisionCompany(
        { ...deps, fingerprint: vi.fn(() => "d".repeat(64)) },
        {
          ...command,
          input: {
            ...input,
            firstAdmin: { ...input.firstAdmin, temporaryPassword: "curta" },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_WEAK" })
    expect(deps.repository.reserve).not.toHaveBeenCalled()
    expect(deps.auth.createUser).not.toHaveBeenCalled()
  })
})
