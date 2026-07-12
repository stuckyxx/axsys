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

function keyFor(keyring: BankKeyring, version: number): Buffer {
  const key = keyring.keys.get(version)
  if (key === undefined) throw new Error(BANK_CRYPTO_FAILURE)
  return key
}

function normalizeDigitsBuffer(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): Buffer {
  if (!/^[0-9.\-/\s]+$/u.test(value)) throw new Error(`Invalid ${label}`)
  let digitCount = 0
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code >= 48 && code <= 57) digitCount += 1
  }
  if (digitCount < minimum || digitCount > maximum) {
    throw new Error(`Invalid ${label}`)
  }
  const normalized = Buffer.allocUnsafe(digitCount)
  let offset = 0
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code >= 48 && code <= 57) {
      normalized[offset] = code
      offset += 1
    }
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

function last4(value: Buffer): string {
  return value.subarray(Math.max(0, value.length - 4)).toString("utf8")
}

export function encryptBankAccount(
  input: Readonly<{
    companyId: string
    bankAccountId: string
    branch: string
    account: string
    holderDocument: string | null
  }>,
  keyring?: BankKeyring,
): EncryptedBankAccount {
  if (!UUID.test(input.companyId) || !UUID.test(input.bankAccountId)) {
    throw new Error("Invalid bank encryption scope")
  }
  // Request strings are immutable in JavaScript. Normalize into buffers we own
  // so those transient plaintext copies can be reliably wiped in `finally`.
  let branch: Buffer | undefined
  let account: Buffer | undefined
  let holderDocument: Buffer | null | undefined
  let runtimeKey: Buffer | null = null
  try {
    branch = normalizeDigitsBuffer(input.branch, "branch", 1, 16)
    account = normalizeDigitsBuffer(input.account, "account", 1, 32)
    holderDocument =
      input.holderDocument === null
        ? null
        : normalizeDigitsBuffer(
            input.holderDocument,
            "holder document",
            11,
            14,
          )
    runtimeKey = keyring === undefined ? readEncryptionKey(BANK_KEY_ENV) : null
    const activeKeyring =
      keyring ??
      ({
        currentVersion: 1,
        keys: new Map([[1, runtimeKey!]]),
      } satisfies BankKeyring)
    const version = activeKeyring.currentVersion
    const key = keyFor(activeKeyring, version)
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
  } finally {
    branch?.fill(0)
    account?.fill(0)
    holderDocument?.fill(0)
    runtimeKey?.fill(0)
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
