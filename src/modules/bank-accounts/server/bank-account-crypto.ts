import "server-only"

import {
  decryptValue,
  encryptValue,
  readEncryptionKey,
  type EncryptedValue,
} from "@/lib/security/envelope-encryption"

export type BankField = "branch" | "account" | "holderDocument"
export type BankKeyring = Readonly<{
  currentVersion: number
  keys: ReadonlyMap<number, Buffer>
}>

type EncryptedBankAccount = Readonly<{
  companyId: string
  bankAccountId: string
  branch: EncryptedValue
  branchLast4: string
  account: EncryptedValue
  accountLast4: string
  holderDocument: EncryptedValue | null
  holderDocumentLast4: string | null
}>

const BANK_KEY_ENV = "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64"
const BANK_CRYPTO_FAILURE = "Bank encryption key unavailable"
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function runtimeKeyring(): BankKeyring {
  return {
    currentVersion: 1,
    keys: new Map([[1, readEncryptionKey(BANK_KEY_ENV)]]),
  }
}

function keyFor(keyring: BankKeyring, version: number): Buffer {
  const key = keyring.keys.get(version)
  if (key === undefined) throw new Error(BANK_CRYPTO_FAILURE)
  return key
}

function normalizeDigits(value: string, label: string): string {
  const normalized = value.replace(/\D/gu, "")
  if (normalized.length === 0 || normalized.length > 32) {
    throw new Error(`Invalid ${label}`)
  }
  return normalized
}

function aad(
  companyId: string,
  bankAccountId: string,
  field: BankField,
): string {
  return `bank:${companyId}:${bankAccountId}:${field}`
}

function last4(value: string): string {
  return value.slice(-4)
}

export function encryptBankAccount(
  input: Readonly<{
    companyId: string
    bankAccountId: string
    branch: string
    account: string
    holderDocument: string | null
  }>,
  keyring: BankKeyring = runtimeKeyring(),
): EncryptedBankAccount {
  if (!UUID.test(input.companyId) || !UUID.test(input.bankAccountId)) {
    throw new Error("Invalid bank encryption scope")
  }
  const branch = normalizeDigits(input.branch, "branch")
  const account = normalizeDigits(input.account, "account")
  const holderDocument =
    input.holderDocument === null
      ? null
      : normalizeDigits(input.holderDocument, "holder document")
  const version = keyring.currentVersion
  const key = keyFor(keyring, version)
  return {
    companyId: input.companyId,
    bankAccountId: input.bankAccountId,
    branch: encryptValue(
      branch,
      key,
      version,
      aad(input.companyId, input.bankAccountId, "branch"),
    ),
    branchLast4: last4(branch),
    account: encryptValue(
      account,
      key,
      version,
      aad(input.companyId, input.bankAccountId, "account"),
    ),
    accountLast4: last4(account),
    holderDocument:
      holderDocument === null
        ? null
        : encryptValue(
            holderDocument,
            key,
            version,
            aad(input.companyId, input.bankAccountId, "holderDocument"),
          ),
    holderDocumentLast4:
      holderDocument === null ? null : last4(holderDocument),
  }
}

export function decryptBankField(
  encrypted: EncryptedValue,
  keyring: BankKeyring,
  companyId: string,
  bankAccountId: string,
  field: BankField,
): string {
  if (!UUID.test(companyId) || !UUID.test(bankAccountId)) {
    throw new Error("Invalid bank encryption scope")
  }
  return decryptValue(
    encrypted,
    keyFor(keyring, encrypted.keyVersion),
    aad(companyId, bankAccountId, field),
  )
}

export function maskBankSummary(value: string): string {
  const normalized = value.replace(/\D/gu, "")
  const visible = normalized.slice(-4).padStart(4, "•")
  return `•••• ${visible}`
}
