import { readdir, readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as changePasswordPost } from "@/app/api/auth/change-password/route"
import { GET as csrfGet } from "@/app/api/auth/csrf/route"
import { POST as forgotPasswordPost } from "@/app/api/auth/forgot-password/route"
import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as logoutPost } from "@/app/api/auth/logout/route"
import { GET as meGet } from "@/app/api/auth/me/route"
import { POST as resetPasswordPost } from "@/app/api/auth/reset-password/route"
import { PATCH as themePatch } from "@/app/api/profile/theme/route"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import {
  AdversarialLocalFixture,
  cookieStoreForAdversarialJar,
  type AdversarialCookieJar,
} from "../../helpers/adversarial-local-fixture"
import { requireLocalHttpUrl } from "../../helpers/local-destructive-urls"

const requestCookies = vi.hoisted(() => ({
  current: undefined as AdversarialCookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current) throw new Error("Task 17 cookie jar unavailable")
    return cookieStoreForAdversarialJar(requestCookies.current)
  },
}))

const fixture = new AdversarialLocalFixture("cache-headers")
const appOrigin = requireLocalHttpUrl(
  process.env.APP_ORIGIN,
  "3000",
  "Task 17 cache headers",
).replace(/\/$/u, "")

type RequestOptions = Readonly<{
  body?: unknown
  csrf?: string | null
  ip?: string
  method?: "GET" | "PATCH" | "POST"
  origin?: string | null
}>

function request(pathname: string, options: RequestOptions = {}): Request {
  const ip = options.ip ?? fixture.platform.clientIp
  fixture.trackRateKey(ip)
  const headers = new Headers({
    "user-agent": "task17-cache-headers",
    "x-correlation-id": fixture.nextCorrelationId(),
    "x-forwarded-for": ip,
  })
  if (options.body !== undefined) headers.set("content-type", "application/json")
  if (options.csrf !== null && options.csrf !== undefined) {
    headers.set("x-csrf-token", options.csrf)
  }
  if (options.origin !== null && options.origin !== undefined) {
    headers.set("origin", options.origin)
  }
  return new Request(`${appOrigin}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

function expectExactSensitiveHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe(
    NO_STORE_HEADERS["Cache-Control"],
  )
  expect(response.headers.get("pragma")).toBe(NO_STORE_HEADERS.Pragma)
  expect(response.headers.get("expires")).toBe(NO_STORE_HEADERS.Expires)
  expect(response.headers.get("vary")).toBe("Cookie, Authorization")
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(root, entry.name)
      if (entry.isDirectory()) return sourceFiles(absolute)
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [absolute] : []
    }),
  )
  return files.flat().sort()
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
}, 30_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 45_000)

describe.sequential("Task 17 sensitive response cache contract", () => {
  it("sets exact no-store and credential Vary headers on every auth/profile response", async () => {
    const jar = fixture.platform.jar
    requestCookies.current = jar

    const csrfResponse = await csrfGet()
    expect(csrfResponse.status).toBe(200)
    expectExactSensitiveHeaders(csrfResponse)
    const csrfBody = (await csrfResponse.json()) as { token?: unknown }
    expect(typeof csrfBody.token).toBe("string")
    if (typeof csrfBody.token !== "string") {
      throw new Error("Task 17 CSRF response is invalid")
    }

    const unknownEmail = `task17-cache-unknown-${randomUUID()}@example.test`
    fixture.trackRateKey(unknownEmail)
    const loginError = await loginPost(
      request("/api/auth/login", {
        body: {
          email: unknownEmail,
          password: "incorrect-credential",
          rememberMe: false,
        },
        csrf: csrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(loginError.status).toBe(401)
    expectExactSensitiveHeaders(loginError)

    const loginSuccess = await loginPost(
      request("/api/auth/login", {
        body: {
          email: fixture.platform.email,
          password: fixture.platform.password,
          rememberMe: false,
        },
        csrf: csrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(loginSuccess.status).toBe(200)
    expectExactSensitiveHeaders(loginSuccess)

    const me = await meGet(request("/api/auth/me"))
    expect(me.status).toBe(200)
    expectExactSensitiveHeaders(me)
    const meBody = (await me.clone().json()) as {
      profile?: { preferredTheme?: unknown; version?: unknown }
    }
    if (
      (meBody.profile?.preferredTheme !== "dark" &&
        meBody.profile?.preferredTheme !== "light") ||
      typeof meBody.profile.version !== "number"
    ) {
      throw new Error("Task 17 me response is invalid")
    }

    const theme = await themePatch(
      request("/api/profile/theme", {
        body: {
          theme:
            meBody.profile.preferredTheme === "dark" ? "light" : "dark",
          version: meBody.profile.version,
        },
        csrf: csrfBody.token,
        method: "PATCH",
        origin: appOrigin,
      }),
    )
    expect(theme.status).toBe(200)
    expectExactSensitiveHeaders(theme)

    const passwordChange = await changePasswordPost(
      request("/api/auth/change-password", {
        body: {
          password: "Axsys-Task17-NotForced-73!",
          confirmation: "Axsys-Task17-NotForced-73!",
        },
        csrf: csrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(passwordChange.status).toBe(403)
    expectExactSensitiveHeaders(passwordChange)

    const recoveryEmail = `task17-cache-recovery-${randomUUID()}@example.test`
    fixture.trackRateKey(recoveryEmail)
    const forgot = await forgotPasswordPost(
      request("/api/auth/forgot-password", {
        body: { email: recoveryEmail },
        csrf: csrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(forgot.status).toBe(202)
    expectExactSensitiveHeaders(forgot)

    const logout = await logoutPost(
      request("/api/auth/logout", {
        csrf: csrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(logout.status).toBe(204)
    expectExactSensitiveHeaders(logout)

    const resetCsrfResponse = await csrfGet()
    expect(resetCsrfResponse.status).toBe(200)
    expectExactSensitiveHeaders(resetCsrfResponse)
    const resetCsrfBody = (await resetCsrfResponse.json()) as { token?: unknown }
    if (typeof resetCsrfBody.token !== "string") {
      throw new Error("Task 17 reset CSRF response is invalid")
    }
    const reset = await resetPasswordPost(
      request("/api/auth/reset-password", {
        body: {
          password: "Axsys-Task17-NoRecovery-91!",
          confirmation: "Axsys-Task17-NoRecovery-91!",
        },
        csrf: resetCsrfBody.token,
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(reset.status).toBe(401)
    expectExactSensitiveHeaders(reset)
  }, 30_000)

  it("contains no static or persistent cache primitive in protected handlers", async () => {
    const roots = [
      path.resolve("src/app/api/auth"),
      path.resolve("src/app/api/profile"),
      path.resolve("src/app/(protected)"),
    ]
    const files = (await Promise.all(roots.map(sourceFiles))).flat().sort()
    expect(files.length).toBeGreaterThan(0)

    const forbidden = [
      /export\s+const\s+revalidate\b/u,
      /export\s+const\s+dynamic\s*=\s*["']force-static["']/u,
      /^[\t ]*["']use cache["'];?[\t ]*$/mu,
      /\bunstable_cache\b/u,
      /\bcache\s*:\s*["']force-cache["']/u,
    ]
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, "utf8")
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(process.cwd(), file)}:${pattern.source}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
