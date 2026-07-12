import { describe, expect, it } from "vitest"

import {
  companySettingsDraftSchema,
  companySettingsSchema,
  formatCompanyAddressPreview,
} from "@/modules/settings/schemas/company-settings-schemas"

const valid = {
  representativeName: "  Maria da Silva ",
  representativeRole: " Diretora ",
  representativeDocument: "529.982.247-25",
  taxRate: 12.34,
  addressStreet: " Rua Central ",
  addressNumber: " 100 ",
  addressComplement: " ",
  addressNeighborhood: " Centro ",
  addressCity: " Fortaleza ",
  addressState: "ce",
  addressPostalCode: "60.000-000",
  letterheadFileId: null,
  signatureFileId: null,
  version: 2,
}

describe("company settings schema", () => {
  it("normalizes UF, CEP, CPF and empty optional strings", () => {
    expect(companySettingsSchema.parse(valid)).toEqual({
      ...valid,
      representativeName: "Maria da Silva",
      representativeRole: "Diretora",
      representativeDocument: "52998224725",
      addressStreet: "Rua Central",
      addressNumber: "100",
      addressComplement: null,
      addressNeighborhood: "Centro",
      addressCity: "Fortaleza",
      addressState: "CE",
      addressPostalCode: "60000000",
    })
  })

  it("rejects invalid CPF, tax precision, UF, CEP and protected fields", () => {
    expect(() =>
      companySettingsSchema.parse({
        ...valid,
        representativeDocument: "111.111.111-11",
      }),
    ).toThrow()
    expect(() =>
      companySettingsSchema.parse({ ...valid, taxRate: 12.345 }),
    ).toThrow()
    expect(() =>
      companySettingsSchema.parse({ ...valid, addressState: "XX" }),
    ).toThrow()
    expect(() =>
      companySettingsSchema.parse({ ...valid, addressPostalCode: "60000" }),
    ).toThrow()
    expect(() =>
      companySettingsSchema.parse({ ...valid, companyId: crypto.randomUUID() }),
    ).toThrow()
  })

  it("keeps drafts scoped to editable fields and base version", () => {
    const { version, ...editable } = valid
    expect(version).toBe(2)
    expect(
      companySettingsDraftSchema.parse({ ...editable, baseVersion: 2 }),
    ).toMatchObject({ baseVersion: 2, addressState: "CE" })
    expect(() =>
      companySettingsDraftSchema.parse({
        ...editable,
        baseVersion: 2,
        userId: crypto.randomUUID(),
      }),
    ).toThrow()
  })

  it("formats partial addresses without dangling separators", () => {
    expect(
      formatCompanyAddressPreview({
        street: "Rua Central",
        number: "100",
        complement: null,
        neighborhood: null,
        city: "Fortaleza",
        state: "CE",
        postalCode: "60000000",
      }),
    ).toBe("Rua Central, 100 · Fortaleza/CE · CEP 60000-000")
    expect(
      formatCompanyAddressPreview({
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: "Fortaleza",
        state: null,
        postalCode: null,
      }),
    ).toBe("Fortaleza")
  })
})
