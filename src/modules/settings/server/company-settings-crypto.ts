import "server-only"

import { encryptValue, readEncryptionKey } from "@/lib/security/envelope-encryption"

const KEY_ENV = "PII_ENCRYPTION_KEY_V1_BASE64"

export function encryptRepresentativeDocument(
  companyId: string,
  document: string | null,
) {
  if (document === null) return null
  const normalized = Buffer.from(document.replace(/\D/gu, ""), "utf8")
  const key = readEncryptionKey(KEY_ENV)
  try {
    const encrypted = encryptValue(
      normalized,
      key,
      1,
      `company:${companyId}:representative-document`,
    )
    return {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      keyVersion: encrypted.keyVersion,
      last4: normalized.subarray(-4).toString("utf8"),
    }
  } finally {
    normalized.fill(0)
    key.fill(0)
  }
}
