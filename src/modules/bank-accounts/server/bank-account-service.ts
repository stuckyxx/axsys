import "server-only"

import {
  createBankAccountSchema,
  type CreateBankAccountInput,
} from "@/modules/bank-accounts/schemas/bank-account-schemas"
import {
  encryptBankAccount,
  type BankKeyring,
} from "@/modules/bank-accounts/server/bank-account-crypto"

export type BankAccountSummary = Readonly<{
  id: string
  bankCode: string
  bankName: string
  branchLast4: string
  accountLast4: string
  accountType: "checking" | "savings" | "payment"
  holderName: string
  holderDocumentLast4: string | null
  isDefault: boolean
  status: "active" | "archived"
  version: number
}>

type EncryptedBankAccount = ReturnType<typeof encryptBankAccount>

export type BankAccountServiceDependencies = Readonly<{
  repository: Readonly<{
    create(input: {
      actorUserId: string
      sessionId: string
      companyId: string
      bankAccountId: string
      correlationId: string
      bankCode: string
      bankName: string
      accountType: "checking" | "savings" | "payment"
      holderName: string
      makeDefault: boolean
      encrypted: EncryptedBankAccount
    }): Promise<BankAccountSummary>
  }>
  uuid(): string
  keyring?: BankKeyring
}>

export async function createBankAccount(
  deps: BankAccountServiceDependencies,
  command: Readonly<{
    actorUserId: string
    sessionId: string
    companyId: string
    correlationId: string
    input: CreateBankAccountInput
  }>,
): Promise<BankAccountSummary> {
  const input = createBankAccountSchema.parse(command.input)
  const bankAccountId = deps.uuid()
  const encrypted = encryptBankAccount(
    {
      companyId: command.companyId,
      bankAccountId,
      branch: input.branch,
      account: input.account,
      holderDocument: input.holderDocument,
    },
    deps.keyring,
  )
  return deps.repository.create({
    actorUserId: command.actorUserId,
    sessionId: command.sessionId,
    companyId: command.companyId,
    bankAccountId,
    correlationId: command.correlationId,
    bankCode: input.bankCode,
    bankName: input.bankName,
    accountType: input.accountType,
    holderName: input.holderName,
    makeDefault: input.makeDefault,
    encrypted,
  })
}
