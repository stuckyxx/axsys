import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{ params: Promise<{ contractId: string }> }>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>

const ids = vi.hoisted(() => ({
  contract: "74000000-0000-4000-8000-000000000001",
  foreign: "74000000-0000-4000-8000-000000000002",
  client: "71000000-0000-4000-8000-000000000001",
}))
const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createCompanyContext> | null,
  version: 3,
  listInput: null as Record<string, unknown> | null,
}))

function contract(id = ids.contract) {
  return {
    id,
    clientId: ids.client,
    clientName: "Município de Horizonte",
    number: "CT-2026-017",
    object: "Prestação de serviços técnicos",
    startsOn: "2026-07-10",
    endsOn: "2026-08-24",
    amount: "12500.00",
    closedAt: null,
    closedOn: null,
    closeReason: null,
    version: state.version,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    status: "expiring" as const,
    progress: 0,
  }
}

const service = vi.hoisted(() => ({
  listContracts: vi.fn(async (input: Record<string, unknown>) => {
    state.listInput = input
    return { items: [contract()], nextCursor: null }
  }),
  getContractDetail: vi.fn(async ({ contractId }: { contractId: string }) => {
    if (contractId !== ids.contract)
      throw new ApiError("CONTRACT_NOT_FOUND", 404, "Contrato não encontrado.")
    return contract()
  }),
  createContract: vi.fn(async () => ({
    record: contract(),
    scopes: ["contracts"],
  })),
  updateContract: vi.fn(async ({ input }: { input: { version: number } }) => {
    if (input.version !== state.version)
      throw new ApiError(
        "VERSION_CONFLICT",
        409,
        "O contrato foi alterado por outra sessão.",
      )
    state.version += 1
    return { record: contract(), scopes: ["contracts"] }
  }),
  closeContract: vi.fn(async () => ({
    record: {
      ...contract(),
      closedAt: "2026-07-10T13:00:00.000Z",
      closedOn: "2026-07-10",
      closeReason: "Encerramento solicitado",
      status: "closed",
    },
    scopes: ["contracts"],
  })),
  deleteContract: vi.fn(async () => ({ record: null, scopes: ["contracts"] })),
}))

const security = vi.hoisted(() => ({ origin: vi.fn(), csrf: vi.fn() }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-csrf" }) }),
}))
vi.mock("@/lib/security/origin", () => ({
  assertMutationOrigin: security.origin,
}))
vi.mock("@/lib/security/csrf", () => ({
  assertCsrf: security.csrf,
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
}))
vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyApiContext: vi.fn(async (moduleName?: string) => {
    if (moduleName !== "administrative" || !state.context)
      throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
    return state.context
  }),
}))
vi.mock("@/modules/contracts/server/contract-service", () => service)

const modules = (
  import.meta as unknown as {
    glob<T>(pattern: string): Record<string, () => Promise<T>>
  }
).glob<RouteModule>("/src/app/api/administrative/contracts/**/route.ts")

async function route(
  path: string,
  method: keyof RouteModule,
): Promise<Handler> {
  const load = modules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const handler = (await load())[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function request(
  path: string,
  options: Readonly<{ method?: string; body?: unknown }> = {},
) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "x-csrf-token": "test-csrf",
      "x-correlation-id": randomUUID(),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}
function context(contractId: string): RouteContext {
  return { params: Promise.resolve({ contractId }) }
}
function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS))
    expect(response.headers.get(name)).toBe(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.context = createCompanyContext()
  state.version = 3
  state.listInput = null
})

describe.sequential("contract route contracts", () => {
  it("lists strict lifecycle filters with no-store", async () => {
    const GET = await route(
      "/src/app/api/administrative/contracts/route.ts",
      "GET",
    )
    const response = await GET(
      request(
        `/api/administrative/contracts?q=CT-2026&status=expiring&clientId=${ids.client}&limit=25`,
      ),
    )
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(state.listInput).toEqual(
      expect.objectContaining({
        q: "CT-2026",
        status: "expiring",
        clientId: ids.client,
        limit: 25,
      }),
    )
    const injected = await GET(
      request("/api/administrative/contracts?companyId=forbidden"),
    )
    expect(injected.status).toBe(422)
  })

  it("validates range and creates only after Origin/CSRF", async () => {
    const POST = await route(
      "/src/app/api/administrative/contracts/route.ts",
      "POST",
    )
    const invalid = await POST(
      request("/contracts", {
        method: "POST",
        body: {
          clientId: ids.client,
          number: "CT-1",
          object: "Objeto válido",
          startsOn: "2026-08-01",
          endsOn: "2026-07-01",
          amount: "100.00",
        },
      }),
    )
    expect(invalid.status).toBe(422)
    const valid = await POST(
      request("/contracts", {
        method: "POST",
        body: {
          clientId: ids.client,
          number: "CT-1",
          object: "Objeto válido",
          startsOn: "2026-07-01",
          endsOn: "2026-08-01",
          amount: "100.00",
        },
      }),
    )
    expect(valid.status).toBe(201)
    expect(security.origin).toHaveBeenCalledBefore(security.csrf)
  })

  it("hides foreign IDs and preserves CAS", async () => {
    const GET = await route(
      "/src/app/api/administrative/contracts/[contractId]/route.ts",
      "GET",
    )
    const foreign = await GET(request("/contract"), context(ids.foreign))
    const unknown = await GET(request("/contract"), context(randomUUID()))
    expect([foreign.status, unknown.status]).toEqual([404, 404])
    const PATCH = await route(
      "/src/app/api/administrative/contracts/[contractId]/route.ts",
      "PATCH",
    )
    const stale = await PATCH(
      request("/contract", {
        method: "PATCH",
        body: {
          version: 2,
          clientId: ids.client,
          number: "CT-1",
          object: "Edição local preservada",
          startsOn: "2026-07-01",
          endsOn: "2026-08-01",
          amount: "100.00",
        },
      }),
      context(ids.contract),
    )
    expect(stale.status).toBe(409)
  })

  it("closes explicitly and deletes only with a strict version", async () => {
    const POST = await route(
      "/src/app/api/administrative/contracts/[contractId]/close/route.ts",
      "POST",
    )
    const closed = await POST(
      request("/close", {
        method: "POST",
        body: { version: 3, reason: "Encerramento solicitado" },
      }),
      context(ids.contract),
    )
    expect(closed.status).toBe(200)
    expect((await closed.json()).record.status).toBe("closed")
    const DELETE = await route(
      "/src/app/api/administrative/contracts/[contractId]/route.ts",
      "DELETE",
    )
    const invalid = await DELETE(
      request("/contract", {
        method: "DELETE",
        body: { version: 3, companyId: "x" },
      }),
      context(ids.contract),
    )
    const valid = await DELETE(
      request("/contract", { method: "DELETE", body: { version: 3 } }),
      context(ids.contract),
    )
    expect(invalid.status).toBe(422)
    expect(valid.status).toBe(204)
  })
})
