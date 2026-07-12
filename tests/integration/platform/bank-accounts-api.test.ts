import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext, createPlatformContext } from "../../helpers/auth"

type RouteContext = Readonly<{
  params: Promise<{ companyId: string; bankAccountId?: string }>
}>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH", Handler>>

const fixtures = vi.hoisted(() => ({
  companyA: "85000000-0000-4000-8000-000000000001",
  companyB: "85000000-0000-4000-8000-000000000002",
  bankA: "86000000-0000-4000-8000-000000000001",
  bankB: "86000000-0000-4000-8000-000000000002",
}))
const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createPlatformContext> | ReturnType<typeof createCompanyContext> | null,
  rateAllowed: true,
  recent: [] as number[],
  versionConflict: false,
}))
const security = vi.hoisted(() => ({
  csrfCalls: [] as Array<string | null>,
  originCalls: [] as Array<string | null>,
}))
const summary = vi.hoisted(() => ({
  id: fixtures.bankA,
  companyId: fixtures.companyA,
  bankCode: "001",
  bankName: "Banco Seguro",
  maskedBranch: "1234",
  maskedAccount: "6543",
  accountType: "checking" as const,
  holderName: "Empresa A",
  maskedHolderDocument: "••••8901",
  isDefault: true,
  status: "active" as const,
  version: 1,
  createdAt: "2026-07-12T12:00:00.000Z",
  updatedAt: "2026-07-12T12:00:00.000Z",
}))
const service = vi.hoisted(() => ({
  listPlatformBankAccounts: vi.fn(async ({ companyId }: { companyId: string }) => {
    if (companyId !== fixtures.companyA) throw new ApiError("BANK_ACCOUNT_NOT_FOUND", 404, "Conta bancária não encontrada.")
    return [summary]
  }),
  listCompanyBankAccounts: vi.fn(async ({ context }: { context: { companyId: string } }) =>
    context.companyId === fixtures.companyA ? [summary] : [],
  ),
  createBankAccount: vi.fn(async () => summary),
  updateBankAccount: vi.fn(async () => {
    if (state.versionConflict) {
      throw new ApiError("VERSION_CONFLICT", 409, "A conta bancária foi alterada por outra sessão.")
    }
    return { ...summary, version: 2 }
  }),
  setDefaultBankAccount: vi.fn(async () => ({ ...summary, version: 2 })),
  archiveBankAccount: vi.fn(async () => ({ ...summary, status: "archived", isDefault: false, version: 2 })),
}))

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "csrf" }) }) }))
vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: vi.fn((header: string | null) => {
    security.csrfCalls.push(header)
    if (header !== "csrf") throw new ApiError("CSRF_INVALID", 403, "Token de segurança inválido.")
  }),
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))
vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: vi.fn((origin: string | null) => {
    security.originCalls.push(origin)
    if (origin !== "http://127.0.0.1:3000") throw new ApiError("ORIGIN_INVALID", 403, "Origem recusada.")
  }),
}))
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: vi.fn(async () => ({ allowed: state.rateAllowed, attempts: 1, retryAfterSeconds: 60 })) }))
vi.mock("@/modules/auth/server/guards", () => ({
  requirePlatformApiContext: vi.fn(async () => {
    if (state.context?.kind !== "platform") throw new ApiError("PLATFORM_FORBIDDEN", 403, "Operação não autorizada.")
    return state.context
  }),
  requireCompanyApiContext: vi.fn(async () => {
    if (state.context?.kind !== "company") throw new ApiError("COMPANY_FORBIDDEN", 403, "Operação não autorizada.")
    return state.context
  }),
  requireRecentAuthentication: vi.fn((_context, seconds: number) => state.recent.push(seconds)),
}))
vi.mock("@/modules/bank-accounts/server/bank-account-service", () => service)

const modules = (import.meta as unknown as { glob<T>(pattern: string): Record<string, () => Promise<T>> }).glob<RouteModule>("/src/app/api/**/bank-accounts/**/route.ts")
async function route(path: string, method: keyof RouteModule): Promise<Handler> {
  const loaded = modules[path]
  if (!loaded) throw new Error(`Missing route: ${path}`)
  const handler = (await loaded())[method]
  if (!handler) throw new Error(`Missing ${method}: ${path}`)
  return handler
}
function request(
  path: string,
  method = "GET",
  body?: unknown,
  securityHeaders: Readonly<{ csrf?: boolean; origin?: boolean }> = {
    csrf: true,
    origin: true,
  },
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-correlation-id": randomUUID(),
  })
  if (securityHeaders.origin !== false) headers.set("origin", "http://127.0.0.1:3000")
  if (securityHeaders.csrf !== false) headers.set("x-csrf-token", "csrf")
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function malformedRequest(path: string, method: "POST" | "PATCH"): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "x-correlation-id": randomUUID(),
      "x-csrf-token": "csrf",
    },
    body: '{"truncated":',
  })
}
function context(companyId = fixtures.companyA, bankAccountId?: string): RouteContext {
  return { params: Promise.resolve({ companyId, bankAccountId }) }
}
function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) expect(response.headers.get(name)).toBe(value)
}
const editable = { bankCode: "001", bankName: "Banco Seguro", branch: "1234-5", account: "987654-3", accountType: "checking", holderName: "Empresa A", holderDocument: "12345678901", makeDefault: false }

beforeEach(() => {
  vi.clearAllMocks()
  state.context = Object.freeze({ ...createPlatformContext(), authenticatedAt: Math.floor(Date.now() / 1000) })
  state.rateAllowed = true
  state.recent.length = 0
  state.versionConflict = false
  security.csrfCalls.length = 0
  security.originCalls.length = 0
})

describe.sequential("Task 8 bank account HTTP boundary", () => {
  it("lists masked-only platform DTOs with no-store", async () => {
    const GET = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/route.ts", "GET")
    const response = await GET(request(`/api/platform/companies/${fixtures.companyA}/bank-accounts`), context())
    const text = await response.text()
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(text).toContain("maskedAccount")
    expect(text).not.toMatch(/ciphertext|987654-3|12345678901/iu)
  })

  it("allows a normal platform GET without mutation Origin or CSRF headers", async () => {
    const GET = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/route.ts", "GET")
    const response = await GET(
      request(`/api/platform/companies/${fixtures.companyA}/bank-accounts`, "GET", undefined, { csrf: false, origin: false }),
      context(),
    )

    expect(response.status).toBe(200)
    expect(security.originCalls).toEqual([])
    expect(security.csrfCalls).toEqual([])
  })

  it.each([
    ["Origin", { csrf: true, origin: false }, "ORIGIN_INVALID"],
    ["CSRF", { csrf: false, origin: true }, "CSRF_INVALID"],
  ] as const)("rejects a create without valid %s protection", async (_label, headers, code) => {
    const POST = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/route.ts", "POST")
    const response = await POST(
      request(`/api/platform/companies/${fixtures.companyA}/bank-accounts`, "POST", editable, headers),
      context(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
    expect(service.createBankAccount).not.toHaveBeenCalled()
  })

  it("returns a safe client error for malformed JSON in every mutation", async () => {
    const POST = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/route.ts", "POST")
    const PATCH = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/route.ts", "PATCH")
    const DEFAULT = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/default/route.ts", "POST")
    const ARCHIVE = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/archive/route.ts", "POST")
    const ctx = context(fixtures.companyA, fixtures.bankA)
    const responses = await Promise.all([
      POST(malformedRequest("/create", "POST"), context()),
      PATCH(malformedRequest("/update", "PATCH"), ctx),
      DEFAULT(malformedRequest("/default", "POST"), ctx),
      ARCHIVE(malformedRequest("/archive", "POST"), ctx),
    ])

    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400, 400])
    for (const response of responses) {
      expectNoStore(response)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_JSON" },
      })
    }
    expect(security.originCalls).toHaveLength(4)
    expect(security.csrfCalls).toHaveLength(4)
    expect(state.recent).toEqual([600, 600, 600, 600])
    expect(service.createBankAccount).not.toHaveBeenCalled()
    expect(service.updateBankAccount).not.toHaveBeenCalled()
    expect(service.setDefaultBankAccount).not.toHaveBeenCalled()
    expect(service.archiveBankAccount).not.toHaveBeenCalled()
  })

  it("requires recent auth and rate limits every platform mutation", async () => {
    state.rateAllowed = false
    const POST = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/route.ts", "POST")
    const response = await POST(request(`/api/platform/companies/${fixtures.companyA}/bank-accounts`, "POST", editable), context())
    expect(response.status).toBe(429)
    expectNoStore(response)
    expect(state.recent).toEqual([600])
    expect(service.createBankAccount).not.toHaveBeenCalled()
  })

  it("uses path identifiers and CAS for update, default and archive", async () => {
    const PATCH = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/route.ts", "PATCH")
    const DEFAULT = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/default/route.ts", "POST")
    const ARCHIVE = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/archive/route.ts", "POST")
    const ctx = context(fixtures.companyA, fixtures.bankA)
    const responses = await Promise.all([
      PATCH(request("/update", "PATCH", { ...editable, version: 2 }), ctx),
      DEFAULT(request("/default", "POST", { version: 3 }), ctx),
      ARCHIVE(request("/archive", "POST", { version: 4, replacementDefaultId: fixtures.bankB, reasonCode: "BANK_ARCHIVE_BANK_CHANGED" }), ctx),
    ])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect(service.updateBankAccount).toHaveBeenCalledWith(expect.objectContaining({ companyId: fixtures.companyA, bankAccountId: fixtures.bankA, input: expect.objectContaining({ version: 2 }) }))
    expect(service.archiveBankAccount).toHaveBeenCalledWith(expect.objectContaining({ replacementDefaultId: fixtures.bankB, version: 4 }))
  })

  it("rejects free-text archive reasons before the service boundary", async () => {
    const ARCHIVE = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/archive/route.ts", "POST")
    const response = await ARCHIVE(
      request("/archive", "POST", {
        version: 4,
        replacementDefaultId: fixtures.bankB,
        reason: "Texto livre não permitido.",
      }),
      context(fixtures.companyA, fixtures.bankA),
    )

    expect(response.status).toBe(422)
    expect(service.archiveBankAccount).not.toHaveBeenCalled()
  })

  it("maps cross-tenant and unknown bank identifiers to the same neutral 404", async () => {
    service.updateBankAccount.mockRejectedValue(new ApiError("BANK_ACCOUNT_NOT_FOUND", 404, "Conta bancária não encontrada."))
    const PATCH = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/route.ts", "PATCH")
    const cross = await PATCH(request("/cross", "PATCH", { ...editable, version: 1 }), context(fixtures.companyB, fixtures.bankA))
    const unknownId = randomUUID()
    const unknown = await PATCH(request("/unknown", "PATCH", { ...editable, version: 1 }), context(fixtures.companyA, unknownId))
    expect([cross.status, unknown.status]).toEqual([404, 404])
    expect(await cross.json()).toMatchObject({ error: { code: "BANK_ACCOUNT_NOT_FOUND" } })
    expect(await unknown.json()).toMatchObject({ error: { code: "BANK_ACCOUNT_NOT_FOUND" } })
  })

  it("returns the current masked snapshot on an optimistic version conflict", async () => {
    state.versionConflict = true
    const PATCH = await route("/src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/route.ts", "PATCH")
    const response = await PATCH(
      request("/conflict", "PATCH", { ...editable, version: 99 }),
      context(fixtures.companyA, fixtures.bankA),
    )
    const text = await response.text()

    expect(response.status).toBe(409)
    expectNoStore(response)
    expect(text).toContain('"current"')
    expect(text).toContain("maskedAccount")
    expect(text).not.toMatch(/ciphertext|987654-3|12345678901/iu)
  })

  it("allows only company admin or financial module to read the authenticated masked view", async () => {
    const GET = await route("/src/app/api/company/settings/bank-accounts/route.ts", "GET")
    state.context = Object.freeze({ ...createCompanyContext(), companyId: fixtures.companyA, role: "member", modules: Object.freeze(["financial"] as const) })
    const allowed = await GET(request("/api/company/settings/bank-accounts"))
    expect(allowed.status).toBe(200)
    expectNoStore(allowed)
    state.context = Object.freeze({ ...createCompanyContext(), companyId: fixtures.companyA, role: "member", modules: Object.freeze(["certificates"] as const) })
    const denied = await GET(request("/api/company/settings/bank-accounts"))
    expect(denied.status).toBe(403)
    expect(service.listCompanyBankAccounts).toHaveBeenCalledTimes(1)
  })
})
