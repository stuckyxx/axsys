import { describe, expect, it } from "vitest"

import {
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
} from "@/modules/administrative/schemas/catalog-item-input"

describe("catalog item input", () => {
  it.each(["service", "product"] as const)("accepts a trimmed %s", (itemKind) => {
    expect(catalogItemCreateSchema.parse({
      itemKind,
      segment: "  Tecnologia  ",
      name: "  Consultoria  ",
      description: "  Consultoria especializada  ",
    })).toEqual({
      itemKind,
      segment: "Tecnologia",
      name: "Consultoria",
      description: "Consultoria especializada",
    })
  })

  it("rejects unknown and protected fields", () => {
    expect(() => catalogItemCreateSchema.parse({
      itemKind: "service", segment: "Tecnologia", name: "Serviço",
      description: "Descrição", companyId: crypto.randomUUID(),
    })).toThrow()
    expect(() => catalogItemCreateSchema.parse({
      itemKind: "subscription", segment: "Tecnologia", name: "Serviço",
      description: "Descrição",
    })).toThrow()
  })

  it("requires a positive integer version on update", () => {
    const input = { itemKind: "product", segment: "Varejo", name: "Produto", description: "Descrição" }
    expect(() => catalogItemUpdateSchema.parse({ ...input, version: 0 })).toThrow()
    expect(catalogItemUpdateSchema.parse({ ...input, version: 3 }).version).toBe(3)
  })
})
