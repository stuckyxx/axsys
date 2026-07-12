import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export type EncryptedValue = {
  ciphertext: string
  iv: string
  tag: string
  keyVersion: number
}

const AES_256_KEY_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function decodeBase64(value: string, label: string, allowEmpty = false): Buffer {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be valid base64`)
  }

  const decoded = Buffer.from(value, "base64")
  if (decoded.toString("base64") !== value) {
    throw new Error(`${label} must be valid base64`)
  }

  return decoded
}

function assertEncryptionKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.byteLength !== AES_256_KEY_BYTES) {
    throw new Error("Encryption key must contain exactly 32 bytes")
  }
}

function assertKeyVersion(keyVersion: number): void {
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    throw new Error("Key version must be a positive integer")
  }
}

function authenticatedData(keyVersion: number, additionalAuthenticatedData: string): Buffer {
  assertKeyVersion(keyVersion)
  if (typeof additionalAuthenticatedData !== "string" || additionalAuthenticatedData.length === 0) {
    throw new Error("Additional authenticated data is required")
  }

  return Buffer.from(
    JSON.stringify({
      keyVersion,
      value: additionalAuthenticatedData,
    }),
    "utf8",
  )
}

export function readEncryptionKey(name: string, encoded = process.env[name]): Buffer {
  if (!encoded) {
    throw new Error(`${name} is required`)
  }

  let key: Buffer
  try {
    key = decodeBase64(encoded, name)
  } catch {
    throw new Error(`${name} must be valid base64`)
  }

  if (key.byteLength !== AES_256_KEY_BYTES) {
    throw new Error(`${name} must decode to 32 bytes`)
  }

  return key
}

export function encryptValue(
  plaintext: string | Buffer,
  key: Buffer,
  keyVersion: number,
  additionalAuthenticatedData: string,
): EncryptedValue {
  assertEncryptionKey(key)
  const aad = authenticatedData(keyVersion, additionalAuthenticatedData)
  const iv = randomBytes(GCM_IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad)
  const encryptedChunk = Buffer.isBuffer(plaintext)
    ? cipher.update(plaintext)
    : cipher.update(plaintext, "utf8")
  const ciphertext = Buffer.concat([encryptedChunk, cipher.final()])

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  }
}

export function decryptValue(
  encrypted: EncryptedValue,
  key: Buffer,
  additionalAuthenticatedData: string,
): string {
  assertEncryptionKey(key)
  const aad = authenticatedData(encrypted.keyVersion, additionalAuthenticatedData)
  const iv = decodeBase64(encrypted.iv, "Encrypted IV")
  const tag = decodeBase64(encrypted.tag, "Encrypted tag")
  const ciphertext = decodeBase64(encrypted.ciphertext, "Encrypted ciphertext", true)

  if (iv.byteLength !== GCM_IV_BYTES) {
    throw new Error("Encrypted IV must decode to 12 bytes")
  }
  if (tag.byteLength !== GCM_TAG_BYTES) {
    throw new Error("Encrypted tag must decode to 16 bytes")
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
