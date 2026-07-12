import { randomBytes, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../helpers/auth"

const viewState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => {
    let orderCalls = 0
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => {
        orderCalls += 1
        return orderCalls === 2
          ? Promise.resolve({ data: viewState.rows, error: null })
          : query
      }),
    }
    return { from: vi.fn(() => query) }
  }),
}))

import {
  archiveBankAccount,
  createBankAccount,
  listCompanyBankAccounts,
  setDefaultBankAccount,
  updateBankAccount,
  type BankAccountServiceDependencies,
} from "@/modules/bank-accounts/server/bank-account-service"

const companyId = "81000000-0000-4000-8000-000000000001"
const bankAccountId = "82000000-0000-4000-8000-000000000001"
const actor = {
  userId: "83000000-0000-4000-8000-000000000001",
  sessionId: "84000000-0000-4000-8000-000000000001",
}

const summary = Object.freeze({
  id: bankAccountId,
  companyId,
  bankCode: "001",
  bankName: "Banco Seguro",
  maskedBranch: "1234",
  maskedAccount: "6543",
  accountType: "checking" as const,
  holderName: "Empresa A",
  maskedHolderDocument: "••••8901",
  isDefault: true,
  status: "active" as const,
  version: 1,
  createdAt: "2026-07-12T12:00:00.000Z",
  updatedAt: "2026-07-12T12:00:00.000Z",
})

function dependencies(): BankAccountServiceDependencies {
  return {
    repository: {
      list: vi.fn(async () => [summary]),
      upsert: vi.fn(async () => summary),
      setDefault: vi.fn(async () => summary),
      archive: vi.fn(async () => ({ ...summary, status: "archived" as const })),
    },
    uuid: () => bankAccountId,
    keyring: { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
  }
}

const editable = {
  bankCode: "001",
  bankName: "Banco Seguro",
  branch: "1234-5",
  account: "987654-3",
  accountType: "checking" as const,
  holderName: "Empresa A",
  holderDocument: "12345678901",
  makeDefault: false,
}

describe("bank-account-service", () => {
  it("generates the id before encryption and sends ciphertext only to the repository", async () => {
    const deps = dependencies()

    await createBankAccount(deps, {
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      companyId,
      correlationId: randomUUID(),
      input: editable,
    })

    expect(deps.repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId, expectedVersion: null }),
    )
    const serialized = JSON.stringify(
      vi.mocked(deps.repository.upsert).mock.calls[0]?.[0],
    )
    expect(serialized).not.toContain(editable.branch)
    expect(serialized).not.toContain(editable.account)
    expect(serialized).not.toContain(editable.holderDocument)
  })

  it("uses CAS for update, default and archive replacement", async () => {
    const deps = dependencies()
    await updateBankAccount(deps, {
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      companyId,
      bankAccountId,
      correlationId: randomUUID(),
      input: { ...editable, version: 4 },
    })
    await setDefaultBankAccount(deps, {
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      companyId,
      bankAccountId,
      version: 5,
      correlationId: randomUUID(),
    })
    const replacementDefaultId = randomUUID()
    await archiveBankAccount(deps, {
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      companyId,
      bankAccountId,
      version: 6,
      replacementDefaultId,
      reasonCode: "BANK_ARCHIVE_BANK_CHANGED",
      correlationId: randomUUID(),
    })

    expect(deps.repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId, expectedVersion: 4 }),
    )
    expect(deps.repository.setDefault).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 5 }),
    )
    expect(deps.repository.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 6,
        reasonCode: "BANK_ARCHIVE_BANK_CHANGED",
        replacementDefaultId,
      }),
    )
  })

  it.each([
    ["masked_branch", "12345"],
    ["masked_account", "9876543"],
    ["masked_holder_document", "12345678901"],
  ] as const)(
    "fails closed when the company view returns non-masked %s",
    async (field, unsafeValue) => {
      viewState.rows = [{
        id: bankAccountId,
        company_id: companyId,
        bank_code: "001",
        bank_name: "Banco Seguro",
        masked_branch: "•234",
        masked_account: "6543",
        account_type: "checking",
        holder_name: "Empresa A",
        masked_holder_document: "••••8901",
        status: "active",
        is_default: true,
        version: 1,
        created_at: "2026-07-12T12:00:00.000Z",
        updated_at: "2026-07-12T12:00:00.000Z",
        [field]: unsafeValue,
      }]
      const context = Object.freeze({
        ...createCompanyContext(),
        companyId,
        role: "company_admin" as const,
      })

      await expect(listCompanyBankAccounts({ context })).rejects.toThrow()
    },
  )

  it("accepts the exact view mask grammar with a nullable holder document", async () => {
    viewState.rows = [{
      id: bankAccountId,
      company_id: companyId,
      bank_code: "001",
      bank_name: "Banco Seguro",
      masked_branch: "•••4",
      masked_account: "•543",
      account_type: "checking",
      holder_name: "Empresa A",
      masked_holder_document: null,
      status: "active",
      is_default: true,
      version: 1,
      created_at: "2026-07-12T12:00:00.000Z",
      updated_at: "2026-07-12T12:00:00.000Z",
    }]
    const context = Object.freeze({
      ...createCompanyContext(),
      companyId,
      role: "company_admin" as const,
    })

    await expect(listCompanyBankAccounts({ context })).resolves.toMatchObject([
      {
        maskedBranch: "•••4",
        maskedAccount: "•543",
        maskedHolderDocument: null,
      },
    ])
  })
})
