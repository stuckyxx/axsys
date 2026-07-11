import { z } from "@/lib/validation/zod"

const MODERN_PUBLISHABLE_KEY =
  /^sb_publishable_[A-Za-z0-9_-]{20,128}$/u
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

const publicSupabaseKeySchema = z.string().refine(
  (value) =>
    MODERN_PUBLISHABLE_KEY.test(value) || hasLegacyRole(value, "anon"),
)

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicSupabaseKeySchema,
})

export function getPublicEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  })
  if (!parsed.success) throw new Error("Invalid public environment")
  return parsed.data
}
