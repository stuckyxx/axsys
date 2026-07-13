import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{ params: Promise<{ proposalId: string }> }>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>

const ids = vi.hoisted(() => ({
  proposal: "73000000-0000-4000-8000-000000000001",
  foreign: "73000000-0000-4000-8000-000000000002",
  client: "71000000-0000-4000-8000-000000000001",
  catalog: "72000000-0000-4000-8000-000000000001",
}))

const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createCompanyContext> | null,
  version: 3,
  status: "draft" as "draft" | "sent" | "approved" | "rejected",
  listInput: null as Record<string, unknown> | null,
}))

function item() {
  return {
    id: randomUUID(),
    catalogItemId: ids.catalog,
    itemKind: "service" as const,
    position: 1,
    description: "Serviço histórico preservado",
    months: 2,
    monthlyAmount: "1250.40",
    quantity: null,
    unitAmount: null,
    lineTotal: "2500.80",
  }
}

function proposal(id = ids.proposal) {
  return {
    id,
    clientId: ids.client,
    clientName: "Município de Horizonte",
    segment: "Prefeituras",
    number: 17,
    issuedOn: "2026-07-12",
    status: state.status,
    total: "2500.80",
    sentAt: state.status === "draft" ? null : "2026-07-12T13:00:00.000Z",
    version: state.version,
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
  }
}

const service = vi.hoisted(() => ({
  listProposals: vi.fn(async (input: Record<string, unknown>) => {
    state.listInput = input
    return { items: [{ ...proposal(), itemCount: 1 }], nextCursor: null }
  }),
  getProposalDetail: vi.fn(async ({ proposalId }: { proposalId: string }) => {
    if (proposalId !== ids.proposal) {
      throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
    }
    return { proposal: proposal(), items: [item()] }
  }),
  createProposal: vi.fn(async () => ({ proposal: proposal(), items: [item()] })),
  updateDraftProposal: vi.fn(async ({ input }: { input: { version: number } }) => {
    if (input.version !== state.version) {
      throw new ApiError("VERSION_CONFLICT", 409, "A proposta foi alterada por outra sessão.")
    }
    state.version += 1
    return { proposal: proposal(), items: [item()] }
  }),
  transitionProposalStatus: vi.fn(async ({ nextStatus }: { nextStatus: string }) => {
    if (state.status === "draft" && nextStatus === "approved") {
      throw new ApiError("INVALID_STATUS_TRANSITION", 409, "Transição de estado inválida.")
    }
    if (state.status === "draft" && nextStatus === "sent") {
      throw new ApiError("DOCUMENT_REQUIRED", 409, "Gere um PDF antes do envio.")
    }
    if (state.status === "approved" || state.status === "rejected") {
      throw new ApiError("INVALID_STATUS_TRANSITION", 409, "Transição de estado inválida.")
    }
    state.status = nextStatus as typeof state.status
    state.version += 1
    return { record: proposal(), scopes: ["proposals", "dashboard"] }
  }),
  deleteDraftProposal: vi.fn(async () => ({ record: null, scopes: ["proposals", "dashboard"] })),
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
vi.mock("@/modules/proposals/server/proposal-service", () => service)

const modules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/administrative/proposals/**/route.ts")

async function route(path: string, method: keyof RouteModule): Promise<Handler> {
  const load = modules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const handler = (await load())[method]
  if (!handler) throw new Error(`Missing ${method} handler: ${path}`)
  return handler
}

function request(path: string, options: Readonly<{ method?: string; body?: unknown }> = {}) {
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

function context(proposalId: string): RouteContext {
  return { params: Promise.resolve({ proposalId }) }
}

function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.context = createCompanyContext()
  state.version = 3
  state.status = "draft"
  state.listInput = null
})

describe.sequential("proposal route contracts", () => {
  it("lists with strict filters and private no-store semantics", async () => {
    const GET = await route("/src/app/api/administrative/proposals/route.ts", "GET")
    const response = await GET(request(
      `/api/administrative/proposals?q=Horizonte&clientId=${ids.client}&segment=Prefeituras&status=draft&issuedFrom=2026-07-01&issuedTo=2026-07-31&limit=25`,
    ))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(state.listInput).toEqual(expect.objectContaining({
      q: "Horizonte",
      clientId: ids.client,
      status: "draft",
      issuedFrom: "2026-07-01",
      issuedTo: "2026-07-31",
      limit: 25,
    }))
  })

  it("rejects tenant injection and duplicate query keys", async () => {
    const GET = await route("/src/app/api/administrative/proposals/route.ts", "GET")
    const tenant = await GET(request("/api/administrative/proposals?companyId=forbidden"))
    const duplicate = await GET(request("/api/administrative/proposals?q=um&q=dois"))
    expect(tenant.status).toBe(422)
    expect(duplicate.status).toBe(422)
    expect(service.listProposals).not.toHaveBeenCalled()
  })

  it("creates a strict proposal after Origin and CSRF", async () => {
    const POST = await route("/src/app/api/administrative/proposals/route.ts", "POST")
    const response = await POST(request("/api/administrative/proposals", {
      method: "POST",
      body: {
        clientId: ids.client,
        segment: "Prefeituras",
        issuedOn: "2026-07-12",
        items: [{
          kind: "service",
          catalogItemId: ids.catalog,
          description: "Serviço histórico preservado",
          months: 2,
          monthlyAmount: "1250.40",
        }],
      },
    }))
    expect(response.status).toBe(201)
    expectNoStore(response)
    expect(security.origin).toHaveBeenCalledBefore(security.csrf)
    expect(service.createProposal).toHaveBeenCalledWith(expect.objectContaining({
      context: state.context,
      correlationId: expect.any(String),
    }))
  })

  it("returns identical 404 shape for foreign and random IDs", async () => {
    const GET = await route("/src/app/api/administrative/proposals/[proposalId]/route.ts", "GET")
    const foreign = await GET(request(`/api/administrative/proposals/${ids.foreign}`), context(ids.foreign))
    const randomId = randomUUID()
    const random = await GET(request(`/api/administrative/proposals/${randomId}`), context(randomId))
    expect(foreign.status).toBe(404)
    expect(random.status).toBe(404)
    const a = (await foreign.json()) as { error: Record<string, unknown> }
    const b = (await random.json()) as { error: Record<string, unknown> }
    expect({ ...a.error, correlationId: undefined }).toEqual({ ...b.error, correlationId: undefined })
  })

  it("supports strict detail or item draft patches and preserves CAS", async () => {
    const PATCH = await route("/src/app/api/administrative/proposals/[proposalId]/route.ts", "PATCH")
    const stale = await PATCH(request(`/api/administrative/proposals/${ids.proposal}`, {
      method: "PATCH",
      body: {
        version: 2,
        items: [{
          kind: "service",
          catalogItemId: ids.catalog,
          description: "Edição local preservada",
          months: 3,
          monthlyAmount: "900.00",
        }],
      },
    }), context(ids.proposal))
    expect(stale.status).toBe(409)
    expectNoStore(stale)

    const unknown = await PATCH(request(`/api/administrative/proposals/${ids.proposal}`, {
      method: "PATCH",
      body: { version: 3, status: "approved" },
    }), context(ids.proposal))
    expect(unknown.status).toBe(422)
  })

  it("distinguishes invalid transitions, missing documents and terminal states", async () => {
    const POST = await route(
      "/src/app/api/administrative/proposals/[proposalId]/status/route.ts",
      "POST",
    )
    const approvedFromDraft = await POST(request("/status", {
      method: "POST",
      body: { expectedVersion: 3, nextStatus: "approved" },
    }), context(ids.proposal))
    expect(approvedFromDraft.status).toBe(409)
    expect((await approvedFromDraft.json()).error.code).toBe("INVALID_STATUS_TRANSITION")

    const sentWithoutPdf = await POST(request("/status", {
      method: "POST",
      body: { expectedVersion: 3, nextStatus: "sent" },
    }), context(ids.proposal))
    expect(sentWithoutPdf.status).toBe(409)
    expect((await sentWithoutPdf.json()).error.code).toBe("DOCUMENT_REQUIRED")

    state.status = "approved"
    const terminal = await POST(request("/status", {
      method: "POST",
      body: { expectedVersion: 3, nextStatus: "rejected" },
    }), context(ids.proposal))
    expect(terminal.status).toBe(409)
  })

  it("deletes only through a strict versioned body", async () => {
    const DELETE = await route("/src/app/api/administrative/proposals/[proposalId]/route.ts", "DELETE")
    const invalid = await DELETE(request("/delete", {
      method: "DELETE",
      body: { version: 3, companyId: createCompanyContext().companyId },
    }), context(ids.proposal))
    const valid = await DELETE(request("/delete", {
      method: "DELETE",
      body: { version: 3 },
    }), context(ids.proposal))
    expect(invalid.status).toBe(422)
    expect(valid.status).toBe(204)
    expectNoStore(valid)
  })
})
