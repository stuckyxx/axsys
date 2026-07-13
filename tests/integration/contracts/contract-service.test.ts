import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../helpers/auth"

const repository = vi.hoisted(() => ({
  closeContractRecord: vi.fn(),
  contractHasAttachments: vi.fn(),
  createContractRecord: vi.fn(),
  deleteContractRecord: vi.fn(),
  getCompanyTimezone: vi.fn(async () => "America/Fortaleza"),
  getContractRow: vi.fn(),
  listContractRows: vi.fn(),
  updateContractRecord: vi.fn(),
}))

vi.mock("@/modules/contracts/server/contract-repository", () => repository)

import { listContracts } from "@/modules/contracts/server/contract-service"

const base = {
  id: "74000000-0000-4000-8000-000000000001",
  clientId: "71000000-0000-4000-8000-000000000001",
  clientName: "Município de Horizonte",
  number: "CT-2026-017",
  object: "Prestação de serviços técnicos",
  startsOn: "2026-01-01",
  endsOn: "2026-08-24",
  amount: "12500.00",
  closeReason: null,
  version: 1,
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-01T12:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  repository.getCompanyTimezone.mockResolvedValue("America/Fortaleza")
  repository.listContractRows.mockResolvedValue({
    items: [
      { ...base, closedAt: null },
      {
        ...base,
        id: "74000000-0000-4000-8000-000000000002",
        closedAt: "2026-07-10T02:30:00.000Z",
        closeReason: "Encerramento",
      },
    ],
    nextCursor: null,
  })
})

describe("contract request temporal snapshot", () => {
  it("reads the injected clock once and reuses one company-local today", async () => {
    const clock = {
      now: vi.fn(() => new Date("2026-07-10T12:00:00.000Z")),
    }
    const context = createCompanyContext()

    const result = await listContracts({ context, limit: 25, clock })

    expect(clock.now).toHaveBeenCalledTimes(1)
    expect(repository.getCompanyTimezone).toHaveBeenCalledWith(context)
    expect(repository.listContractRows).toHaveBeenCalledWith(
      expect.objectContaining({ context, limit: 25, today: "2026-07-10" }),
    )
    expect(result.items[0]).toMatchObject({
      closedOn: null,
      status: "expiring",
    })
    expect(result.items[1]).toMatchObject({
      closedOn: "2026-07-09",
      status: "closed",
    })
  })
})
