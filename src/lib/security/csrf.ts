import "server-only"

import { Buffer } from "node:buffer"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { getServerEnv } from "@/lib/env/server"
import { ApiError } from "@/lib/http/api-error"

export const CSRF_TOKEN_TTL_SECONDS = 8 * 60 * 60
export const CSRF_FUTURE_SKEW_SECONDS = 30
export const CSRF_MAX_TOKEN_LENGTH = 128
export const CSRF_COOKIE_NAME = "__Host-axsys-csrf"

const CSRF_SECRET_MINIMUM_BYTES = 32
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const CANONICAL_TIMESTAMP_PATTERN = /^(?:0|[1-9][0-9]{0,15})$/u

function hasStrongSecret(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= CSRF_SECRET_MINIMUM_BYTES
}

function isValidTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function decodeCanonical32Bytes(value: string): Buffer | null {
  if (!BASE64URL_32_BYTES_PATTERN.test(value)) return null

  const decoded = Buffer.from(value, "base64url")
  return decoded.length === 32 && decoded.toString("base64url") === value
    ? decoded
    : null
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest()
}

export function createCsrfToken(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!hasStrongSecret(secret)) throw new Error("Invalid CSRF secret")
  if (!isValidTimestamp(nowSeconds)) throw new Error("Invalid CSRF timestamp")

  const nonce = randomBytes(32).toString("base64url")
  const payload = `${nowSeconds}.${nonce}`
  return `${payload}.${sign(payload, secret).toString("base64url")}`
}

export function verifyCsrfToken(
  header: string | null,
  cookie: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !header ||
    !cookie ||
    header.length > CSRF_MAX_TOKEN_LENGTH ||
    cookie.length > CSRF_MAX_TOKEN_LENGTH ||
    !hasStrongSecret(secret) ||
    !isValidTimestamp(nowSeconds)
  ) {
    return false
  }

  const headerBytes = Buffer.from(header, "utf8")
  const cookieBytes = Buffer.from(cookie, "utf8")
  if (
    headerBytes.length !== cookieBytes.length ||
    !timingSafeEqual(headerBytes, cookieBytes)
  ) {
    return false
  }

  const segments = header.split(".")
  if (segments.length !== 3) return false
  const [issuedText, nonce, signature] = segments

  if (!CANONICAL_TIMESTAMP_PATTERN.test(issuedText)) return false
  const issuedAt = Number(issuedText)
  if (!isValidTimestamp(issuedAt) || String(issuedAt) !== issuedText) return false
  if (
    (issuedAt > nowSeconds &&
      issuedAt - nowSeconds > CSRF_FUTURE_SKEW_SECONDS) ||
    (issuedAt <= nowSeconds &&
      nowSeconds - issuedAt > CSRF_TOKEN_TTL_SECONDS)
  ) {
    return false
  }

  if (!decodeCanonical32Bytes(nonce)) return false
  const receivedSignature = decodeCanonical32Bytes(signature)
  if (!receivedSignature) return false

  const expectedSignature = sign(`${issuedText}.${nonce}`, secret)
  return timingSafeEqual(expectedSignature, receivedSignature)
}

export function assertCsrf(
  header: string | null,
  cookie: string | null,
): void {
  if (!verifyCsrfToken(header, cookie, getServerEnv().CSRF_SECRET)) {
    throw new ApiError(
      "CSRF_INVALID",
      403,
      "Token de segurança inválido.",
    )
  }
}
