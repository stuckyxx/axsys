import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { GET as meGet } from "@/app/api/auth/me/route"
import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as temporaryPasswordPost } from "@/app/api/auth/temporary-password/route"
import { PATCH as themePatch } from "@/app/api/profile/theme/route"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import {
  AdversarialLocalFixture,
  cookieStoreForAdversarialJar,
  type AdversarialCookieJar,
  type AdversarialIdentity,
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

const fixture = new AdversarialLocalFixture("idor-matrix")
const appOrigin = requireLocalHttpUrl(
  process.env.APP_ORIGIN,
  "3000",
  "Task 17 IDOR matrix",
).replace(/\/$/u, "")

type RequestOptions = Readonly<{
  body?: unknown
  csrf?: string | null
  ip?: string
  method?: "GET" | "PATCH" | "POST"
  origin?: string | null
}>

function request(path: string, options: RequestOptions = {}): Request {
  const method = options.method ?? "GET"
  const ip = options.ip ?? "2001:db8:17::1"
  fixture.trackRateKey(ip)
  const headers = new Headers({
    "user-agent": "task17-idor-matrix",
    "x-correlation-id": fixture.nextCorrelationId(),
    "x-forwarded-for": ip,
  })
  if (options.body !== undefined) headers.set("content-type", "application/json")
  if (options.origin !== null && options.origin !== undefined) {
    headers.set("origin", options.origin)
  }
  if (options.csrf !== null && options.csrf !== undefined) {
    headers.set("x-csrf-token", options.csrf)
  }
  return new Request(`${appOrigin}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

async function errorIdentity(response: Response) {
  const body = (await response.json()) as {
    error?: { code?: unknown; message?: unknown }
  }
  return {
    code: body.error?.code,
    message: body.error?.message,
    status: response.status,
  }
}

async function accessObservation(response: Response) {
  const rawBody = (await response.json()) as unknown
  const body =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as Record<string, unknown>)
      : {}
  return {
    companyId: body.companyId,
    hasCompanyId: Object.hasOwn(body, "companyId"),
    hasMembershipId: Object.hasOwn(body, "membershipId"),
    hasRole: Object.hasOwn(body, "role"),
    keys: Object.keys(body).sort(),
    kind: body.kind,
    modules: body.modules,
    userId: body.userId,
  }
}

async function authenticate(identity: AdversarialIdentity): Promise<void> {
  requestCookies.current = identity.jar
  const csrf = fixture.issueCsrf(identity.jar)
  const response = await loginPost(
    request("/api/auth/login", {
      body: {
        email: identity.email,
        password: identity.password,
        rememberMe: false,
      },
      csrf,
      ip: identity.clientIp,
      method: "POST",
      origin: appOrigin,
    }),
  )
  expect(response.status).toBe(200)
  expectNoStore(response)
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
  await authenticate(fixture.adminA)
  await authenticate(fixture.memberA)
  await authenticate(fixture.adminB)
  await authenticate(fixture.platform)
}, 45_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 45_000)

describe.sequential("Task 17 adversarial handler IDOR matrix", () => {
  it("keeps cross-tenant and unknown temporary-password targets neutral and unchanged", async () => {
    requestCookies.current = fixture.adminA.jar
    const before = await fixture.passwordSecurityState(fixture.adminB.userId)
    const csrf = fixture.issueCsrf(fixture.adminA.jar)
    const crossTenant = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: fixture.adminB.userId,
          password: "Axsys-Task17-CrossTenant-82!",
        },
        csrf,
        ip: fixture.adminA.clientIp,
        method: "POST",
        origin: appOrigin,
      }),
    )
    const unknown = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: randomUUID(),
          password: "Axsys-Task17-Unknown-82!",
        },
        csrf,
        ip: fixture.adminA.clientIp,
        method: "POST",
        origin: appOrigin,
      }),
    )

    expectNoStore(crossTenant)
    expectNoStore(unknown)
    const crossTenantError = await errorIdentity(crossTenant)
    const unknownError = await errorIdentity(unknown)
    expect(crossTenantError).toEqual({
      code: "USER_NOT_FOUND",
      message: unknownError.message,
      status: 404,
    })
    expect(unknownError).toMatchObject({ code: "USER_NOT_FOUND", status: 404 })
    await expect(
      fixture.passwordSecurityState(fixture.adminB.userId),
    ).resolves.toEqual(before)
  })

  it("denies an ordinary member resetting a same-tenant user", async () => {
    requestCookies.current = fixture.memberA.jar
    const before = await fixture.passwordSecurityState(fixture.adminA.userId)
    const response = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: fixture.adminA.userId,
          password: "Axsys-Task17-OrdinaryMember-82!",
        },
        csrf: fixture.issueCsrf(fixture.memberA.jar),
        ip: fixture.memberA.clientIp,
        method: "POST",
        origin: appOrigin,
      }),
    )

    expect(response.status).toBe(403)
    expectNoStore(response)
    await expect(errorIdentity(response)).resolves.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    })
    await expect(
      fixture.passwordSecurityState(fixture.adminA.userId),
    ).resolves.toEqual(before)
  })

  it("rejects tenant selectors in strict bodies and ignores them in me queries", async () => {
    const attackJar: AdversarialCookieJar = new Map()
    requestCookies.current = attackJar
    const attackedLogin = await loginPost(
      request("/api/auth/login", {
        body: {
          companyId: fixture.companyBId,
          email: fixture.adminA.email,
          password: fixture.adminA.password,
          rememberMe: false,
        },
        csrf: fixture.issueCsrf(attackJar),
        ip: "2001:db8:17::2",
        method: "POST",
        origin: appOrigin,
      }),
    )
    expect(attackedLogin.status).toBe(422)
    expectNoStore(attackedLogin)

    requestCookies.current = fixture.adminA.jar
    const me = await meGet(
      request(`/api/auth/me?companyId=${fixture.companyBId}`, {
        ip: fixture.adminA.clientIp,
      }),
    )
    expect(me.status).toBe(200)
    expectNoStore(me)
    await expect(accessObservation(me)).resolves.toMatchObject({
      companyId: fixture.companyAId,
      hasCompanyId: true,
      hasMembershipId: false,
      hasRole: true,
      kind: "company",
      userId: fixture.adminA.userId,
    })

    const current = await meGet(request("/api/auth/me"))
    const currentBody = (await current.clone().json()) as {
      profile?: { version?: number }
    }
    const version = currentBody.profile?.version
    expect(typeof version).toBe("number")
    const attackedTheme = await themePatch(
      request("/api/profile/theme", {
        body: {
          companyId: fixture.companyBId,
          theme: "light",
          version,
        },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        ip: fixture.adminA.clientIp,
        method: "PATCH",
        origin: appOrigin,
      }),
    )
    expect(attackedTheme.status).toBe(422)
    expectNoStore(attackedTheme)
  })

  it("returns platform me without tenant membership or operational modules", async () => {
    requestCookies.current = fixture.platform.jar
    const response = await meGet(
      request(`/api/auth/me?companyId=${fixture.companyBId}`, {
        ip: fixture.platform.clientIp,
      }),
    )
    const body = await accessObservation(response.clone())

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body.keys).toEqual([
      "kind",
      "modules",
      "profile",
      "userId",
    ])
    expect(body).toMatchObject({
      hasCompanyId: false,
      hasMembershipId: false,
      hasRole: false,
      kind: "platform",
      modules: [],
      userId: fixture.platform.userId,
    })
  })

  it("keeps valid and unknown protected UUIDs equally anonymous", async () => {
    const visitorJar: AdversarialCookieJar = new Map()
    requestCookies.current = visitorJar
    const targetBefore = await fixture.passwordSecurityState(
      fixture.adminB.userId,
    )
    const validGet = await meGet(
      request(`/api/auth/me?companyId=${fixture.companyBId}`),
    )
    const unknownGet = await meGet(
      request(`/api/auth/me?companyId=${randomUUID()}`),
    )
    expect(await errorIdentity(validGet)).toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    })
    expect(await errorIdentity(unknownGet)).toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    })

    const csrf = fixture.issueCsrf(visitorJar)
    const validPost = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: fixture.adminB.userId,
          password: "Axsys-Task17-Visitor-Valid-82!",
        },
        csrf,
        method: "POST",
        origin: appOrigin,
      }),
    )
    const unknownPost = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: randomUUID(),
          password: "Axsys-Task17-Visitor-Unknown-82!",
        },
        csrf,
        method: "POST",
        origin: appOrigin,
      }),
    )
    const validError = await errorIdentity(validPost)
    const unknownError = await errorIdentity(unknownPost)
    expect(validError).toEqual({
      code: "AUTH_REQUIRED",
      message: unknownError.message,
      status: 401,
    })
    expect(unknownError).toMatchObject({ code: "AUTH_REQUIRED", status: 401 })
    await expect(
      fixture.passwordSecurityState(fixture.adminB.userId),
    ).resolves.toEqual(targetBefore)
  })

  it("rejects missing CSRF and external Origin before any mutation", async () => {
    requestCookies.current = fixture.adminA.jar
    const targetBefore = await fixture.passwordSecurityState(fixture.adminA.userId)
    const missingCsrf = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: fixture.adminA.userId,
          password: "Axsys-Task17-MissingCsrf-82!",
        },
        ip: fixture.adminA.clientIp,
        method: "POST",
        origin: appOrigin,
      }),
    )
    const externalOrigin = await temporaryPasswordPost(
      request("/api/auth/temporary-password", {
        body: {
          targetUserId: fixture.adminA.userId,
          password: "Axsys-Task17-ExternalOrigin-82!",
        },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        ip: fixture.adminA.clientIp,
        method: "POST",
        origin: "https://attacker.example.test",
      }),
    )

    await expect(errorIdentity(missingCsrf)).resolves.toMatchObject({
      code: "CSRF_INVALID",
      status: 403,
    })
    await expect(errorIdentity(externalOrigin)).resolves.toMatchObject({
      code: "ORIGIN_INVALID",
      status: 403,
    })
    await expect(
      fixture.passwordSecurityState(fixture.adminA.userId),
    ).resolves.toEqual(targetBefore)
  })

  it("keeps known and unknown login failures observationally identical", async () => {
    const knownJar: AdversarialCookieJar = new Map()
    const unknownJar: AdversarialCookieJar = new Map()
    const unknownEmail = `task17-unknown-${randomUUID()}@example.test`
    fixture.trackRateKey(unknownEmail)

    requestCookies.current = knownJar
    const known = await loginPost(
      request("/api/auth/login", {
        body: {
          email: fixture.adminA.email,
          password: "incorrect-credential",
          rememberMe: false,
        },
        csrf: fixture.issueCsrf(knownJar),
        ip: "2001:db8:17::3",
        method: "POST",
        origin: appOrigin,
      }),
    )
    requestCookies.current = unknownJar
    const unknown = await loginPost(
      request("/api/auth/login", {
        body: {
          email: unknownEmail,
          password: "incorrect-credential",
          rememberMe: false,
        },
        csrf: fixture.issueCsrf(unknownJar),
        ip: "2001:db8:17::4",
        method: "POST",
        origin: appOrigin,
      }),
    )

    expectNoStore(known)
    expectNoStore(unknown)
    const knownError = await errorIdentity(known)
    const unknownError = await errorIdentity(unknown)
    expect(knownError).toEqual({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "E-mail ou senha inválidos.",
      status: 401,
    })
    expect(unknownError).toEqual(knownError)
  })
})
