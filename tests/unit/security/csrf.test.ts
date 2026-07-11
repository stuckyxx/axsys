import { Buffer } from "node:buffer"
import { readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest"

import { ApiError } from "@/lib/http/api-error"
import * as csrfRoute from "@/app/api/auth/csrf/route"
import {
  CSRF_FUTURE_SKEW_SECONDS,
  CSRF_MAX_TOKEN_LENGTH,
  CSRF_TOKEN_TTL_SECONDS,
  assertCsrf,
  createCsrfToken,
  verifyCsrfToken,
} from "@/lib/security/csrf"
import { assertMutationOrigin } from "@/lib/security/origin"
import * as rateLimitSecurity from "@/lib/security/rate-limit"
import {
  UNTRUSTED_CLIENT_IP,
  clearAccountFailureRateLimit,
  consumeRateLimit,
  getClientIp,
  progressiveDelayMs,
  type AccountFailureRateLimitBucket,
  type RateLimitBucket,
} from "@/lib/security/rate-limit"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { TEST_FILE_SERVICE_ENV } from "../../helpers/file-service-env"

const rateLimitMocks = vi.hoisted(() => ({
  clearRateLimit: vi.fn(),
  consumeRateLimit: vi.fn(),
  hashSensitive: vi.fn(),
}))

const csrfRouteMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    clearRateLimit: rateLimitMocks.clearRateLimit,
    consumeRateLimit: rateLimitMocks.consumeRateLimit,
  },
}))

vi.mock("@/lib/security/redact", () => ({
  hashSensitive: rateLimitMocks.hashSensitive,
}))

vi.mock("next/headers", () => ({
  cookies: csrfRouteMocks.cookies,
}))

const APP_ORIGIN = "https://axsys.test"
const CSRF_SECRET = "s".repeat(32)
const NOW_SECONDS = 1_700_000_000
const KEY_HASH = "a".repeat(64)

function stubServerEnv(
  trustProxy: "true" | "false" = "false",
  appOrigin = "http://127.0.0.1:3000",
): void {
  vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"s".repeat(24)}`)
  vi.stubEnv(
    "BFF_DATABASE_URL",
    "postgresql://axsys_bff:local-only@127.0.0.1:54322/postgres",
  )
  vi.stubEnv("APP_ORIGIN", appOrigin)
  vi.stubEnv("CSRF_SECRET", "c".repeat(32))
  vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
  vi.stubEnv("TRUST_PROXY", trustProxy)
  vi.stubEnv("VERCEL", undefined)
  for (const [name, value] of Object.entries(TEST_FILE_SERVICE_ENV)) {
    vi.stubEnv(name, value)
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

beforeEach(() => {
  rateLimitMocks.hashSensitive.mockReturnValue(KEY_HASH)
  rateLimitMocks.consumeRateLimit.mockResolvedValue({
    allowed: true,
    attempts: 1,
    retryAfterSeconds: 0,
  })
  rateLimitMocks.clearRateLimit.mockResolvedValue(undefined)
  csrfRouteMocks.get.mockReturnValue(undefined)
  csrfRouteMocks.set.mockReturnValue(undefined)
  csrfRouteMocks.cookies.mockResolvedValue({
    get: csrfRouteMocks.get,
    set: csrfRouteMocks.set,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("mutation Origin", () => {
  it("accepts only the exact configured canonical origin", () => {
    stubServerEnv("false", APP_ORIGIN)

    expectTypeOf<Parameters<typeof assertMutationOrigin>>().toEqualTypeOf<
      [origin: string | null]
    >()
    expect(assertMutationOrigin(APP_ORIGIN)).toBeUndefined()
  })

  it.each([
    null,
    "",
    "null",
    "https://axsys.test/",
    "https://AXSYS.test",
    "https://axsys.test:443",
    "http://axsys.test",
    "https://sub.axsys.test",
    "https://axsys.test.evil.test",
    "https://user:password@axsys.test",
    "https://axsys.test/path",
    "https://axsys.test?next=/private",
    "https://axsys.test#fragment",
    "https://axsys.test, https://evil.test",
  ])("rejects a missing or non-exact Origin: %s", (origin) => {
    stubServerEnv("false", APP_ORIGIN)
    let thrown: unknown
    try {
      assertMutationOrigin(origin)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(
      new ApiError(
        "ORIGIN_INVALID",
        403,
        "Origem da requisição recusada.",
      ),
    )
  })

})

function replaceLastBase64UrlCharacterWithNonCanonicalBits(value: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const last = value.at(-1) ?? ""
  const index = alphabet.indexOf(last)
  if (index < 0 || index % 4 !== 0) {
    throw new Error("Expected canonical 32-byte base64url")
  }
  const replacement = alphabet[index + 1]
  return `${value.slice(0, -1)}${replacement}`
}

describe("signed double-submit CSRF", () => {
  it("creates a canonical token with a decimal timestamp and two 32-byte base64url segments", () => {
    const token = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
    const second = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
    const [issuedAt, nonce, signature] = token.split(".")

    expect(token.length).toBeLessThanOrEqual(CSRF_MAX_TOKEN_LENGTH)
    expect(issuedAt).toBe(String(NOW_SECONDS))
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Buffer.from(nonce, "base64url")).toHaveLength(32)
    expect(Buffer.from(signature, "base64url")).toHaveLength(32)
    expect(second).not.toBe(token)
  })

  it("accepts an exact matching header and cookie signed by the configured secret", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_SECONDS * 1_000)
    stubServerEnv()
    const token = createCsrfToken("c".repeat(32), NOW_SECONDS)

    expect(
      verifyCsrfToken(token, token, "c".repeat(32), NOW_SECONDS),
    ).toBe(true)
    expectTypeOf<Parameters<typeof assertCsrf>>().toEqualTypeOf<
      [header: string | null, cookie: string | null]
    >()
    expect(assertCsrf(token, token)).toBeUndefined()
  })

  it.each([
    [null, null],
    ["", ""],
    ["token", null],
    [null, "token"],
    ["header-token", "cookie-token"],
  ] as const)("rejects a missing or mismatched double-submit pair", (header, cookie) => {
    expect(
      verifyCsrfToken(header, cookie, CSRF_SECRET, NOW_SECONDS),
    ).toBe(false)
  })

  it("rejects a secret mismatch and a one-bit signature change", () => {
    const token = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
    const [issuedAt, nonce, signature] = token.split(".") as [
      string,
      string,
      string,
    ]
    const changedFirstCharacter = signature.startsWith("A") ? "B" : "A"
    const tampered = `${issuedAt}.${nonce}.${changedFirstCharacter}${signature.slice(1)}`

    expect(
      verifyCsrfToken(token, token, "x".repeat(32), NOW_SECONDS),
    ).toBe(false)
    expect(
      verifyCsrfToken(tampered, tampered, CSRF_SECRET, NOW_SECONDS),
    ).toBe(false)
  })

  it("accepts the exact TTL and future-skew boundaries and rejects one second beyond", () => {
    const oldestValid = createCsrfToken(
      CSRF_SECRET,
      NOW_SECONDS - CSRF_TOKEN_TTL_SECONDS,
    )
    const expired = createCsrfToken(
      CSRF_SECRET,
      NOW_SECONDS - CSRF_TOKEN_TTL_SECONDS - 1,
    )
    const furthestValidFuture = createCsrfToken(
      CSRF_SECRET,
      NOW_SECONDS + CSRF_FUTURE_SKEW_SECONDS,
    )
    const tooFarFuture = createCsrfToken(
      CSRF_SECRET,
      NOW_SECONDS + CSRF_FUTURE_SKEW_SECONDS + 1,
    )

    expect(
      verifyCsrfToken(oldestValid, oldestValid, CSRF_SECRET, NOW_SECONDS),
    ).toBe(true)
    expect(
      verifyCsrfToken(expired, expired, CSRF_SECRET, NOW_SECONDS),
    ).toBe(false)
    expect(
      verifyCsrfToken(
        furthestValidFuture,
        furthestValidFuture,
        CSRF_SECRET,
        NOW_SECONDS,
      ),
    ).toBe(true)
    expect(
      verifyCsrfToken(tooFarFuture, tooFarFuture, CSRF_SECRET, NOW_SECONDS),
    ).toBe(false)
  })

  it("rejects non-canonical timestamps, segment counts, alphabets, lengths, and padding", () => {
    const token = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
    const [, nonce, signature] = token.split(".") as [string, string, string]
    const malformed = [
      `${NOW_SECONDS}`,
      `${NOW_SECONDS}.${nonce}`,
      `${NOW_SECONDS}.${nonce}.${signature}.extra`,
      `0${NOW_SECONDS}.${nonce}.${signature}`,
      `+${NOW_SECONDS}.${nonce}.${signature}`,
      `${NOW_SECONDS}.0.${signature}`,
      `${NOW_SECONDS}.${nonce}=.${signature}`,
      `${NOW_SECONDS}.${nonce.replace(/.$/u, "+")}.${signature}`,
      `${NOW_SECONDS}.${nonce}.${signature}=`,
      `${NOW_SECONDS}.${nonce}.${signature.replace(/.$/u, "/")}`,
      `${NOW_SECONDS}.${"n".repeat(42)}.${signature}`,
      `${NOW_SECONDS}.${nonce}.${"s".repeat(44)}`,
      "x".repeat(CSRF_MAX_TOKEN_LENGTH + 1),
      "🚀".repeat(CSRF_MAX_TOKEN_LENGTH + 1),
    ]

    for (const candidate of malformed) {
      expect(
        verifyCsrfToken(candidate, candidate, CSRF_SECRET, NOW_SECONDS),
        candidate.slice(0, 30),
      ).toBe(false)
    }
  })

  it("rejects non-canonical base64url encodings even when they decode to the same bytes", () => {
    const token = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
    const [issuedAt, nonce, signature] = token.split(".") as [
      string,
      string,
      string,
    ]
    const nonCanonicalNonce = replaceLastBase64UrlCharacterWithNonCanonicalBits(nonce)
    const nonCanonicalSignature =
      replaceLastBase64UrlCharacterWithNonCanonicalBits(signature)

    expect(Buffer.from(nonCanonicalNonce, "base64url")).toEqual(
      Buffer.from(nonce, "base64url"),
    )
    expect(Buffer.from(nonCanonicalSignature, "base64url")).toEqual(
      Buffer.from(signature, "base64url"),
    )
    expect(
      verifyCsrfToken(
        `${issuedAt}.${nonCanonicalNonce}.${signature}`,
        `${issuedAt}.${nonCanonicalNonce}.${signature}`,
        CSRF_SECRET,
        NOW_SECONDS,
      ),
    ).toBe(false)
    expect(
      verifyCsrfToken(
        `${issuedAt}.${nonce}.${nonCanonicalSignature}`,
        `${issuedAt}.${nonce}.${nonCanonicalSignature}`,
        CSRF_SECRET,
        NOW_SECONDS,
      ),
    ).toBe(false)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "fails closed for a pathological current time: %s",
    (nowSeconds) => {
      const token = createCsrfToken(CSRF_SECRET, NOW_SECONDS)
      expect(
        verifyCsrfToken(token, token, CSRF_SECRET, nowSeconds),
      ).toBe(false)
      expect(() => createCsrfToken(CSRF_SECRET, nowSeconds)).toThrow(
        "Invalid CSRF timestamp",
      )
    },
  )

  it("rejects weak direct-call secrets and exposes only the stable ApiError", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_SECONDS * 1_000)
    stubServerEnv()
    const token = createCsrfToken("c".repeat(32), NOW_SECONDS)
    expect(
      verifyCsrfToken(token, token, "short", NOW_SECONDS),
    ).toBe(false)
    expect(() => createCsrfToken("short", NOW_SECONDS)).toThrow(
      "Invalid CSRF secret",
    )

    let thrown: unknown
    try {
      assertCsrf(`${token}x`, token)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toEqual(
      new ApiError("CSRF_INVALID", 403, "Token de segurança inválido."),
    )
    expect(String(thrown)).not.toContain(token)
  })

  it("uses a timing-safe comparison for the fixed-length decoded MAC", () => {
    const source = readFileSync(resolve("src/lib/security/csrf.ts"), "utf8")

    expect(source).toContain("timingSafeEqual")
    expect(source).toMatch(/timingSafeEqual\(expectedSignature, receivedSignature\)/u)
  })
})

describe("CSRF token route", () => {
  it("issues the token in JSON and a strict __Host cookie with no-store and no CORS", async () => {
    stubServerEnv()

    const response = await csrfRoute.GET()
    const body = (await response.json()) as { token: string }

    expect(response.status).toBe(200)
    expect(
      verifyCsrfToken(body.token, body.token, "c".repeat(32)),
    ).toBe(true)
    expect(csrfRouteMocks.get).toHaveBeenCalledWith("__Host-axsys-csrf")
    expect(csrfRouteMocks.set).toHaveBeenCalledWith(
      "__Host-axsys-csrf",
      body.token,
      {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: CSRF_TOKEN_TTL_SECONDS,
      },
    )
    const cookieOptions = csrfRouteMocks.set.mock.calls[0]?.[2]
    expect(cookieOptions).not.toHaveProperty("domain")
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-headers",
      "access-control-allow-methods",
    ]) {
      expect(response.headers.get(name)).toBeNull()
    }
    expect(csrfRoute).not.toHaveProperty("OPTIONS")
  })

  it("reuses one still-valid cookie across two interleaved tab fetches", async () => {
    stubServerEnv()
    const existing = createCsrfToken("c".repeat(32))
    csrfRouteMocks.get.mockReturnValue({
      name: "__Host-axsys-csrf",
      value: existing,
    })

    const firstResponse = await csrfRoute.GET()
    const secondResponse = await csrfRoute.GET()
    const first = (await firstResponse.json()) as { token: string }
    const second = (await secondResponse.json()) as { token: string }

    expect(first.token).toBe(existing)
    expect(second.token).toBe(existing)
    expect(csrfRouteMocks.set).not.toHaveBeenCalled()
  })

  it.each([
    ["malformed", "malformed"],
    [
      "expired",
      createCsrfToken(
        "c".repeat(32),
        NOW_SECONDS - CSRF_TOKEN_TTL_SECONDS - 1,
      ),
    ],
    [
      "too-far-future",
      createCsrfToken(
        "c".repeat(32),
        NOW_SECONDS + CSRF_FUTURE_SKEW_SECONDS + 1,
      ),
    ],
  ])("rotates a %s existing cookie", async (_case, existing) => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_SECONDS * 1_000)
    stubServerEnv()
    csrfRouteMocks.get.mockReturnValue({
      name: "__Host-axsys-csrf",
      value: existing,
    })

    const response = await csrfRoute.GET()
    const body = (await response.json()) as { token: string }

    expect(body.token).not.toBe(existing)
    expect(
      verifyCsrfToken(body.token, body.token, "c".repeat(32), NOW_SECONDS),
    ).toBe(true)
    expect(csrfRouteMocks.set).toHaveBeenCalledOnce()
  })
})

describe("rate-limit policy boundary", () => {
  it("exports only the six frozen bucket literals through a two-argument consume API", () => {
    expectTypeOf<RateLimitBucket>().toEqualTypeOf<
      | "login-ip-volume"
      | "login-account-failure"
      | "reauth-ip-volume"
      | "reauth-account-failure"
      | "forgot-ip-volume"
      | "forgot-account-volume"
    >()
    expectTypeOf<Parameters<typeof consumeRateLimit>>().toEqualTypeOf<
      [bucket: RateLimitBucket, rawKey: string]
    >()
    expect(consumeRateLimit).toHaveLength(2)
    expect(rateLimitSecurity).not.toHaveProperty("clearRateLimit")
  })

  it.each([
    ["login-ip-volume", 30, 900, 1800],
    ["login-account-failure", 5, 900, 900],
    ["reauth-ip-volume", 20, 900, 1800],
    ["reauth-account-failure", 5, 900, 900],
    ["forgot-ip-volume", 10, 900, 60],
    ["forgot-account-volume", 3, 3600, 60],
  ] as const)(
    "maps %s to its exact immutable database tuple",
    async (bucket, limit, windowSeconds, blockSeconds) => {
      const rawKey = `raw-${bucket}`

      await expect(consumeRateLimit(bucket, rawKey)).resolves.toEqual({
        allowed: true,
        attempts: 1,
        retryAfterSeconds: 0,
      })

      expect(rateLimitMocks.hashSensitive).toHaveBeenCalledWith(rawKey)
      expect(rateLimitMocks.consumeRateLimit).toHaveBeenCalledWith({
        bucket,
        keyHash: KEY_HASH,
        limit,
        windowSeconds,
        blockSeconds,
      })
      expect(JSON.stringify(rateLimitMocks.consumeRateLimit.mock.calls)).not.toContain(
        rawKey,
      )
    },
  )

  it("fails before hashing or database access for a runtime bucket outside the allowlist", async () => {
    const rawKey = "must-never-reach-the-database"

    await expect(
      consumeRateLimit("invented-bucket" as RateLimitBucket, rawKey),
    ).rejects.toThrow("Invalid rate limit bucket")
    expect(rateLimitMocks.hashSensitive).not.toHaveBeenCalled()
    expect(rateLimitMocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it("keeps every application caller behind the frozen policy wrapper", () => {
    const wrapper = resolve("src/lib/security/rate-limit.ts")
    const bypasses = sourceFiles(resolve("src")).filter(
      (path) =>
        path !== wrapper &&
        /\bbffDb\.(?:consumeRateLimit|clearRateLimit)\b/u.test(
          readFileSync(path, "utf8"),
        ),
    )

    expect(bypasses).toEqual([])
  })

  it.each([
    "login-account-failure",
    "reauth-account-failure",
  ] as const)("clears only the account-failure bucket %s", async (bucket) => {
    expectTypeOf<AccountFailureRateLimitBucket>().toEqualTypeOf<
      "login-account-failure" | "reauth-account-failure"
    >()
    expectTypeOf<Parameters<typeof clearAccountFailureRateLimit>>().toEqualTypeOf<
      [bucket: AccountFailureRateLimitBucket, rawKey: string]
    >()

    await clearAccountFailureRateLimit(bucket, `raw-${bucket}`)

    expect(rateLimitMocks.clearRateLimit).toHaveBeenCalledWith(bucket, KEY_HASH)
  })

  it("rejects a runtime attempt to clear a non-account bucket", async () => {
    await expect(
      clearAccountFailureRateLimit(
        "forgot-account-volume" as AccountFailureRateLimitBucket,
        "raw-key",
      ),
    ).rejects.toThrow("Invalid rate limit clear bucket")
    expect(rateLimitMocks.hashSensitive).not.toHaveBeenCalled()
    expect(rateLimitMocks.clearRateLimit).not.toHaveBeenCalled()
  })
})

describe("client IP extraction", () => {
  it("ignores spoofed forwarding headers when no trusted proxy is configured", () => {
    stubServerEnv("false")
    const request = new Request("https://axsys.test/api", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-vercel-forwarded-for": "203.0.113.11",
      },
    })

    expect(getClientIp(request)).toBe(UNTRUSTED_CLIENT_IP)
  })

  it("uses the right-most validated hop so a prepended value cannot select the key", () => {
    stubServerEnv("true")
    const request = new Request("https://axsys.test/api", {
      headers: {
        "x-forwarded-for": "198.51.100.77, 203.0.113.12",
      },
    })

    expect(getClientIp(request)).toBe("203.0.113.12")
  })

  it.each([
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["::ffff:192.0.2.128", "192.0.2.128"],
    ["192.0.2.128", "192.0.2.128"],
  ])("canonicalizes the trusted IP %s to %s", (forwarded, expected) => {
    stubServerEnv("true")
    const request = new Request("https://axsys.test/api", {
      headers: { "x-forwarded-for": forwarded },
    })

    expect(getClientIp(request)).toBe(expected)
  })

  it("trusts only the Vercel-specific header in a Vercel deployment", () => {
    stubServerEnv("false")
    vi.stubEnv("VERCEL", "1")
    const request = new Request("https://axsys.test/api", {
      headers: {
        "x-forwarded-for": "198.51.100.99",
        "x-vercel-forwarded-for": "198.51.100.20, 203.0.113.20",
      },
    })

    expect(getClientIp(request)).toBe("203.0.113.20")
    expect(
      getClientIp(
        new Request("https://axsys.test/api", {
          headers: { "x-forwarded-for": "198.51.100.99" },
        }),
      ),
    ).toBe(UNTRUSTED_CLIENT_IP)
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["malformed", "unknown"],
    ["IPv4 with port", "192.0.2.1:443"],
    ["IPv6 with port", "[2001:db8::1]:443"],
    ["malformed intermediate hop", "198.51.100.1, nope, 203.0.113.1"],
    [
      "too many hops",
      Array.from({ length: 9 }, (_, index) => `192.0.2.${index + 1}`).join(","),
    ],
    ["oversized header", "1".repeat(1_025)],
  ])("uses the stable fail-closed sentinel for a %s chain", (_case, forwarded) => {
    stubServerEnv("true")
    const headers = new Headers()
    if (forwarded !== undefined) headers.set("x-forwarded-for", forwarded)

    expect(
      getClientIp(new Request("https://axsys.test/api", { headers })),
    ).toBe(UNTRUSTED_CLIENT_IP)
  })
})

describe("progressive rate-limit delay", () => {
  it.each([
    [-10, 250],
    [0, 250],
    [1, 250],
    [2, 500],
    [3, 1_000],
    [4, 2_000],
    [5, 4_000],
    [6, 4_000],
    [Number.MAX_SAFE_INTEGER, 4_000],
  ])("maps attempt %s to a bounded %sms delay", (attempts, expected) => {
    expect(progressiveDelayMs(attempts)).toBe(expected)
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects the pathological attempt count %s", (attempts) => {
    expect(() => progressiveDelayMs(attempts)).toThrow(
      "Invalid rate limit attempts",
    )
  })
})
