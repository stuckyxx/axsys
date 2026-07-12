import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{
  params: Promise<{ membershipId: string }>
}>

type RouteHandler = (
  request: Request,
  context?: RouteContext,
) => Promise<Response>

type RouteModule = Partial<Record<"GET" | "POST" | "PATCH", RouteHandler>>

const fixtures = vi.hoisted(() => ({
  adminA: "71000000-0000-4000-8000-000000000001",
  adminAUser: "72000000-0000-4000-8000-000000000001",
  companyA: "73000000-0000-4000-8000-000000000001",
  companyB: "73000000-0000-4000-8000-000000000002",
  memberA: "71000000-0000-4000-8000-000000000002",
  memberAUser: "72000000-0000-4000-8000-000000000002",
  memberB: "71000000-0000-4000-8000-000000000003",
  memberBUser: "72000000-0000-4000-8000-000000000003",
}))

const state = vi.hoisted(() => ({
  archived: false,
  context: null as ReturnType<typeof createCompanyContext> | null,
  recentAuthenticationCalls: [] as number[],
  updateCalls: [] as Array<Record<string, unknown>>,
  rateLimitResponse: null as Response | null,
}))

const users = vi.hoisted(() => [
  {
    id: fixtures.adminA,
    userId: fixtures.adminAUser,
    companyId: fixtures.companyA,
    displayName: "Admin Empresa A",
    role: "company_admin" as const,
    modules: [] as string[],
    status: "active" as const,
    version: 1,
  },
  {
    id: fixtures.memberA,
    userId: fixtures.memberAUser,
    companyId: fixtures.companyA,
    displayName: "Pessoa Financeiro",
    role: "member" as const,
    modules: ["financial"],
    status: "active" as const,
    version: 1,
  },
  {
    id: fixtures.memberB,
    userId: fixtures.memberBUser,
    companyId: fixtures.companyB,
    displayName: "Pessoa Empresa B",
    role: "member" as const,
    modules: ["certificates"],
    status: "active" as const,
    version: 1,
  },
])

function currentContext() {
  if (state.context === null) {
    throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
  }
  if (state.context.role !== "company_admin") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
  if (state.archived) {
    throw new ApiError("COMPANY_ARCHIVED", 403, "Empresa arquivada.")
  }
  return state.context
}

function visibleUser(membershipId: string) {
  const context = currentContext()
  const user = users.find(
    (candidate) =>
      candidate.id === membershipId && candidate.companyId === context.companyId,
  )
  if (!user) {
    throw new ApiError("USER_NOT_FOUND", 404, "Usuário não encontrado.")
  }
  return user
}

const service = vi.hoisted(() => ({
  getCompanyUser: vi.fn(async ({ membershipId }: { membershipId: string }) =>
    visibleUser(membershipId),
  ),
  listCompanyUsers: vi.fn(async () => ({
    items: users.filter(({ companyId }) => companyId === currentContext().companyId),
  })),
  provisionCompanyUser: vi.fn(),
  resetTemporaryPassword: vi.fn(),
  updateCompanyUser: vi.fn(
    async (input: {
      membershipId: string
      role: "company_admin" | "member"
      modules: string[]
      status: "active" | "suspended"
      version: number
    }) => {
      state.updateCalls.push(input)
      const context = currentContext()
      const target = visibleUser(input.membershipId)
      if (target.userId === context.userId) {
        throw new ApiError(
          "SELF_PRIVILEGE_CHANGE",
          403,
          "Você não pode alterar o próprio acesso.",
        )
      }
      if (target.version !== input.version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O usuário foi alterado por outra sessão.",
        )
      }
      if (
        target.role === "company_admin" &&
        (input.role !== "company_admin" || input.status !== "active")
      ) {
        throw new ApiError(
          "LAST_ACTIVE_ADMIN",
          409,
          "A empresa precisa manter ao menos um administrador ativo.",
        )
      }
      return { ...target, ...input, version: target.version + 1 }
    },
  ),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-csrf" }) }),
}))

vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: vi.fn(),
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))

vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: vi.fn() }))
vi.mock("@/modules/users/server/user-route-security", () => ({
  enforceUserMutationRateLimit: vi.fn(async () => state.rateLimitResponse),
}))

vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyContext: vi.fn(async () => currentContext()),
  requireCompanyApiContext: vi.fn(async () => currentContext()),
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

vi.mock("@/modules/users/server/user-service", () => ({
  companyUserService: service,
  getCompanyUser: service.getCompanyUser,
  listCompanyUsers: service.listCompanyUsers,
  updateCompanyUser: service.updateCompanyUser,
  resetTemporaryPassword: service.resetTemporaryPassword,
}))

vi.mock("@/modules/users/server/user-provisioner", () => ({
  provisionCompanyUserWithDefaults: service.provisionCompanyUser,
}))

const routeModules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/company/users/**/route.ts")

async function route(
  path: string,
  method: "GET" | "POST" | "PATCH",
): Promise<RouteHandler> {
  const load = routeModules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const routeModule = await load()
  const handler = routeModule[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function companyContext(
  overrides: Partial<ReturnType<typeof createCompanyContext>> = {},
) {
  return Object.freeze({
    ...createCompanyContext(),
    userId: fixtures.adminAUser,
    membershipId: fixtures.adminA,
    companyId: fixtures.companyA,
    modules: Object.freeze([]),
    authenticatedAt: Math.floor(Date.now() / 1_000),
    ...overrides,
  }) as ReturnType<typeof createCompanyContext>
}

function request(
  path: string,
  options: Readonly<{ body?: unknown; method?: "GET" | "POST" | "PATCH" }> = {},
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

function membershipContext(membershipId: string): RouteContext {
  return { params: Promise.resolve({ membershipId }) }
}

function updatePayload(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Pessoa Atualizada",
    role: "member",
    modules: ["financial"],
    status: "active",
    suspensionReason: null,
    version: 1,
    ...overrides,
  }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.archived = false
  state.context = companyContext()
  state.recentAuthenticationCalls.length = 0
  state.updateCalls.length = 0
  state.rateLimitResponse = null
})

describe.sequential("Task 7 company-user HTTP authorization", () => {
  it("stops a rate-limited mutation before provisioning", async () => {
    state.rateLimitResponse = Response.json(
      { error: { code: "USER_RATE_LIMITED" } },
      { status: 429, headers: NO_STORE_HEADERS },
    )
    const POST = await route("/src/app/api/company/users/route.ts", "POST")
    const response = await POST(
      request("/api/company/users", {
        method: "POST",
        body: {
          displayName: "Pessoa Financeiro",
          email: "pessoa@example.test",
          temporaryPassword: "Frase provisória forte 42!",
          role: "member",
          modules: ["financial"],
        },
      }),
    )

    expect(response.status).toBe(429)
    expectNoStore(response)
    expect(service.provisionCompanyUser).not.toHaveBeenCalled()
  })

  it("rejects protected create fields before provisioning", async () => {
    const POST = await route("/src/app/api/company/users/route.ts", "POST")
    const response = await POST(
      request("/api/company/users", {
        method: "POST",
        body: {
          displayName: "Pessoa Financeiro",
          email: "pessoa@example.test",
          temporaryPassword: "Frase provisória forte 42!",
          role: "member",
          modules: ["financial"],
          company_id: fixtures.companyB,
          user_id: fixtures.memberBUser,
          version: 1,
        },
      }),
    )

    expect(response.status).toBe(422)
    expectNoStore(response)
    expect(service.provisionCompanyUser).not.toHaveBeenCalled()
  })

  it("returns safe operation metadata when password reset needs reconciliation", async () => {
    service.resetTemporaryPassword.mockRejectedValueOnce(
      Object.assign(
        new ApiError(
          "TEMPORARY_PASSWORD_RETRY_REQUIRED",
          503,
          "Redefinição pendente de reconciliação.",
        ),
        {
          operationId: "76000000-0000-4000-8000-000000000001",
          operationStatus: "failed",
        },
      ),
    )
    const POST = await route(
      "/src/app/api/company/users/[membershipId]/reset-password/route.ts",
      "POST",
    )
    const response = await POST(
      request(`/api/company/users/${fixtures.memberA}/reset-password`, {
        method: "POST",
        body: {
          temporaryPassword: "Frase provisória forte 42!",
          reasonCode: "ADMIN_RESET_USER_REQUEST",
        },
      }),
      membershipContext(fixtures.memberA),
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(body).toContain("TEMPORARY_PASSWORD_RETRY_REQUIRED")
    expect(body).toContain("76000000-0000-4000-8000-000000000001")
    expect(body).not.toContain("Frase provisória forte 42!")
  })

  it("keeps cross-tenant and unknown memberships observationally identical", async () => {
    const GET = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "GET",
    )
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const unknownId = randomUUID()
    const crossTenantGet = await GET(
      request(`/api/company/users/${fixtures.memberB}`),
      membershipContext(fixtures.memberB),
    )
    const crossTenantPatch = await PATCH(
      request(`/api/company/users/${fixtures.memberB}`, {
        method: "PATCH",
        body: updatePayload(),
      }),
      membershipContext(fixtures.memberB),
    )
    const unknownGet = await GET(
      request(`/api/company/users/${unknownId}`),
      membershipContext(unknownId),
    )

    expect([crossTenantGet.status, crossTenantPatch.status, unknownGet.status]).toEqual([
      404,
      404,
      404,
    ])
    expectNoStore(crossTenantGet)
    await expect(crossTenantGet.json()).resolves.toMatchObject({
      error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." },
    })
    await expect(crossTenantPatch.json()).resolves.toMatchObject({
      error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." },
    })
    expect(await unknownGet.json()).toMatchObject({
      error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." },
    })
  })

  it("rejects self demotion before exposing last-admin state", async () => {
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/company/users/${fixtures.adminA}`, {
        method: "PATCH",
        body: updatePayload({
          role: "member",
          modules: [],
          status: "suspended",
          suspensionReason: "Desligamento confirmado pela empresa.",
        }),
      }),
      membershipContext(fixtures.adminA),
    )

    expect(response.status).toBe(403)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SELF_PRIVILEGE_CHANGE" },
    })
  })

  it.each([
    ["role", { role: "member" }],
    ["status", { status: "suspended", suspensionReason: "Alteração administrativa válida." }],
    ["modules", { modules: ["financial"] }],
  ])("blocks a self privilege change to %s", async (field, override) => {
    void field
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/company/users/${fixtures.adminA}`, {
        method: "PATCH",
        body: updatePayload(override),
      }),
      membershipContext(fixtures.adminA),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SELF_PRIVILEGE_CHANGE" },
    })
  })

  it("returns 403 to an ordinary member before consulting the user service", async () => {
    state.context = companyContext({
      userId: fixtures.memberAUser,
      membershipId: fixtures.memberA,
      role: "member",
      modules: Object.freeze(["financial"]),
    })
    const GET = await route("/src/app/api/company/users/route.ts", "GET")
    const response = await GET(request("/api/company/users"))

    expect(response.status).toBe(403)
    expectNoStore(response)
    expect(service.listCompanyUsers).not.toHaveBeenCalled()
  })

  it("allows an administrator with no operational modules to manage users", async () => {
    state.context = companyContext({ modules: Object.freeze([]) })
    const GET = await route("/src/app/api/company/users/route.ts", "GET")
    const response = await GET(request("/api/company/users"))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(service.listCompanyUsers).toHaveBeenCalledOnce()
  })

  it("rejects a page size that cannot reserve one SQL lookahead row", async () => {
    const GET = await route("/src/app/api/company/users/route.ts", "GET")
    const response = await GET(request("/api/company/users?limit=100"))

    expect(response.status).toBe(422)
    expectNoStore(response)
    expect(service.listCompanyUsers).not.toHaveBeenCalled()
  })

  it("returns 403 for an archived company before reading memberships", async () => {
    state.archived = true
    const GET = await route("/src/app/api/company/users/route.ts", "GET")
    const response = await GET(request("/api/company/users"))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPANY_ARCHIVED" },
    })
    expect(service.listCompanyUsers).not.toHaveBeenCalled()
  })

  it("requires authentication no older than 600 seconds for permission changes", async () => {
    state.context = companyContext({
      authenticatedAt: Math.floor(Date.now() / 1_000) - 601,
    })
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/company/users/${fixtures.memberA}`, {
        method: "PATCH",
        body: updatePayload(),
      }),
      membershipContext(fixtures.memberA),
    )

    expect(response.status).toBe(403)
    expect(state.recentAuthenticationCalls).toContain(600)
    expect(service.updateCompanyUser).not.toHaveBeenCalled()
  })

  it.each([
    ["company_id", fixtures.companyB],
    ["user_id", fixtures.memberBUser],
    ["version replacement", { version: 1, expectedVersion: 1 }],
    ["unknown module", { modules: ["reports"] }],
  ])("rejects protected or invalid %s input", async (_name, injected) => {
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const extra =
      typeof injected === "object" ? injected : { [_name]: injected }
    const response = await PATCH(
      request(`/api/company/users/${fixtures.memberA}`, {
        method: "PATCH",
        body: updatePayload(extra),
      }),
      membershipContext(fixtures.memberA),
    )

    expect(response.status).toBe(422)
    expect(service.updateCompanyUser).not.toHaveBeenCalled()
  })

  it("returns a version conflict without applying a stale permission change", async () => {
    const PATCH = await route(
      "/src/app/api/company/users/[membershipId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request(`/api/company/users/${fixtures.memberA}`, {
        method: "PATCH",
        body: updatePayload({ version: 99 }),
      }),
      membershipContext(fixtures.memberA),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    })
  })
})
