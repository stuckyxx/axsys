import { describe, expect, it } from "vitest"

import { proposalCreateSchema } from "@/modules/proposals/schemas/proposal-input"

const clientId = "891bdc44-90f0-4638-b65e-f4d8d434b732"
const serviceId = "6850d1bc-5990-4ead-aa94-e0e48e9f93d1"

describe("proposal input", () => {
  it("accepts strict service and product discriminants", () => {
    const parsed = proposalCreateSchema.parse({
      clientId,
      segment: "  Tecnologia  ",
      issuedOn: "2026-07-10",
      items: [
        { kind: "service", catalogItemId: serviceId, description: " Implantação ", months: 3, monthlyAmount: "1250.40" },
        { kind: "product", catalogItemId: crypto.randomUUID(), description: " Licença ", quantity: "2.555", unitAmount: "10.01" },
      ],
    })
    expect(parsed.segment).toBe("Tecnologia")
    expect(parsed.items[0]?.description).toBe("Implantação")
  })

  it.each(["1e2", "-1.00", "1.001", "1000000000000.00"])(
    "rejects invalid money %s",
    (monthlyAmount) => expect(() => proposalCreateSchema.parse({
      clientId, segment: "Tecnologia", issuedOn: "2026-07-10",
      items: [{ kind: "service", catalogItemId: serviceId, description: "Implantação", months: 3, monthlyAmount }],
    })).toThrow(),
  )

  it.each(["0", "1e2", "1.0001", "1000000000.000"])(
    "rejects invalid quantity %s",
    (quantity) => expect(() => proposalCreateSchema.parse({
      clientId, segment: "Tecnologia", issuedOn: "2026-07-10",
      items: [{ kind: "product", catalogItemId: serviceId, description: "Produto", quantity, unitAmount: "10.00" }],
    })).toThrow(),
  )

  it("rejects display data and segment claims inside item rows", () => {
    expect(() => proposalCreateSchema.parse({
      clientId, segment: "Tecnologia", issuedOn: "2026-07-10",
      items: [{ kind: "service", catalogItemId: serviceId, description: "Implantação", months: 3, monthlyAmount: "1.00", segment: "Outro" }],
    })).toThrow()
  })
})
