import "server-only"

import {
  bffDb,
  type RateLimitDecision as BffRateLimitDecision,
} from "@/lib/db/bff"
import { getServerEnv } from "@/lib/env/server"
import { canonicalizeIp } from "@/lib/security/canonical-ip"
import { hashSensitive } from "@/lib/security/redact"

export type RateLimitBucket =
  | "login-ip-volume"
  | "login-account-failure"
  | "reauth-ip-volume"
  | "reauth-account-failure"
  | "forgot-ip-volume"
  | "forgot-account-volume"
  | "file-mutation-user"
  | "file-download-user"
  | "platform-company-create"
  | "platform-company-status"
  | "user-provisioning"
  | "administrative-password-reset"
  | "bank-account-mutation"
  | "platform-observability-read"
  | "company-settings-draft"

export type AccountFailureRateLimitBucket =
  | "login-account-failure"
  | "reauth-account-failure"

export type RateLimitDecision = BffRateLimitDecision

type RateLimitPolicy = Readonly<{
  limit: number
  windowSeconds: number
  blockSeconds: number
}>

const RATE_LIMIT_POLICIES = Object.freeze({
  "login-ip-volume": Object.freeze({
    limit: 30,
    windowSeconds: 900,
    blockSeconds: 1_800,
  }),
  "login-account-failure": Object.freeze({
    limit: 5,
    windowSeconds: 900,
    blockSeconds: 900,
  }),
  "reauth-ip-volume": Object.freeze({
    limit: 20,
    windowSeconds: 900,
    blockSeconds: 1_800,
  }),
  "reauth-account-failure": Object.freeze({
    limit: 5,
    windowSeconds: 900,
    blockSeconds: 900,
  }),
  "forgot-ip-volume": Object.freeze({
    limit: 10,
    windowSeconds: 900,
    blockSeconds: 3_600,
  }),
  "forgot-account-volume": Object.freeze({
    limit: 3,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "file-mutation-user": Object.freeze({
    limit: 20,
    windowSeconds: 60,
    blockSeconds: 60,
  }),
  "file-download-user": Object.freeze({
    limit: 60,
    windowSeconds: 60,
    blockSeconds: 60,
  }),
  "platform-company-create": Object.freeze({
    limit: 10,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "platform-company-status": Object.freeze({
    limit: 20,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "user-provisioning": Object.freeze({
    limit: 20,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "administrative-password-reset": Object.freeze({
    limit: 10,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "bank-account-mutation": Object.freeze({
    limit: 30,
    windowSeconds: 3_600,
    blockSeconds: 3_600,
  }),
  "platform-observability-read": Object.freeze({
    limit: 120,
    windowSeconds: 60,
    blockSeconds: 60,
  }),
  "company-settings-draft": Object.freeze({
    limit: 30,
    windowSeconds: 60,
    blockSeconds: 60,
  }),
} satisfies Record<RateLimitBucket, RateLimitPolicy>)

const CLEARABLE_ACCOUNT_FAILURE_BUCKETS = new Set<AccountFailureRateLimitBucket>([
  "login-account-failure",
  "reauth-account-failure",
])

export const UNTRUSTED_CLIENT_IP = "local-or-untrusted-proxy"

const MAX_FORWARDED_HEADER_LENGTH = 1_024
const MAX_FORWARDED_HOPS = 8
const BASE_DELAY_MILLISECONDS = 250
const MAX_DELAY_EXPONENT = 4

function isRateLimitBucket(value: string): value is RateLimitBucket {
  return Object.prototype.hasOwnProperty.call(RATE_LIMIT_POLICIES, value)
}

function isAccountFailureRateLimitBucket(
  value: string,
): value is AccountFailureRateLimitBucket {
  return CLEARABLE_ACCOUNT_FAILURE_BUCKETS.has(
    value as AccountFailureRateLimitBucket,
  )
}

export async function consumeRateLimit(
  bucket: RateLimitBucket,
  rawKey: string,
): Promise<RateLimitDecision> {
  if (!isRateLimitBucket(bucket)) throw new Error("Invalid rate limit bucket")

  const policy = RATE_LIMIT_POLICIES[bucket]
  return bffDb.consumeRateLimit({
    bucket,
    keyHash: hashSensitive(rawKey),
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
    blockSeconds: policy.blockSeconds,
  })
}

export async function clearAccountFailureRateLimit(
  bucket: AccountFailureRateLimitBucket,
  rawKey: string,
): Promise<void> {
  if (!isAccountFailureRateLimitBucket(bucket)) {
    throw new Error("Invalid rate limit clear bucket")
  }
  await bffDb.clearRateLimit(bucket, hashSensitive(rawKey))
}

function parseTrustedForwardingChain(value: string | null): string | null {
  if (!value || value.length > MAX_FORWARDED_HEADER_LENGTH) return null

  const rawHops = value.split(",")
  if (rawHops.length === 0 || rawHops.length > MAX_FORWARDED_HOPS) return null

  const canonicalHops = rawHops.map((rawHop) =>
    canonicalizeIp(rawHop.trim()),
  )
  if (canonicalHops.some((hop) => hop === null)) return null
  return canonicalHops.at(-1) ?? null
}

export function getClientIp(request: Request): string {
  const env = getServerEnv()
  const forwardingHeader =
    process.env.VERCEL === "1"
      ? "x-vercel-forwarded-for"
      : env.TRUST_PROXY === "true"
        ? "x-forwarded-for"
        : null
  if (!forwardingHeader) return UNTRUSTED_CLIENT_IP

  return (
    parseTrustedForwardingChain(request.headers.get(forwardingHeader)) ??
    UNTRUSTED_CLIENT_IP
  )
}

export function progressiveDelayMs(attempts: number): number {
  if (!Number.isSafeInteger(attempts)) {
    throw new Error("Invalid rate limit attempts")
  }

  const exponent = Math.min(Math.max(1, attempts) - 1, MAX_DELAY_EXPONENT)
  return BASE_DELAY_MILLISECONDS * 2 ** exponent
}
