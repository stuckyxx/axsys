import { describe, expect, it } from "vitest"

import {
  createBankAccountSchema,
  updateBankAccountSchema,
} from "@/modules/bank-accounts/schemas/bank-account-schemas"

const valid = {
  bankCode: "001",
  bankName: " Banco do Brasil ",
  branch: "1234-5",
  account: "987654-3",
  accountType: "checking",
  holderName: " Maria da Silva ",
  holderDocument: "529.982.247-25",
  makeDefault: true,
} as const

describe("bank account schemas", () => {
  it("normalizes numeric secrets before encryption", () => {
    expect(createBankAccountSchema.parse(valid)).toMatchObject({
      bankName: "Banco do Brasil",
      branch: "12345",
      account: "9876543",
      holderName: "Maria da Silva",
      holderDocument: "52998224725",
    })
  })

  it("requires version and rejects protected storage fields", () => {
    expect(updateBankAccountSchema.parse({ ...valid, version: 2 })).toMatchObject({
      version: 2,
    })
    expect(() =>
      updateBankAccountSchema.parse({
        ...valid,
        version: 2,
        companyId: crypto.randomUUID(),
        ciphertext: "forged",
      }),
    ).toThrow()
  })
})
