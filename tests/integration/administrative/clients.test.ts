import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{ params: Promise<{ clientId: string }> }>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>

const fixtures = vi.hoisted(() => ({
  clientA: "71000000-0000-4000-8000-000000000001",
  clientB: "71000000-0000-4000-8000-000000000002",
  random: "71000000-0000-4000-8000-000000000099",
}))

const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createCompanyContext> | null,
  version: 3,
  listInput: null as Record<string, unknown> | null,
}))

function record(id = fixtures.clientA) {
  return {
    id,
    legalName: "Município de Horizonte",
    tradeName: "Prefeitura de Horizonte",
    cnpj: "04252011000110",
    segment: "Prefeituras",
    email: "compras@horizonte.example",
    phone: "+558533330000",
    address: {
      street: "Avenida Central",
      number: "100",
      complement: null,
      neighborhood: "Centro",
      municipality: "Horizonte",
      state: "CE",
      postalCode: "62880000",
    },
    archivedAt: null,
    version: state.version,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  }
}

const service = vi.hoisted(() => ({
  listClients: vi.fn(async (input: Record<string, unknown>) => {
    state.listInput = input
    return { items: [record()], nextCursor: null }
  }),
  getClientDetail: vi.fn(async ({ clientId }: { clientId: string }) => {
    if (clientId !== fixtures.clientA) {
      throw new ApiError("CLIENT_NOT_FOUND", 404, "Cliente não encontrado.")
    }
    return {
      client: record(),
      aggregates: {
        proposalCount: 2,
        proposalTotal: "2500.80",
        contractCount: 1,
        contractTotal: "10000.00",
      },
      recentProposals: [],
      recentContracts: [],
    }
  }),
  createClient: vi.fn(async () => ({ record: record(), scopes: ["clients"] })),
  updateClient: vi.fn(async ({ input }: { input: { version: number } }) => {
    if (input.version !== state.version) {
      throw new ApiError("VERSION_CONFLICT", 409, "O cliente foi alterado por outra sessão.")
    }
    state.version += 1
    return { record: record(), scopes: ["clients"] }
  }),
  archiveClient: vi.fn(async () => {
    state.version += 1
    return {
      record: { ...record(), archivedAt: "2026-07-10T13:00:00.000Z" },
      scopes: ["clients"],
    }
  }),
  restoreClient: vi.fn(async () => {
    state.version += 1
    return { record: record(), scopes: ["clients"] }
  }),
  deleteClient: vi.fn(async ({ clientId }: { clientId: string }) => {
    if (clientId === fixtures.clientB) {
      throw new ApiError("CLIENT_NOT_FOUND", 404, "Cliente não encontrado.")
    }
    return { record: null, scopes: ["clients"] }
  }),
}))

const security = vi.hoisted(() => ({
  origin: vi.fn(),
  csrf: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-csrf" }) }),
}))

vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: security.origin }))
vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: security.csrf,
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))

vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyContext: vi.fn(async (moduleName?: string) => {
    if (moduleName !== "administrative" || !state.context) {
      throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
    }
    return state.context
  }),
  requireCompanyApiContext: vi.fn(async (moduleName?: string) => {
    if (moduleName !== "administrative" || !state.context) {
      throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
    }
    return state.context
  }),
}))

vi.mock("@/modules/administrative/server/client-service", () => service)

const modules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/administrative/clients/**/route.ts")

async function route(path: string, method: keyof RouteModule): Promise<Handler> {
  const load = modules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const handler = (await load())[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function request(
  path: string,
  options: Readonly<{ method?: string; body?: unknown }> = {},
): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "x-csrf-token": "test-csrf",
      "x-correlation-id": randomUUID(),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

function context(clientId: string): RouteContext {
  return { params: Promise.resolve({ clientId }) }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.context = createCompanyContext()
  state.version = 3
  state.listInput = null
})

describe.sequential("Administrative client BFF", () => {
  it("lists tenant clients with validated prefix filters and no-store headers", async () => {
    const GET = await route("/src/app/api/administrative/clients/route.ts", "GET")
    const response = await GET(
      request("/api/administrative/clients?q=Horizonte&segment=Prefeituras&archived=false&limit=25"),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(state.listInput).toEqual(expect.objectContaining({
      q: "Horizonte",
      segment: "Prefeituras",
      archived: false,
      limit: 25,
    }))
  })

  it("rejects unknown and duplicate list query parameters", async () => {
    const GET = await route("/src/app/api/administrative/clients/route.ts", "GET")
    const unknown = await GET(request("/api/administrative/clients?companyId=forbidden"))
    const duplicate = await GET(request("/api/administrative/clients?q=um&q=dois"))

    expect(unknown.status).toBe(422)
    expect(duplicate.status).toBe(422)
    expect(service.listClients).not.toHaveBeenCalled()
  })

  it("creates from strict input only after Origin and CSRF validation", async () => {
    const POST = await route("/src/app/api/administrative/clients/route.ts", "POST")
    const response = await POST(request("/api/administrative/clients", {
      method: "POST",
      body: {
        legalName: "Município de Horizonte",
        tradeName: "Prefeitura de Horizonte",
        cnpj: "04.252.011/0001-10",
        segment: "Prefeituras",
        email: "compras@horizonte.example",
        phone: "+558533330000",
        addressStreet: "Avenida Central",
        addressNumber: "100",
        addressComplement: null,
        addressNeighborhood: "Centro",
        municipality: "Horizonte",
        state: "ce",
        postalCode: "62.880-000",
      },
    }))

    expect(response.status).toBe(201)
    expectNoStore(response)
    expect(security.origin).toHaveBeenCalledBefore(security.csrf)
    expect(service.createClient).toHaveBeenCalledWith(expect.objectContaining({
      context: state.context,
      correlationId: expect.any(String),
    }))
  })

  it("returns aggregate detail without exposing a foreign identifier", async () => {
    const GET = await route("/src/app/api/administrative/clients/[clientId]/route.ts", "GET")
    const own = await GET(request(`/api/administrative/clients/${fixtures.clientA}`), context(fixtures.clientA))
    const foreign = await GET(request(`/api/administrative/clients/${fixtures.clientB}`), context(fixtures.clientB))
    const unknown = await GET(request(`/api/administrative/clients/${fixtures.random}`), context(fixtures.random))

    expect(own.status).toBe(200)
    expect((await own.json()).aggregates).toEqual(expect.objectContaining({ proposalTotal: "2500.80" }))
    expect(foreign.status).toBe(404)
    expect(unknown.status).toBe(404)
    const foreignError = (await foreign.json()) as { error: Record<string, unknown> }
    const unknownError = (await unknown.json()) as { error: Record<string, unknown> }
    expect({ ...foreignError.error, correlationId: undefined }).toEqual({
      ...unknownError.error,
      correlationId: undefined,
    })
  })

  it("preserves optimistic concurrency and returns a safe 409", async () => {
    const PATCH = await route("/src/app/api/administrative/clients/[clientId]/route.ts", "PATCH")
    const response = await PATCH(request(`/api/administrative/clients/${fixtures.clientA}`, {
      method: "PATCH",
      body: {
        version: 2,
        legalName: "Valor local preservado",
        tradeName: null,
        cnpj: "04252011000110",
        segment: "Prefeituras",
        email: null,
        phone: null,
        addressStreet: null,
        addressNumber: null,
        addressComplement: null,
        addressNeighborhood: null,
        municipality: "Horizonte",
        state: "CE",
        postalCode: null,
      },
    }), context(fixtures.clientA))

    expect(response.status).toBe(409)
    expectNoStore(response)
    expect(await response.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "O cliente foi alterado por outra sessão.",
        correlationId: expect.any(String),
      },
    })
  })

  it("returns the persisted record after a current-version update", async () => {
    const PATCH = await route("/src/app/api/administrative/clients/[clientId]/route.ts", "PATCH")
    const response = await PATCH(request(`/api/administrative/clients/${fixtures.clientA}`, {
      method: "PATCH",
      body: {
        version: 3,
        legalName: "Município de Horizonte Atualizado",
        tradeName: null,
        cnpj: "04252011000110",
        segment: "Prefeituras",
        email: null,
        phone: null,
        addressStreet: null,
        addressNumber: null,
        addressComplement: null,
        addressNeighborhood: null,
        municipality: "Horizonte",
        state: "CE",
        postalCode: null,
      },
    }), context(fixtures.clientA))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(await response.json()).toEqual(expect.objectContaining({
      record: expect.objectContaining({ version: 4 }),
    }))
  })

  it("archives, restores and deletes through dedicated guarded handlers", async () => {
    const archive = await route("/src/app/api/administrative/clients/[clientId]/archive/route.ts", "POST")
    const restore = await route("/src/app/api/administrative/clients/[clientId]/restore/route.ts", "POST")
    const remove = await route("/src/app/api/administrative/clients/[clientId]/route.ts", "DELETE")

    const archived = await archive(request("/archive", { method: "POST", body: { version: 3 } }), context(fixtures.clientA))
    const restored = await restore(request("/restore", { method: "POST", body: { version: 4 } }), context(fixtures.clientA))
    const deleted = await remove(request(`/api/administrative/clients/${fixtures.clientA}`, { method: "DELETE", body: { version: 5 } }), context(fixtures.clientA))

    expect(archived.status).toBe(200)
    expect(restored.status).toBe(200)
    expect(deleted.status).toBe(204)
    expectNoStore(deleted)
    expect(security.origin).toHaveBeenCalledTimes(3)
    expect(security.csrf).toHaveBeenCalledTimes(3)
  })

  it("rejects tenant, actor and unknown-field injection", async () => {
    const POST = await route("/src/app/api/administrative/clients/route.ts", "POST")
    const response = await POST(request("/api/administrative/clients", {
      method: "POST",
      body: {
        legalName: "Município de Horizonte",
        cnpj: "04252011000110",
        segment: "Prefeituras",
        municipality: "Horizonte",
        state: "CE",
        companyId: randomUUID(),
        createdBy: randomUUID(),
      },
    }))

    expect(response.status).toBe(422)
    expect(service.createClient).not.toHaveBeenCalled()
  })
})
