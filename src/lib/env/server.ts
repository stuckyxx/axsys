import "server-only"

import { z } from "zod"

const MODERN_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,128}$/u
const BASE64URL = /^[A-Za-z0-9_-]+$/u
const LEGACY_JWT_MAX_LENGTH = 2_048
const JWT_JSON_SEGMENT_MAX_LENGTH = 1_024
const JWT_SIGNATURE_LENGTH = 43

function decodeCanonicalBase64Url(
  value: string,
  minimumLength: number,
  maximumLength: number,
): Uint8Array | undefined {
  if (
    value.length < minimumLength ||
    value.length > maximumLength ||
    value.length % 4 === 1 ||
    !BASE64URL.test(value)
  ) {
    return undefined
  }

  try {
    const base64 = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`
    const binary = atob(base64)
    const canonical = btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "")
    if (canonical !== value) return undefined
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return undefined
  }
}

function decodeJsonSegment(value: string): unknown {
  const decoded = decodeCanonicalBase64Url(
    value,
    2,
    JWT_JSON_SEGMENT_MAX_LENGTH,
  )
  if (!decoded) return undefined

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded))
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasLegacyRole(value: string, expectedRole: string): boolean {
  if (value.length > LEGACY_JWT_MAX_LENGTH) return false
  const segments = value.split(".")
  if (segments.length !== 3) return false

  const [encodedHeader, encodedPayload, signature] = segments
  const header = decodeJsonSegment(encodedHeader)
  const payload = decodeJsonSegment(encodedPayload)
  const signatureBytes = decodeCanonicalBase64Url(
    signature,
    JWT_SIGNATURE_LENGTH,
    JWT_SIGNATURE_LENGTH,
  )

  return (
    isRecord(header) &&
    header.alg === "HS256" &&
    isRecord(payload) &&
    Object.hasOwn(payload, "role") &&
    payload.role === expectedRole &&
    signatureBytes?.length === 32
  )
}

const serverSupabaseKeySchema = z.string().refine(
  (value) => MODERN_SECRET_KEY.test(value) || hasLegacyRole(value, "service_role"),
)

const bffDatabaseUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.username === "axsys_bff"
    )
  } catch {
    return false
  }
})

const appOriginSchema = z.url().refine((value) => {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      value === url.origin
    )
  } catch {
    return false
  }
})

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: serverSupabaseKeySchema,
  BFF_DATABASE_URL: bffDatabaseUrlSchema,
  APP_ORIGIN: appOriginSchema,
  CSRF_SECRET: z.string().min(32),
  SECURITY_HASH_PEPPER: z.string().min(32),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
})

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error("Invalid server environment")
  }
  return parsed.data
}
