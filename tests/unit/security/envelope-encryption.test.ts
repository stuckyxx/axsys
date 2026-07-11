import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  decryptValue,
  encryptValue,
  readEncryptionKey,
} from "@/lib/security/envelope-encryption"

describe("envelope-encryption", () => {
  const key = randomBytes(32)

  afterEach(() => vi.unstubAllEnvs())

  function flipOneByte(encoded: string): string {
    const decoded = Buffer.from(encoded, "base64")
    decoded[0] ^= 1
    return decoded.toString("base64")
  }

  it("round-trips only with the same key, version, and AAD", () => {
    const encrypted = encryptValue("000123-4", key, 1, "bank:account:company-a")

    expect(decryptValue(encrypted, key, "bank:account:company-a")).toBe("000123-4")
    expect(() => decryptValue(encrypted, randomBytes(32), "bank:account:company-a")).toThrow()
    expect(() => decryptValue(encrypted, key, "bank:account:company-b")).toThrow()
    expect(() => decryptValue({ ...encrypted, keyVersion: 2 }, key, "bank:account:company-a")).toThrow()
    expect(encrypted.ciphertext).not.toContain("000123-4")
  })

  it("rejects keys that do not decode to exactly 32 bytes", () => {
    expect(() => readEncryptionKey("BROKEN_KEY", Buffer.alloc(16).toString("base64"))).toThrow(
      "BROKEN_KEY must decode to 32 bytes",
    )
  })

  it("rejects malformed base64 even when its permissive decode is 32 bytes", () => {
    const valid = randomBytes(32).toString("base64")

    expect(() => readEncryptionKey("BROKEN_KEY", `${valid}!`)).toThrow(
      "BROKEN_KEY must be valid base64",
    )
  })

  it("loads rotated key material at call time instead of module import time", () => {
    const first = randomBytes(32)
    const second = randomBytes(32)
    vi.stubEnv("ROTATING_KEY", first.toString("base64"))

    expect(readEncryptionKey("ROTATING_KEY")).toEqual(first)

    vi.stubEnv("ROTATING_KEY", second.toString("base64"))
    expect(readEncryptionKey("ROTATING_KEY")).toEqual(second)
  })

  it("uses a fresh random IV for repeated plaintext", () => {
    const first = encryptValue("same secret", key, 1, "profile:cpf:user-a")
    const second = encryptValue("same secret", key, 1, "profile:cpf:user-a")

    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it.each(["ciphertext", "iv", "tag"] as const)(
    "rejects same-length %s tampering",
    (field) => {
      const encrypted = encryptValue("secret", key, 1, "profile:cpf:user-a")
      const tampered = { ...encrypted, [field]: flipOneByte(encrypted[field]) }

      expect(() => decryptValue(tampered, key, "profile:cpf:user-a")).toThrow()
    },
  )

  it("rejects invalid key buffers, versions, ciphertext envelopes, and empty AAD", () => {
    expect(() => encryptValue("secret", Buffer.alloc(16), 1, "profile:cpf:user-a")).toThrow(
      "Encryption key must contain exactly 32 bytes",
    )
    expect(() => encryptValue("secret", key, 0, "profile:cpf:user-a")).toThrow(
      "Key version must be a positive integer",
    )
    expect(() => encryptValue("secret", key, 1, "")).toThrow(
      "Additional authenticated data is required",
    )

    const encrypted = encryptValue("secret", key, 1, "profile:cpf:user-a")
    expect(() => decryptValue({ ...encrypted, iv: "AA==" }, key, "profile:cpf:user-a")).toThrow(
      "Encrypted IV must decode to 12 bytes",
    )
    expect(() => decryptValue({ ...encrypted, tag: "AA==" }, key, "profile:cpf:user-a")).toThrow(
      "Encrypted tag must decode to 16 bytes",
    )
  })
})
