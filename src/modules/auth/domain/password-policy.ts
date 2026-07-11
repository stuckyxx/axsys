import { createHash } from "node:crypto"

import { ApiError } from "@/lib/http/api-error"
import { COMPROMISED_PASSWORD_SHA256 } from "@/modules/auth/domain/compromised-password-hashes"

const NON_VISIBLE_CODE_POINT = /[\p{White_Space}\p{Default_Ignorable_Code_Point}]/u

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return true
      }
      index += 1
      continue
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }

  return false
}

function hasVisibleCodePoint(value: string): boolean {
  return Array.from(value).some(
    (codePoint) => !NON_VISIBLE_CODE_POINT.test(codePoint),
  )
}

export async function validatePassword(password: string): Promise<void> {
  const codePoints = Array.from(password).length
  const utf8Bytes = Buffer.byteLength(password, "utf8")

  if (
    hasUnpairedSurrogate(password) ||
    codePoints < 12 ||
    utf8Bytes > 72 ||
    !hasVisibleCodePoint(password)
  ) {
    throw new ApiError(
      "PASSWORD_WEAK",
      422,
      "Use ao menos 12 caracteres não vazios e no máximo 72 bytes UTF-8.",
    )
  }

  const hash = createHash("sha256").update(password).digest("hex")
  if (COMPROMISED_PASSWORD_SHA256.has(hash)) {
    throw new ApiError(
      "PASSWORD_COMPROMISED",
      422,
      "Escolha uma senha diferente.",
    )
  }
}
