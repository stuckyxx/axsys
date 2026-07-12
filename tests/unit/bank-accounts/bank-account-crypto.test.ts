import { randomBytes } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  decryptBankField,
  encryptBankAccount,
  maskBankSummary,
} from "@/modules/bank-accounts/server/bank-account-crypto"
import { BANK_ACCOUNT_CRYPTO_V1_FIXTURE } from "../../fixtures/bank-account-crypto-v1"

const keyring = { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) }

describe("bank account encryption", () => {
  it("binds each encrypted field to company, bank account and field AAD", () => {
    const encrypted = encryptBankAccount(
      {
        companyId: crypto.randomUUID(),
        bankAccountId: crypto.randomUUID(),
        branch: "1234-5",
        account: "987654-3",
        holderDocument: "123.456.789-01",
      },
      keyring,
    )
    expect(encrypted).toMatchObject({
      branchLast4: "2345",
      accountLast4: "6543",
      holderDocumentLast4: "8901",
    })
    expect(JSON.stringify(encrypted)).not.toContain("987654-3")
    expect(
      decryptBankField(
        encrypted.account,
        keyring,
        encrypted.companyId,
        encrypted.bankAccountId,
        "account",
      ),
    ).toBe("9876543")
    expect(() =>
      decryptBankField(
        encrypted.account,
        keyring,
        crypto.randomUUID(),
        encrypted.bankAccountId,
        "account",
      ),
    ).toThrow()
    expect(() =>
      decryptBankField(
        encrypted.account,
        keyring,
        encrypted.companyId,
        encrypted.bankAccountId,
        "branch",
      ),
    ).toThrow()
  })

  it("masks short and long summaries without revealing full values", () => {
    expect(maskBankSummary("1")).toBe("•••• •••1")
    expect(maskBankSummary("1234")).toBe("•••• 1234")
    expect(maskBankSummary("9876543")).toBe("•••• 6543")
  })

  it("rejects a missing rotated key", () => {
    const encrypted = encryptBankAccount(
      {
        companyId: crypto.randomUUID(),
        bankAccountId: crypto.randomUUID(),
        branch: "1234",
        account: "987654",
        holderDocument: null,
      },
      keyring,
    )
    expect(() =>
      decryptBankField(
        { ...encrypted.account, keyVersion: 2 },
        keyring,
        encrypted.companyId,
        encrypted.bankAccountId,
        "account",
      ),
    ).toThrow("Bank encryption key unavailable")
  })

  it("decrypts the stable V1 fixture after rotating current writes to V2", () => {
    const fixture = BANK_ACCOUNT_CRYPTO_V1_FIXTURE
    const rotatedKeyring = {
      currentVersion: 2,
      keys: new Map([
        [1, Buffer.from(fixture.keyBase64, "base64")],
        [2, randomBytes(32)],
      ]),
    }

    expect(
      decryptBankField(
        fixture.account,
        rotatedKeyring,
        fixture.companyId,
        fixture.bankAccountId,
        "account",
      ),
    ).toBe(fixture.plaintextAccount)
  })

  it("rejects ambiguous non-UUID encryption scopes", () => {
    expect(() =>
      encryptBankAccount(
        {
          companyId: "company:a",
          bankAccountId: crypto.randomUUID(),
          branch: "1234",
          account: "987654",
          holderDocument: null,
        },
        keyring,
      ),
    ).toThrow("Invalid bank encryption scope")
  })

  it("rejects invalid field characters and field-specific lengths", () => {
    const base = {
      companyId: crypto.randomUUID(),
      bankAccountId: crypto.randomUUID(),
      branch: "1234",
      account: "987654",
      holderDocument: null,
    }
    expect(() =>
      encryptBankAccount({ ...base, branch: "abc1234" }, keyring),
    ).toThrow("Invalid branch")
    expect(() =>
      encryptBankAccount({ ...base, branch: "1".repeat(17) }, keyring),
    ).toThrow("Invalid branch")
    expect(() =>
      encryptBankAccount({ ...base, holderDocument: "123" }, keyring),
    ).toThrow("Invalid holder document")
  })
})
