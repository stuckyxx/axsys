import { randomBytes, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createBankAccount } from "@/modules/bank-accounts/server/bank-account-service"

describe("bank account service", () => {
  it("generates the record id before encryption and persists no plaintext secret", async () => {
    const bankAccountId = randomUUID()
    const repository = {
      create: vi.fn().mockResolvedValue({
        id: bankAccountId,
        bankCode: "001",
        bankName: "Banco do Brasil",
        branchLast4: "2345",
        accountLast4: "6543",
        accountType: "checking",
        holderName: "Maria",
        holderDocumentLast4: "4725",
        isDefault: true,
        status: "active",
        version: 1,
      }),
    }
    const result = await createBankAccount(
      {
        repository,
        uuid: () => bankAccountId,
        keyring: {
          currentVersion: 1,
          keys: new Map([[1, randomBytes(32)]]),
        },
      },
      {
        actorUserId: randomUUID(),
        sessionId: randomUUID(),
        companyId: randomUUID(),
        correlationId: randomUUID(),
        input: {
          bankCode: "001",
          bankName: "Banco do Brasil",
          branch: "1234-5",
          account: "987654-3",
          accountType: "checking",
          holderName: "Maria",
          holderDocument: "52998224725",
          makeDefault: true,
        },
      },
    )

    expect(result).toMatchObject({ id: bankAccountId, accountLast4: "6543" })
    const persisted = JSON.stringify(repository.create.mock.calls[0]![0])
    expect(persisted).not.toContain("1234-5")
    expect(persisted).not.toContain("987654-3")
    expect(persisted).not.toContain("52998224725")
  })
})
