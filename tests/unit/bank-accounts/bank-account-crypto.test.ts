import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  decryptBankField,
  encryptBankAccount,
  maskBankSummary,
} from "@/modules/bank-accounts/server/bank-account-crypto"
import {
  BANK_ACCOUNT_CRYPTO_V1_FIXTURE,
  BANK_ACCOUNT_CRYPTO_V1_TEST_ONLY_MATERIAL,
} from "../../fixtures/bank-account-crypto-v1"

const keyring = { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) }

afterEach(() => {
  vi.doUnmock("@/lib/security/envelope-encryption")
  vi.unstubAllEnvs()
})

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
    const serialized = JSON.stringify(encrypted)
    expect(serialized).not.toContain('"12345"')
    expect(serialized).not.toContain('"9876543"')
    expect(serialized).not.toContain('"12345678901"')
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
        crypto.randomUUID(),
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
    expect(() =>
      decryptBankField(
        encrypted.account,
        { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
        encrypted.companyId,
        encrypted.bankAccountId,
        "account",
      ),
    ).toThrow()
  })

  it("uses a fresh cryptographically random IV for every field and write", () => {
    const input = {
      companyId: crypto.randomUUID(),
      bankAccountId: crypto.randomUUID(),
      branch: "1234",
      account: "1234",
      holderDocument: "12345678901",
    }
    const first = encryptBankAccount(input, keyring)
    const second = encryptBankAccount(input, keyring)
    const ivs = [
      first.branch.iv,
      first.account.iv,
      first.holderDocument?.iv,
      second.branch.iv,
      second.account.iv,
      second.holderDocument?.iv,
    ]

    expect(new Set(ivs).size).toBe(ivs.length)
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

  it("decrypts all fields in the exact cross-plan V1 snapshot after rotating writes to V2", () => {
    const fixture = BANK_ACCOUNT_CRYPTO_V1_FIXTURE
    const testMaterial = BANK_ACCOUNT_CRYPTO_V1_TEST_ONLY_MATERIAL
    const rotatedKeyring = {
      currentVersion: 2,
      keys: new Map([
        [1, Buffer.from(testMaterial.keyBase64, "base64")],
        [2, randomBytes(32)],
      ]),
    }
    const snapshot = fixture.snapshot

    expect(
      decryptBankField(
        snapshot.branch,
        rotatedKeyring,
        fixture.companyId,
        snapshot.bankAccountId,
        "branch",
      ),
    ).toBe(testMaterial.plaintext.branch)
    expect(
      decryptBankField(
        snapshot.account,
        rotatedKeyring,
        fixture.companyId,
        snapshot.bankAccountId,
        "account",
      ),
    ).toBe(testMaterial.plaintext.account)
    expect(
      decryptBankField(
        snapshot.holderDocument,
        rotatedKeyring,
        fixture.companyId,
        snapshot.bankAccountId,
        "holderDocument",
      ),
    ).toBe(testMaterial.plaintext.holderDocument)

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "account",
        "accountLast4",
        "accountType",
        "bankAccountId",
        "bankCode",
        "bankName",
        "branch",
        "branchLast4",
        "holderDocument",
        "holderDocumentLast4",
        "holderName",
      ].sort(),
    )
    for (const envelope of [
      snapshot.branch,
      snapshot.account,
      snapshot.holderDocument,
    ]) {
      expect(Object.keys(envelope).sort()).toEqual(
        ["ciphertext", "iv", "keyVersion", "tag"].sort(),
      )
      expect(envelope.keyVersion).toBe(1)
    }

    const serializedFixture = JSON.stringify(fixture)
    expect(serializedFixture).not.toContain(testMaterial.keyBase64)
    expect(serializedFixture).not.toContain(testMaterial.plaintext.branch)
    expect(serializedFixture).not.toContain(testMaterial.plaintext.account)
    expect(serializedFixture).not.toContain(
      testMaterial.plaintext.holderDocument,
    )
    const serializedSnapshot = JSON.stringify(snapshot)
    expect(serializedSnapshot).not.toMatch(
      /keyBase64|plaintext|companyId|isDefault|token|url|path|audit/iu,
    )
  })

  it("does not mutate a caller-owned keyring", () => {
    const callerKey = randomBytes(32)
    const originalKey = Buffer.from(callerKey)
    const callerKeyring = {
      currentVersion: 1,
      keys: new Map([[1, callerKey]]),
    }

    encryptBankAccount(
      {
        companyId: crypto.randomUUID(),
        bankAccountId: crypto.randomUUID(),
        branch: "1234",
        account: "987654",
        holderDocument: "12345678901",
      },
      callerKeyring,
    )

    expect(callerKeyring.currentVersion).toBe(1)
    expect(callerKeyring.keys.get(1)).toBe(callerKey)
    expect(callerKey).toEqual(originalKey)
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

  it("loads the V1 environment key only when an operation runs", () => {
    const environmentKey = randomBytes(32)
    vi.stubEnv(
      "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64",
      environmentKey.toString("base64"),
    )
    const companyId = crypto.randomUUID()
    const bankAccountId = crypto.randomUUID()
    const encrypted = encryptBankAccount({
      companyId,
      bankAccountId,
      branch: "1234",
      account: "987654",
      holderDocument: null,
    })

    expect(encrypted.account.keyVersion).toBe(1)
    expect(
      decryptBankField(
        encrypted.account,
        { currentVersion: 1, keys: new Map([[1, environmentKey]]) },
        companyId,
        bankAccountId,
        "account",
      ),
    ).toBe("987654")

    vi.stubEnv("BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64", "")
    expect(() =>
      encryptBankAccount({
        companyId,
        bankAccountId,
        branch: "1234",
        account: "987654",
        holderDocument: null,
      }),
    ).toThrow("BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64 is required")
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

  it("zeroes the lazily loaded runtime key after encryption", async () => {
    const runtimeKey = Buffer.alloc(32, 9)
    const expectedZeroedKey = Buffer.alloc(32)

    vi.resetModules()
    vi.doMock("@/lib/security/envelope-encryption", async (importOriginal) => {
      const actual = await importOriginal<
        typeof import("@/lib/security/envelope-encryption")
      >()
      return {
        ...actual,
        readEncryptionKey: vi.fn(() => runtimeKey),
      }
    })
    const runtimeCrypto = await import(
      "@/modules/bank-accounts/server/bank-account-crypto"
    )

    runtimeCrypto.encryptBankAccount({
      companyId: crypto.randomUUID(),
      bankAccountId: crypto.randomUUID(),
      branch: "1234",
      account: "987654",
      holderDocument: null,
    })

    expect(runtimeKey).toEqual(expectedZeroedKey)
  })

  it.each(["success", "failure"] as const)(
    "zeroes every transient normalized plaintext buffer after %s",
    async (outcome) => {
      const captured: Buffer[] = []

      vi.resetModules()
      vi.doMock("@/lib/security/envelope-encryption", async (importOriginal) => {
        const actual = await importOriginal<
          typeof import("@/lib/security/envelope-encryption")
        >()
        let call = 0
        return {
          ...actual,
          encryptValue: vi.fn(
            (
              plaintext: string | Buffer,
              key: Buffer,
              keyVersion: number,
              additionalAuthenticatedData: string,
            ) => {
              expect(Buffer.isBuffer(plaintext)).toBe(true)
              captured.push(plaintext as Buffer)
              call += 1
              if (outcome === "failure" && call === 3) {
                throw new Error("injected encryption failure")
              }
              return actual.encryptValue(
                plaintext,
                key,
                keyVersion,
                additionalAuthenticatedData,
              )
            },
          ),
        }
      })
      const runtimeCrypto = await import(
        "@/modules/bank-accounts/server/bank-account-crypto"
      )
      const operation = () =>
        runtimeCrypto.encryptBankAccount(
          {
            companyId: crypto.randomUUID(),
            bankAccountId: crypto.randomUUID(),
            branch: "1234-5",
            account: "987654-3",
            holderDocument: "12345678901",
          },
          keyring,
        )

      if (outcome === "failure") {
        expect(operation).toThrow("injected encryption failure")
      } else {
        expect(operation).not.toThrow()
      }
      expect(captured).toHaveLength(3)
      for (const plaintext of captured) {
        expect(plaintext).toEqual(Buffer.alloc(plaintext.length))
      }
    },
  )
})
