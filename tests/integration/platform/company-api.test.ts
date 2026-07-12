import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import {
  createCompanyContext,
  createPlatformContext,
} from "../../helpers/auth"

type RouteContext = Readonly<{
  params: Promise<{ companyId: string }>
}>

type RouteHandler = (
  request: Request,
  context?: RouteContext,
) => Promise<Response>

type RouteModule = Partial<Record<"GET" | "PATCH", RouteHandler>>

const state = vi.hoisted(() => ({
  accessContext: null as ReturnType<typeof createPlatformContext> | ReturnType<typeof createCompanyContext> | null,
  auditActions: [] as string[],
  companyVersion: 4,
  listCalls: [] as Array<Record<string, unknown>>,
  recentAuthenticationCalls: [] as number[],
  reactivatedMemberships: [] as string[],
  rateLimitAllowed: true,
}))

const fixtures = vi.hoisted(() => ({
  activeMembershipId: "65000000-0000-4000-8000-000000000001",
  companyA: "66000000-0000-4000-8000-000000000001",
  companyB: "66000000-0000-4000-8000-000000000002",
  suspendedMembershipId: "65000000-0000-4000-8000-000000000002",
}))

const service = vi.hoisted(() => ({
  getCompanyDetail: vi.fn(async ({ companyId }: { companyId: string }) => {
    if (companyId !== fixtures.companyA) {
      throw new ApiError("COMPANY_NOT_FOUND", 404, "Empresa não encontrada.")
    }
    return {
      admins: [
        {
          displayName: "Admin Axsys",
          id: fixtures.activeMembershipId,
          status: "active",
        },
      ],
      bankAccounts: [
        {
          accountLast4: "4321",
          bankCode: "001",
          branchLast4: "1234",
          id: "67000000-0000-4000-8000-000000000001",
        },
      ],
      company: {
        contactEmail: "financeiro@empresa-a.example",
        id: fixtures.companyA,
        legalName: "Empresa A Ltda",
        status: "active",
        tradeName: "Empresa A",
        version: state.companyVersion,
      },
      counters: {
        activeAdmins: 1,
        activeUsers: 1,
        bankAccounts: 1,
      },
    }
  }),
  listCompanies: vi.fn(async (input: Record<string, unknown>) => {
    state.listCalls.push(input)
    const cursor = input.cursor
    return cursor
      ? {
          items: [{ id: fixtures.companyB, legalName: "Empresa B Ltda" }],
          nextCursor: null,
        }
      : {
          items: [{ id: fixtures.companyA, legalName: "Empresa A Ltda" }],
          nextCursor: "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTEyVDAwOjAwOjAwWiJ9",
        }
  }),
  setCompanyStatus: vi.fn(
    async (input: { action: "archive" | "reactivate"; version: number }) => {
      if (input.version !== state.companyVersion) {
        throw Object.assign(new Error("AXSYS_VERSION_CONFLICT"), {
          code: "AXSYS_VERSION_CONFLICT",
        })
      }
      state.companyVersion += 1
      state.auditActions.push(
        input.action === "archive" ? "company.archived" : "company.reactivated",
      )
      if (input.action === "reactivate") {
        state.reactivatedMemberships.push(fixtures.activeMembershipId)
      }
      return {
        accessReconciliation: "complete",
        company: {
          id: fixtures.companyA,
          status: input.action === "archive" ? "archived" : "active",
          version: state.companyVersion,
        },
      }
    },
  ),
  updateCompany: vi.fn(async (input: { version: number }) => {
    if (input.version !== state.companyVersion) {
      throw Object.assign(new Error("AXSYS_VERSION_CONFLICT"), {
        code: "AXSYS_VERSION_CONFLICT",
      })
    }
    state.companyVersion += 1
    return {
      company: { id: fixtures.companyA, version: state.companyVersion },
    }
  }),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: "test-csrf" }),
  }),
}))

vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: vi.fn(),
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))

vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: vi.fn() }))

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: vi.fn(async () => ({
    allowed: state.rateLimitAllowed,
    attempts: 1,
    retryAfterSeconds: state.rateLimitAllowed ? 0 : 60,
  })),
}))

vi.mock("@/modules/auth/server/guards", () => ({
  requirePlatformApiContext: vi.fn(async () => {
    if (!state.accessContext || state.accessContext.kind !== "platform") {
      throw new ApiError("PLATFORM_FORBIDDEN", 403, "Operação não autorizada.")
    }
    return state.accessContext
  }),
  requireRecentAuthentication: vi.fn(
    (context: { authenticatedAt: number }, maxAgeSeconds = 600) => {
      state.recentAuthenticationCalls.push(maxAgeSeconds)
      if (Math.floor(Date.now() / 1_000) - context.authenticatedAt > maxAgeSeconds) {
        throw new ApiError(
          "REAUTHENTICATION_REQUIRED",
          403,
          "Confirme sua senha novamente para continuar.",
        )
      }
    },
  ),
}))

vi.mock("@/modules/companies/server/company-service", () => ({
  changeCompanyStatus: service.setCompanyStatus,
  getCompany: service.getCompanyDetail,
  getCompanyDetail: service.getCompanyDetail,
  listCompanies: service.listCompanies,
  setCompanyStatus: service.setCompanyStatus,
  updateCompany: service.updateCompany,
}))

vi.mock("@/modules/platform/server/platform-repository", () => ({
  getCompanyDetail: service.getCompanyDetail,
  listCompanies: service.listCompanies,
  platformRepository: {
    getCompanyDetail: service.getCompanyDetail,
    listCompanies: service.listCompanies,
  },
}))

const routeModules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>(
  "/src/app/api/platform/companies/**/route.ts",
)

async function route(path: string, method: "GET" | "PATCH"): Promise<RouteHandler> {
  const load = routeModules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const routeModule = await load()
  const handler = routeModule[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function request(
  path: string,
  options: Readonly<{ body?: unknown; method?: "GET" | "PATCH" }> = {},
): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "x-correlation-id": randomUUID(),
      "x-csrf-token": "test-csrf",
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

function context(companyId = fixtures.companyA): RouteContext {
  return { params: Promise.resolve({ companyId }) }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

function platformContext(authenticatedAt = Math.floor(Date.now() / 1_000)) {
  return Object.freeze({ ...createPlatformContext(), authenticatedAt })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.accessContext = platformContext()
  state.auditActions.length = 0
  state.companyVersion = 4
  state.listCalls.length = 0
  state.reactivatedMemberships.length = 0
  state.rateLimitAllowed = true
  state.recentAuthenticationCalls.length = 0
})

describe.sequential("Task 6 platform company HTTP management", () => {
  it("filters the list and advances an opaque keyset cursor with no-store headers", async () => {
    const GET = await route("/src/app/api/platform/companies/route.ts", "GET")
    const first = await GET(
      request("/api/platform/companies?search=Empresa&status=active&limit=1"),
    )
    const firstBody = (await first.json()) as {
      items: Array<{ id: string }>
      nextCursor: string
    }
    const second = await GET(
      request(
        `/api/platform/companies?search=Empresa&status=active&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      ),
    )
    const secondBody = (await second.json()) as { items: Array<{ id: string }> }

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expectNoStore(first)
    expectNoStore(second)
    expect(firstBody.items.map(({ id }) => id)).toEqual([fixtures.companyA])
    expect(secondBody.items.map(({ id }) => id)).toEqual([fixtures.companyB])
    expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id)
    expect(state.listCalls).toEqual([
      expect.objectContaining({ limit: 1, search: "Empresa", status: "active" }),
      expect.objectContaining({
        cursor: firstBody.nextCursor,
        limit: 1,
        search: "Empresa",
        status: "active",
      }),
    ])
  })

  it("rejects a list limit above the hard maximum of 100", async () => {
    const GET = await route("/src/app/api/platform/companies/route.ts", "GET")
    const response = await GET(request("/api/platform/companies?limit=101"))

    expect(response.status).toBe(422)
    expectNoStore(response)
    expect(service.listCompanies).not.toHaveBeenCalled()
  })

  it("returns only the allowlisted company detail, admins, masked banks, and counters", async () => {
    const GET = await route(
      "/src/app/api/platform/companies/[companyId]/route.ts",
      "GET",
    )
    const response = await GET(
      request(`/api/platform/companies/${fixtures.companyA}`),
      context(),
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(Object.keys(body).sort()).toEqual([
      "admins",
      "bankAccounts",
      "company",
      "counters",
    ])
    expect(body).toMatchObject({
      bankAccounts: [{ accountLast4: "4321", branchLast4: "1234" }],
      counters: { activeAdmins: 1, activeUsers: 1, bankAccounts: 1 },
    })
    expect(JSON.stringify(body)).not.toMatch(
      /ciphertext|holderDocument|contract|certificate|financialEntry|password/iu,
    )
  })

  it("allows only one optimistic update for the same version and returns the current snapshot", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/route.ts",
      "PATCH",
    )
    const payload = {
      contactEmail: "contato@empresa-a.example",
      contactPhone: "+5585999999999",
      legalName: "Empresa A Atualizada Ltda",
      timezone: "America/Fortaleza",
      tradeName: "Empresa A Atualizada",
      version: 4,
    }
    const responses = await Promise.all([
      PATCH(
        request(`/api/platform/companies/${fixtures.companyA}`, {
          body: payload,
          method: "PATCH",
        }),
        context(),
      ),
      PATCH(
        request(`/api/platform/companies/${fixtures.companyA}`, {
          body: payload,
          method: "PATCH",
        }),
        context(),
      ),
    ])
    const success = responses.find(({ status }) => status === 200)
    const conflict = responses.find(({ status }) => status === 409)

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409])
    expectNoStore(success!)
    expectNoStore(conflict!)
    await expect(conflict!.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
      current: { id: fixtures.companyA, version: 5 },
    })
  })

  it("keeps unknown and unauthorized valid company identifiers observationally identical", async () => {
    const GET = await route(
      "/src/app/api/platform/companies/[companyId]/route.ts",
      "GET",
    )
    const unknownId = randomUUID()
    const unknown = await GET(
      request(`/api/platform/companies/${unknownId}`),
      context(unknownId),
    )
    state.accessContext = createCompanyContext()
    const unauthorized = await GET(
      request(`/api/platform/companies/${fixtures.companyB}`),
      context(fixtures.companyB),
    )

    expect(unknown.status).toBe(404)
    expect(unauthorized.status).toBe(404)
    expectNoStore(unknown)
    expectNoStore(unauthorized)
    const unauthorizedBody = await unauthorized.json()
    const unknownBody = await unknown.json()
    expect(unauthorizedBody).toMatchObject({
      error: { code: "COMPANY_NOT_FOUND", message: "Empresa não encontrada." },
    })
    expect(unknownBody).toMatchObject({
      error: { code: "COMPANY_NOT_FOUND", message: "Empresa não encontrada." },
    })
  })

  it("requires recent authentication and a version before archiving", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/status/route.ts",
      "PATCH",
    )
    state.accessContext = platformContext(Math.floor(Date.now() / 1_000) - 601)
    const stale = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: {
          action: "archive",
          reason: "Encerramento solicitado pelo responsável.",
          version: 4,
        },
        method: "PATCH",
      }),
      context(),
    )
    state.accessContext = platformContext()
    const missingVersion = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: {
          action: "archive",
          reason: "Encerramento solicitado pelo responsável.",
        },
        method: "PATCH",
      }),
      context(),
    )

    expect(stale.status).toBe(403)
    expect(missingVersion.status).toBe(422)
    expect(state.recentAuthenticationCalls).toContain(600)
    expect(service.setCompanyStatus).not.toHaveBeenCalled()
  })

  it("rate limits lifecycle mutations per platform actor and company", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/status/route.ts",
      "PATCH",
    )
    state.rateLimitAllowed = false
    const response = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: {
          action: "archive",
          reason: "Encerramento solicitado pelo responsável.",
          version: 4,
        },
        method: "PATCH",
      }),
      context(),
    )

    expect(response.status).toBe(429)
    expectNoStore(response)
    expect(service.setCompanyStatus).not.toHaveBeenCalled()
  })

  it("returns the current company snapshot on a stale lifecycle version", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/status/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: {
          action: "archive",
          reason: "Encerramento solicitado pelo responsável.",
          version: 3,
        },
        method: "PATCH",
      }),
      context(),
    )

    expect(response.status).toBe(409)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
      current: { id: fixtures.companyA, version: 4 },
    })
    expect(state.auditActions).toEqual([])
  })

  it("archives immediately with an audit event and access reconciliation result", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/status/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: {
          action: "archive",
          reason: "Encerramento solicitado pelo responsável.",
          version: 4,
        },
        method: "PATCH",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      accessReconciliation: "complete",
      company: { status: "archived", version: 5 },
    })
    expect(state.auditActions).toEqual(["company.archived"])
  })

  it("reactivates access only for memberships that were already active", async () => {
    const PATCH = await route(
      "/src/app/api/platform/companies/[companyId]/status/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/platform/companies/${fixtures.companyA}/status`, {
        body: { action: "reactivate", reason: null, version: 4 },
        method: "PATCH",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    expect(state.reactivatedMemberships).toEqual([fixtures.activeMembershipId])
    expect(state.reactivatedMemberships).not.toContain(
      fixtures.suspendedMembershipId,
    )
    expect(state.auditActions).toEqual(["company.reactivated"])
  })

  it("forbids a company identity from listing platform companies regardless of query selectors", async () => {
    const GET = await route("/src/app/api/platform/companies/route.ts", "GET")
    state.accessContext = createCompanyContext()
    const response = await GET(
      request(
        "/api/platform/companies?redirectTo=%2Fapp%2Fdashboard&role=super_admin",
      ),
    )

    expect(response.status).toBe(403)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PLATFORM_FORBIDDEN" },
    })
    expect(service.listCompanies).not.toHaveBeenCalled()
  })
})
