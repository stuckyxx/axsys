import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { COMPROMISED_PASSWORD_SHA256 } from "@/modules/auth/domain/compromised-password-hashes"
import { validatePassword } from "@/modules/auth/server/password-policy"

const WEAK_PASSWORD_ERROR = {
  code: "PASSWORD_WEAK",
  status: 422,
  message: "Use ao menos 12 caracteres não vazios e no máximo 72 bytes UTF-8.",
}

describe("validatePassword", () => {
  it("accepts a memorable phrase without trimming its spaces", async () => {
    await expect(
      validatePassword("uma frase longa e memorável"),
    ).resolves.toBeUndefined()
  })

  it("enforces the 12 Unicode-code-point minimum", async () => {
    await expect(validatePassword("abcdefghijk")).rejects.toMatchObject(
      WEAK_PASSWORD_ERROR,
    )
    await expect(validatePassword("abcdefghijkl")).resolves.toBeUndefined()

    await expect(validatePassword("😀".repeat(11))).rejects.toMatchObject(
      WEAK_PASSWORD_ERROR,
    )
    await expect(validatePassword("😀".repeat(12))).resolves.toBeUndefined()
  })

  it("enforces the exact 72-byte UTF-8 ceiling for ASCII", async () => {
    await expect(validatePassword("a".repeat(72))).resolves.toBeUndefined()
    await expect(validatePassword("a".repeat(73))).rejects.toMatchObject(
      WEAK_PASSWORD_ERROR,
    )
  })

  it("enforces the exact byte ceiling for multibyte and astral code points", async () => {
    const multibyte72 = `${"é".repeat(30)}${"a".repeat(12)}`
    const multibyte73 = `${"é".repeat(30)}${"a".repeat(13)}`
    const astral72 = `${"😀".repeat(15)}${"a".repeat(12)}`
    const astral73 = `${"😀".repeat(15)}${"a".repeat(13)}`

    expect(Buffer.byteLength(multibyte72, "utf8")).toBe(72)
    expect(Buffer.byteLength(multibyte73, "utf8")).toBe(73)
    expect(Buffer.byteLength(astral72, "utf8")).toBe(72)
    expect(Buffer.byteLength(astral73, "utf8")).toBe(73)

    await expect(validatePassword(multibyte72)).resolves.toBeUndefined()
    await expect(validatePassword(multibyte73)).rejects.toMatchObject(
      WEAK_PASSWORD_ERROR,
    )
    await expect(validatePassword(astral72)).resolves.toBeUndefined()
    await expect(validatePassword(astral73)).rejects.toMatchObject(
      WEAK_PASSWORD_ERROR,
    )
  })

  it("rejects whitespace-only and invisible-only values", async () => {
    for (const password of [
      " ".repeat(12),
      "\t".repeat(12),
      " \t\n\r\u00a0\u2000\u2001\u2002\u2003\u2004\u2005\u2006",
      "\u200b".repeat(12),
    ]) {
      await expect(validatePassword(password)).rejects.toMatchObject(
        WEAK_PASSWORD_ERROR,
      )
    }

    await expect(
      validatePassword(`${"\u200b".repeat(11)}visible`),
    ).resolves.toBeUndefined()
  })

  it("rejects unpaired UTF-16 surrogates instead of hashing replacement bytes", async () => {
    await expect(
      validatePassword(`${"a".repeat(12)}\ud800`),
    ).rejects.toMatchObject(WEAK_PASSWORD_ERROR)
    await expect(
      validatePassword(`\udc00${"a".repeat(12)}`),
    ).rejects.toMatchObject(WEAK_PASSWORD_ERROR)
  })

  it("preserves composed and decomposed forms without Unicode normalization", async () => {
    const composed = `prefix-${"é".repeat(5)}`
    const decomposed = `prefix-${"e\u0301".repeat(5)}`

    expect(composed.normalize("NFD")).toBe(decomposed)
    expect(
      createHash("sha256").update(composed).digest("hex"),
    ).not.toBe(createHash("sha256").update(decomposed).digest("hex"))

    await expect(validatePassword(composed)).resolves.toBeUndefined()
    await expect(validatePassword(decomposed)).resolves.toBeUndefined()
  })

  it("rejects exact compromised bytes but does not trim or case-fold them", async () => {
    await expect(validatePassword("senha12345678")).rejects.toMatchObject({
      code: "PASSWORD_COMPROMISED",
      status: 422,
      message: "Escolha uma senha diferente.",
    })

    await expect(validatePassword(" senha12345678")).resolves.toBeUndefined()
    await expect(validatePassword("SENHA12345678")).resolves.toBeUndefined()
  })

  it("ships only the reviewed exact-byte SHA-256 denylist", () => {
    expect([...COMPROMISED_PASSWORD_SHA256]).toEqual([
      "2a33349e7e606a8ad2e30e3c84521f9377450cf09083e162e0a9b1480ce0f972",
      "b861f333a274deac7562646c9437a128a9c923d9ab07c2b79569e404de3ad504",
      "8bf4dec545e105bb54dafcfe6436b67ab8bf0c01d7b575d865810661b858d86f",
      "1eb1afa20dc454d6ef3b6dc6abcbd7dca7e519b698fdf073f4625ded09d74807",
      "6a5859a092236f950374f6df5722bbaacfb4cd3e1af829eacbf51bd6786a9bce",
    ])
    expect(
      createHash("sha256").update("senha12345678").digest("hex"),
    ).toBe("b861f333a274deac7562646c9437a128a9c923d9ab07c2b79569e404de3ad504")
  })
})
