import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{ params: Promise<{ itemId: string }> }>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>

const fixtures = vi.hoisted(() => ({
  serviceA: "72000000-0000-4000-8000-000000000001",
  productA: "72000000-0000-4000-8000-000000000002",
  linkedA: "72000000-0000-4000-8000-000000000003",
  foreignB: "72000000-0000-4000-8000-000000000004",
  random: "72000000-0000-4000-8000-000000000099",
}))

const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createCompanyContext> | null,
  listInput: null as Record<string, unknown> | null,
  proposalSnapshotDescription: "Descrição histórica contratada",
  version: 3,
}))

function record(
  id = fixtures.serviceA,
  itemKind: "service" | "product" = "service",
) {
  return {
    id,
    itemKind,
    segment: itemKind === "service" ? "Tecnologia" : "Equipamentos",
    name: itemKind === "service" ? "Suporte técnico" : "Notebook corporativo",
    description:
      itemKind === "service"
        ? "Atendimento técnico especializado"
        : "Equipamento com garantia de fábrica",
    archivedAt: null,
    version: state.version,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  }
}

const service = vi.hoisted(() => ({
  listCatalogItems: vi.fn(async (input: Record<string, unknown>) => {
    state.listInput = input
    return {
      items: [record(), record(fixtures.productA, "product")],
      nextCursor: null,
    }
  }),
  getCatalogItem: vi.fn(async ({ itemId }: { itemId: string }) => {
    if (itemId === fixtures.foreignB || itemId === fixtures.random) {
      throw new ApiError("CATALOG_ITEM_NOT_FOUND", 404, "Item não encontrado.")
    }
    return itemId === fixtures.productA
      ? record(itemId, "product")
      : record(itemId)
  }),
  createCatalogItem: vi.fn(async ({ input }: { input: Record<string, unknown> }) => {
    if (input.name === "Nome ativo duplicado" && input.segment === "Tecnologia") {
      throw new ApiError("CATALOG_ITEM_CONFLICT", 409, "Já existe um item ativo com este nome no segmento.")
    }
    const kind = input.itemKind === "product" ? "product" : "service"
    return {
      record: {
        ...record(kind === "product" ? fixtures.productA : fixtures.serviceA, kind),
        name: input.name,
        segment: input.segment,
        description: input.description,
      },
      scopes: ["catalog", "proposals"],
    }
  }),
  updateCatalogItem: vi.fn(async ({ itemId, input }: {
    itemId: string
    input: Record<string, unknown>
  }) => {
    if (input.version !== state.version) {
      throw new ApiError("VERSION_CONFLICT", 409, "O item foi alterado por outra sessão.")
    }
    state.version += 1
    return {
      record: { ...record(itemId), description: input.description },
      scopes: ["catalog", "proposals"],
    }
  }),
  archiveCatalogItem: vi.fn(async ({ itemId }: { itemId: string }) => {
    state.version += 1
    return {
      record: {
        ...record(itemId),
        archivedAt: "2026-07-10T13:00:00.000Z",
      },
      scopes: ["catalog", "proposals"],
    }
  }),
  restoreCatalogItem: vi.fn(async ({ itemId }: { itemId: string }) => {
    state.version += 1
    return { record: record(itemId), scopes: ["catalog", "proposals"] }
  }),
  deleteCatalogItem: vi.fn(async ({ itemId }: { itemId: string }) => {
    if (itemId === fixtures.linkedA) {
      throw new ApiError(
        "RESOURCE_IN_USE",
        409,
        "O item está vinculado a uma proposta.",
      )
    }
    if (itemId === fixtures.foreignB || itemId === fixtures.random) {
      throw new ApiError("CATALOG_ITEM_NOT_FOUND", 404, "Item não encontrado.")
    }
    return { record: null, scopes: ["catalog", "proposals"] }
  }),
}))

const security = vi.hoisted(() => ({ origin: vi.fn(), csrf: vi.fn() }))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-csrf" }) }),
}))
vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: security.origin }))
vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: security.csrf,
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))
vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyApiContext: vi.fn(async (moduleName?: string) => {
    if (moduleName !== "administrative" || !state.context) {
      throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
    }
    return state.context
  }),
}))
vi.mock("@/modules/administrative/server/catalog-item-service", () => service)

const modules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/administrative/catalog-items/**/route.ts")

async function route(path: string, method: keyof RouteModule): Promise<Handler> {
  const load = modules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const handler = (await load())[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function request(
  path: string,
  options: Readonly<{
    body?: unknown
    csrf?: string | null
    method?: string
    origin?: string | null
  }> = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-correlation-id": randomUUID(),
  })
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "http://127.0.0.1:3000")
  }
  if (options.csrf !== null) {
    headers.set("x-csrf-token", options.csrf ?? "test-csrf")
  }
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

function context(itemId: string): RouteContext {
  return { params: Promise.resolve({ itemId }) }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

const serviceInput = {
  itemKind: "service" as const,
  segment: "Tecnologia",
  name: "Suporte técnico",
  description: "Atendimento técnico especializado",
}

beforeEach(() => {
  vi.clearAllMocks()
  state.context = createCompanyContext()
  state.listInput = null
  state.proposalSnapshotDescription = "Descrição histórica contratada"
  state.version = 3
  security.origin.mockImplementation((value: string | null) => {
    if (value !== "http://127.0.0.1:3000") {
      throw new ApiError("ORIGIN_FORBIDDEN", 403, "Origem não autorizada.")
    }
  })
  security.csrf.mockImplementation((header: string | null, cookie: string | null) => {
    if (header !== "test-csrf" || cookie !== "test-csrf") {
      throw new ApiError("CSRF_INVALID", 403, "Solicitação inválida.")
    }
  })
})

describe.sequential("Administrative catalog item BFF", () => {
  it("lists by prefix, segment, kind and archival state with no-store headers", async () => {
    const GET = await route("/src/app/api/administrative/catalog-items/route.ts", "GET")
    const response = await GET(request(
      "/api/administrative/catalog-items?q=Suporte&segment=Tecnologia&itemKind=service&archived=false&limit=25",
    ))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(state.listInput).toEqual(expect.objectContaining({
      q: "Suporte",
      segment: "Tecnologia",
      itemKind: "service",
      archived: false,
      limit: 25,
    }))
  })

  it("rejects unknown and duplicate list query parameters", async () => {
    const GET = await route("/src/app/api/administrative/catalog-items/route.ts", "GET")
    const unknown = await GET(request("/api/administrative/catalog-items?companyId=forbidden"))
    const duplicate = await GET(request("/api/administrative/catalog-items?q=um&q=dois"))

    expect(unknown.status).toBe(422)
    expect(duplicate.status).toBe(422)
    expect(service.listCatalogItems).not.toHaveBeenCalled()
  })

  it.each(["service", "product"] as const)(
    "creates a strict %s and returns its canonical scopes",
    async (itemKind) => {
      const POST = await route("/src/app/api/administrative/catalog-items/route.ts", "POST")
      const response = await POST(request("/api/administrative/catalog-items", {
        method: "POST",
        body: {
          ...serviceInput,
          itemKind,
          segment: itemKind === "service" ? "Tecnologia" : "Equipamentos",
          name: itemKind === "service" ? "Suporte técnico" : "Notebook corporativo",
        },
      }))

      expect(response.status).toBe(201)
      expectNoStore(response)
      expect(security.origin).toHaveBeenCalledBefore(security.csrf)
      expect(service.createCatalogItem).toHaveBeenCalledWith(expect.objectContaining({
        context: state.context,
        correlationId: expect.any(String),
        input: expect.objectContaining({ itemKind }),
      }))
      expect((await response.json()).scopes).toEqual(["catalog", "proposals"])
    },
  )

  it("enforces active name uniqueness per segment but permits another segment", async () => {
    const POST = await route("/src/app/api/administrative/catalog-items/route.ts", "POST")
    const conflict = await POST(request("/api/administrative/catalog-items", {
      method: "POST",
      body: { ...serviceInput, name: "Nome ativo duplicado" },
    }))
    const anotherSegment = await POST(request("/api/administrative/catalog-items", {
      method: "POST",
      body: {
        ...serviceInput,
        name: "Nome ativo duplicado",
        segment: "Educação",
      },
    }))

    expect(conflict.status).toBe(409)
    expectNoStore(conflict)
    expect(anotherSegment.status).toBe(201)
  })

  it("updates with CAS and rejects a stale version without overwriting", async () => {
    const PATCH = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/route.ts",
      "PATCH",
    )
    const stale = await PATCH(request(`/api/administrative/catalog-items/${fixtures.serviceA}`, {
      method: "PATCH",
      body: { ...serviceInput, version: 2, description: "Edição local preservada" },
    }), context(fixtures.serviceA))

    expect(stale.status).toBe(409)
    expectNoStore(stale)
    expect(await stale.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "O item foi alterado por outra sessão.",
        correlationId: expect.any(String),
      },
    })
    expect(state.version).toBe(3)
  })

  it("keeps proposal snapshot text immutable after catalog description changes", async () => {
    const PATCH = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(request(`/api/administrative/catalog-items/${fixtures.linkedA}`, {
      method: "PATCH",
      body: { ...serviceInput, version: 3, description: "Nova descrição do catálogo" },
    }), context(fixtures.linkedA))

    expect(response.status).toBe(200)
    expect(state.proposalSnapshotDescription).toBe("Descrição histórica contratada")
    expect((await response.json()).record.description).toBe("Nova descrição do catálogo")
  })

  it("archives a linked item, restores it, and keeps deletion guarded", async () => {
    const archive = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/archive/route.ts",
      "POST",
    )
    const restore = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/restore/route.ts",
      "POST",
    )
    const remove = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/route.ts",
      "DELETE",
    )

    const archived = await archive(request("/archive", {
      method: "POST",
      body: { version: 3 },
    }), context(fixtures.linkedA))
    const restored = await restore(request("/restore", {
      method: "POST",
      body: { version: 4 },
    }), context(fixtures.linkedA))
    const linkedDelete = await remove(request(`/api/administrative/catalog-items/${fixtures.linkedA}`, {
      method: "DELETE",
      body: { version: 5 },
    }), context(fixtures.linkedA))
    const unlinkedDelete = await remove(request(`/api/administrative/catalog-items/${fixtures.productA}`, {
      method: "DELETE",
      body: { version: 5 },
    }), context(fixtures.productA))

    expect(archived.status).toBe(200)
    expect((await archived.json()).record.archivedAt).not.toBeNull()
    expect(restored.status).toBe(200)
    expect(linkedDelete.status).toBe(409)
    expect((await linkedDelete.json()).error.code).toBe("RESOURCE_IN_USE")
    expect(unlinkedDelete.status).toBe(204)
    expectNoStore(unlinkedDelete)
  })

  it("makes foreign and random IDs indistinguishable", async () => {
    const GET = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/route.ts",
      "GET",
    )
    const foreign = await GET(
      request(`/api/administrative/catalog-items/${fixtures.foreignB}`),
      context(fixtures.foreignB),
    )
    const unknown = await GET(
      request(`/api/administrative/catalog-items/${fixtures.random}`),
      context(fixtures.random),
    )

    expect(foreign.status).toBe(404)
    expect(unknown.status).toBe(404)
    expectNoStore(foreign)
    const foreignError = (await foreign.json()) as { error: Record<string, unknown> }
    const unknownError = (await unknown.json()) as { error: Record<string, unknown> }
    expect({ ...foreignError.error, correlationId: undefined }).toEqual({
      ...unknownError.error,
      correlationId: undefined,
    })
  })

  it("rejects company/actor/archival injection and unknown update fields", async () => {
    const POST = await route("/src/app/api/administrative/catalog-items/route.ts", "POST")
    const PATCH = await route(
      "/src/app/api/administrative/catalog-items/[itemId]/route.ts",
      "PATCH",
    )
    const injectedCreate = await POST(request("/api/administrative/catalog-items", {
      method: "POST",
      body: {
        ...serviceInput,
        companyId: randomUUID(),
        createdBy: randomUUID(),
        archivedAt: new Date().toISOString(),
      },
    }))
    const injectedUpdate = await PATCH(request(`/api/administrative/catalog-items/${fixtures.serviceA}`, {
      method: "PATCH",
      body: { ...serviceInput, version: 3, archivedBy: randomUUID() },
    }), context(fixtures.serviceA))

    expect(injectedCreate.status).toBe(422)
    expect(injectedUpdate.status).toBe(422)
    expect(service.createCatalogItem).not.toHaveBeenCalled()
    expect(service.updateCatalogItem).not.toHaveBeenCalled()
  })

  it("rejects foreign Origin and missing CSRF before invoking the service", async () => {
    const POST = await route("/src/app/api/administrative/catalog-items/route.ts", "POST")
    const external = await POST(request("/api/administrative/catalog-items", {
      method: "POST",
      origin: "https://evil.example",
      body: serviceInput,
    }))
    const missingCsrf = await POST(request("/api/administrative/catalog-items", {
      method: "POST",
      csrf: null,
      body: serviceInput,
    }))

    expect(external.status).toBe(403)
    expect(missingCsrf.status).toBe(403)
    expectNoStore(external)
    expectNoStore(missingCsrf)
    expect(service.createCatalogItem).not.toHaveBeenCalled()
  })
})
