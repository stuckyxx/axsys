import { describe, expect, it } from "vitest"

import { isValidCnpj, normalizeCnpj } from "@/modules/administrative/domain/cnpj"

describe("CNPJ", () => {
  it("normalizes punctuation and validates both check digits", () => {
    expect(normalizeCnpj("04.252.011/0001-10")).toBe("04252011000110")
    expect(isValidCnpj("04.252.011/0001-10")).toBe(true)
  })

  it.each([
    "04.252.011/0001-11",
    "00.000.000/0000-00",
    "abcdefghijklmN",
    "0425201100011",
    "042520110001100",
  ])("rejects invalid CNPJ %s", (value) => {
    expect(isValidCnpj(value)).toBe(false)
  })
})
