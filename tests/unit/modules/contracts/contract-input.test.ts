import { describe, expect, it } from "vitest"

import {
  closeContractSchema,
  contractCreateSchema,
  contractUpdateSchema,
  listContractSchema,
} from "@/modules/contracts/schemas/contract-input"

const valid = {
  clientId: "891bdc44-90f0-4638-b65e-f4d8d434b732",
  number: "  CT-2026/001  ",
  object: "  Prestação de serviços especializados  ",
  startsOn: "2026-07-10",
  endsOn: "2027-07-09",
  amount: "1250.40",
}

describe("contract input", () => {
  it("normalizes and accepts a valid contract", () => {
    expect(contractCreateSchema.parse(valid)).toEqual({ ...valid, number: "CT-2026/001", object: "Prestação de serviços especializados" })
  })

  it("requires end date on or after start and bounded Decimal money", () => {
    expect(() => contractCreateSchema.parse({ ...valid, endsOn: "2026-07-09" })).toThrow()
    expect(() => contractCreateSchema.parse({ ...valid, amount: "1000000000000.00" })).toThrow()
    expect(() => contractCreateSchema.parse({ ...valid, amount: "1e2" })).toThrow()
  })

  it("adds a positive version on update", () => {
    expect(() => contractUpdateSchema.parse({ ...valid, version: 0 })).toThrow()
    expect(contractUpdateSchema.parse({ ...valid, version: 4 }).version).toBe(4)
  })

  it("validates close reason and version", () => {
    expect(closeContractSchema.parse({ version: 2, reason: "  Encerramento antecipado  " })).toEqual({ version: 2, reason: "Encerramento antecipado" })
    expect(() => closeContractSchema.parse({ version: 0, reason: "ok" })).toThrow()
  })

  it("parses strict list filters and defaults limit", () => {
    expect(listContractSchema.parse({ q: "  CT-2026  ", clientId: valid.clientId, status: "expiring" })).toEqual({ q: "CT-2026", clientId: valid.clientId, status: "expiring", limit: 25 })
    expect(listContractSchema.parse({ limit: "100" }).limit).toBe(100)
    expect(() => listContractSchema.parse({ status: ["active", "expired"] })).toThrow()
    expect(() => listContractSchema.parse({ limit: 101 })).toThrow()
    expect(() => listContractSchema.parse({ companyId: crypto.randomUUID() })).toThrow()
  })
})
