import { describe, expect, it } from "vitest"

import {
  clientCreateSchema,
  clientUpdateSchema,
} from "@/modules/administrative/schemas/client-input"

const validClient = {
  legalName: "  Axsys Tecnologia Ltda  ",
  tradeName: "  Axsys  ",
  cnpj: "04.252.011/0001-10",
  segment: "  Tecnologia  ",
  email: "  CONTATO@AXSYS.COM.BR  ",
  phone: "  (85) 3333-2222  ",
  addressStreet: "  Rua Central  ",
  addressNumber: "  100  ",
  addressComplement: "  Sala 2  ",
  addressNeighborhood: "  Centro  ",
  municipality: "  Fortaleza  ",
  state: " ce ",
  postalCode: "60.000-000",
}

describe("client input", () => {
  it("normalizes tenant-independent client input", () => {
    expect(clientCreateSchema.parse(validClient)).toEqual({
      legalName: "Axsys Tecnologia Ltda",
      tradeName: "Axsys",
      cnpj: "04252011000110",
      segment: "Tecnologia",
      email: "contato@axsys.com.br",
      phone: "(85) 3333-2222",
      addressStreet: "Rua Central",
      addressNumber: "100",
      addressComplement: "Sala 2",
      addressNeighborhood: "Centro",
      municipality: "Fortaleza",
      state: "CE",
      postalCode: "60000000",
    })
  })

  it("defaults optional database fields to null", () => {
    expect(clientCreateSchema.parse({
      legalName: "Axsys Tecnologia Ltda",
      cnpj: "04.252.011/0001-10",
      segment: "Tecnologia",
      municipality: "Fortaleza",
      state: "CE",
    })).toEqual({
      legalName: "Axsys Tecnologia Ltda",
      tradeName: null,
      cnpj: "04252011000110",
      segment: "Tecnologia",
      email: null,
      phone: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressNeighborhood: null,
      municipality: "Fortaleza",
      state: "CE",
      postalCode: null,
    })
  })

  it("normalizes blank optional email and postal code to null", () => {
    const parsed = clientCreateSchema.parse({
      legalName: "Axsys Tecnologia Ltda",
      cnpj: "04.252.011/0001-10",
      segment: "Tecnologia",
      email: "   ",
      municipality: "Fortaleza",
      state: "CE",
      postalCode: "   ",
    })
    expect(parsed.email).toBeNull()
    expect(parsed.postalCode).toBeNull()
  })

  it.each(["companyId", "createdBy", "archivedAt", "status", "total"])(
    "rejects protected field %s",
    (field) => {
      expect(() => clientCreateSchema.parse({ ...validClient, [field]: "injected" })).toThrow()
    },
  )

  it.each(["legalName", "segment", "municipality", "state"])(
    "requires %s",
    (field) => {
      const input = { ...validClient } as Record<string, unknown>
      delete input[field]
      expect(() => clientCreateSchema.parse(input)).toThrow()
    },
  )

  it("rejects invalid CNPJ and update versions below one", () => {
    expect(() => clientCreateSchema.parse({ ...validClient, cnpj: "04.252.011/0001-11" })).toThrow()
    expect(() => clientUpdateSchema.parse({ ...validClient, version: 0 })).toThrow()
    expect(clientUpdateSchema.parse({ ...validClient, version: 2 }).version).toBe(2)
  })
})
