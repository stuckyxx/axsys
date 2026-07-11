import { randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import postgres from "postgres"
import { afterAll, afterEach, describe, expect, it } from "vitest"

import { hashSensitive } from "@/lib/security/redact"
import {
  clearAccountFailureRateLimit,
  consumeRateLimit,
  type RateLimitBucket,
} from "@/lib/security/rate-limit"

if (!process.env.DATABASE_URL || !process.env.BFF_DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may inject the complete integration environment directly.
  }
}

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const OWNER_APPLICATION_NAME = "axsys-rate-limit-integration-owner"
const LOCK_TIMEOUT_MS = 6_000
const STATEMENT_TIMEOUT_MS = 10_000
const IDLE_TRANSACTION_TIMEOUT_MS = 10_000

type RateLimitFixture = {
  bucket: RateLimitBucket
  keyHash: string
  rawKey: string
}

function requireLocalAdminDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("Rate-limit integration database is unavailable")

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Rate-limit integration database is unavailable")
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "54322" ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Rate-limit integration database is unavailable")
  }

  return url.toString()
}

const ownerSql = postgres(
  requireLocalAdminDatabaseUrl(process.env.DATABASE_URL),
  {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: null,
    connection: {
      application_name: OWNER_APPLICATION_NAME,
      lock_timeout: LOCK_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_TRANSACTION_TIMEOUT_MS,
    },
  },
)

const fixtures: RateLimitFixture[] = []

function createFixture(bucket: RateLimitBucket): RateLimitFixture {
  const rawKey = `task9-${bucket}-${randomUUID()}`
  const fixture = { bucket, rawKey, keyHash: hashSensitive(rawKey) }
  fixtures.push(fixture)
  return fixture
}

async function cleanupFixtures(): Promise<void> {
  const pending = fixtures.splice(0)
  for (const fixture of pending) {
    await ownerSql`
      delete from private.rate_limit_buckets
      where bucket = ${fixture.bucket}
        and key_hash = ${fixture.keyHash}
    `
  }

  for (const fixture of pending) {
    const [residue] = await ownerSql<[{ count: number }]>`
      select count(*)::integer as count
      from private.rate_limit_buckets
      where bucket = ${fixture.bucket}
        and key_hash = ${fixture.keyHash}
    `
    expect(residue.count, `${fixture.bucket} fixture residue`).toBe(0)
  }
}

afterEach(async () => {
  await cleanupFixtures()
})

afterAll(async () => {
  try {
    await cleanupFixtures()
  } finally {
    await ownerSql.end({ timeout: 2 })
  }
})

describe("rate-limit security wrapper", () => {
  it.each([
    "login-ip-volume",
    "login-account-failure",
    "reauth-ip-volume",
    "reauth-account-failure",
    "forgot-ip-volume",
    "forgot-account-volume",
  ] as const)("uses the database-frozen policy for %s without persisting its raw key", async (bucket) => {
    const fixture = createFixture(bucket)

    await expect(consumeRateLimit(bucket, fixture.rawKey)).resolves.toEqual({
      allowed: true,
      attempts: 1,
      retryAfterSeconds: 0,
    })

    const [stored] = await ownerSql<
      [{ bucket: string; keyHash: string; serialized: string }]
    >`
      select
        bucket,
        key_hash as "keyHash",
        to_jsonb(rate_limit_buckets)::text as serialized
      from private.rate_limit_buckets
      where bucket = ${bucket}
        and key_hash = ${fixture.keyHash}
    `
    expect(stored).toMatchObject({ bucket, keyHash: fixture.keyHash })
    expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(stored.serialized).not.toContain(fixture.rawKey)
  })

  it("allows N attempts and atomically blocks N+1 for forgot-account-volume", async () => {
    const fixture = createFixture("forgot-account-volume")

    const allowed = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      allowed.push(
        await consumeRateLimit("forgot-account-volume", fixture.rawKey),
      )
    }
    const blocked = await consumeRateLimit(
      "forgot-account-volume",
      fixture.rawKey,
    )

    expect(allowed).toEqual([
      { allowed: true, attempts: 1, retryAfterSeconds: 0 },
      { allowed: true, attempts: 2, retryAfterSeconds: 0 },
      { allowed: true, attempts: 3, retryAfterSeconds: 0 },
    ])
    expect(blocked).toMatchObject({ allowed: false, attempts: 4 })
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it("serializes parallel calls so exactly five login account failures are allowed", async () => {
    const fixture = createFixture("login-account-failure")

    const decisions = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeRateLimit("login-account-failure", fixture.rawKey),
      ),
    )
    const allowed = decisions.filter((decision) => decision.allowed)
    const blocked = decisions.filter((decision) => !decision.allowed)

    expect(allowed).toHaveLength(5)
    expect(allowed.map((decision) => decision.attempts).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(blocked).toHaveLength(7)
    expect(blocked.every((decision) => decision.attempts === 6)).toBe(true)
    expect(
      blocked.every(
        (decision) =>
          decision.retryAfterSeconds > 0 && decision.retryAfterSeconds <= 900,
      ),
    ).toBe(true)

    const [stored] = await ownerSql<
      [{ attempts: number; blocked: boolean }]
    >`
      select
        attempts,
        blocked_until > clock_timestamp() as blocked
      from private.rate_limit_buckets
      where bucket = 'login-account-failure'
        and key_hash = ${fixture.keyHash}
    `
    expect(stored).toEqual({ attempts: 6, blocked: true })
  })

  it.each([
    "login-account-failure",
    "reauth-account-failure",
  ] as const)("clears the successful account-failure bucket %s", async (bucket) => {
    const fixture = createFixture(bucket)
    await consumeRateLimit(bucket, fixture.rawKey)

    await clearAccountFailureRateLimit(bucket, fixture.rawKey)

    const [remaining] = await ownerSql<[{ count: number }]>`
      select count(*)::integer as count
      from private.rate_limit_buckets
      where bucket = ${bucket}
        and key_hash = ${fixture.keyHash}
    `
    expect(remaining.count).toBe(0)
  })
})
