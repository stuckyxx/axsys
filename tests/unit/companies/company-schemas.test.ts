import { describe, expect, it } from "vitest"

import {
  createCompanySchema,
  updateCompanySchema,
} from "@/modules/companies/schemas/company-schemas"

const valid = {
  legalName: " Axsys Serviços Ltda. ",
  tradeName: " Axsys ",
  cnpj: "11.222.333/0001-81",
  contactEmail: " CONTATO@EXAMPLE.COM ",
  contactPhone: "+55 85 99999-0000",
  timezone: "Brazil/East",
  firstAdmin: {
    displayName: " Maria Administradora ",
    email: " MARIA@EXAMPLE.COM ",
    temporaryPassword: "frase provisoria segura 2026",
    modules: ["financial", "administrative", "financial"],
  },
}

describe("company schemas", () => {
  it("normalizes CNPJ, emails, modules and canonical timezone", () => {
    expect(createCompanySchema.parse(valid)).toEqual({
      ...valid,
      legalName: "Axsys Serviços Ltda.",
      tradeName: "Axsys",
      cnpj: "11222333000181",
      contactEmail: "contato@example.com",
      contactPhone: "+55 85 99999-0000",
      timezone: "America/Sao_Paulo",
      firstAdmin: {
        ...valid.firstAdmin,
        displayName: "Maria Administradora",
        email: "maria@example.com",
        modules: ["administrative", "financial"],
      },
    })
  })

  it("rejects invalid CNPJ, timezone aliases, and protected fields", () => {
    expect(() => createCompanySchema.parse({ ...valid, cnpj: "11111111111111" })).toThrow()
    expect(() => createCompanySchema.parse({ ...valid, timezone: "BRT" })).toThrow()
    expect(() =>
      createCompanySchema.parse({ ...valid, status: "active" }),
    ).toThrow()
  })

  it("requires optimistic version and accepts only editable company fields", () => {
    expect(
      updateCompanySchema.parse({
        legalName: "Axsys Serviços Ltda.",
        tradeName: "Axsys",
        contactEmail: "CONTATO@EXAMPLE.COM",
        contactPhone: null,
        timezone: "America/Fortaleza",
        version: 3,
      }),
    ).toMatchObject({ contactEmail: "contato@example.com", version: 3 })
    expect(() =>
      updateCompanySchema.parse({
        legalName: "Axsys Serviços Ltda.",
        tradeName: "Axsys",
        contactEmail: "contato@example.com",
        contactPhone: null,
        timezone: "America/Fortaleza",
        version: 3,
        cnpj: "11222333000181",
      }),
    ).toThrow()
  })
})
