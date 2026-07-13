import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createCompanyContext } from "../../helpers/auth"

type RouteContext = Readonly<{
  params: Promise<{ proposalId: string; documentId?: string }>
}>
type Handler = (request: Request, context?: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<"GET" | "POST", Handler>>

const ids = vi.hoisted(() => ({
  proposal: "73000000-0000-4000-8000-000000000001",
  foreignProposal: "73000000-0000-4000-8000-000000000002",
  document: "75000000-0000-4000-8000-000000000001",
  foreignDocument: "75000000-0000-4000-8000-000000000002",
}))

const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof createCompanyContext> | null,
  version: 0,
}))

const documents = vi.hoisted(() => ({
  generateProposalPdf: vi.fn(async ({ proposalId }: { proposalId: string }) => {
    if (proposalId !== ids.proposal) {
      throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
    }
    state.version += 1
    return {
      documentId: ids.document,
      version: state.version,
      checksumSha256: "a".repeat(64),
      templateVersion: "proposal-v1",
      createdAt: "2026-07-12T12:00:00.000Z",
      scopes: ["proposals", "storage"],
    }
  }),
  listProposalDocuments: vi.fn(async ({ proposalId }: { proposalId: string }) => {
    if (proposalId !== ids.proposal) {
      throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
    }
    return [{
      documentId: ids.document,
      version: state.version,
      checksumSha256: "a".repeat(64),
      templateVersion: "proposal-v1",
      createdAt: "2026-07-12T12:00:00.000Z",
    }]
  }),
  downloadProposalDocument: vi.fn(async ({ proposalId, documentId }: {
    proposalId: string
    documentId: string
  }) => {
    if (proposalId !== ids.proposal || documentId !== ids.document) {
      throw new ApiError("DOCUMENT_NOT_FOUND", 404, "Documento não encontrado.")
    }
    return new Response(Buffer.from("%PDF-1.7\n"), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": "attachment; filename=proposta-17-v1.pdf",
        "Content-Security-Policy": "sandbox",
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    })
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
vi.mock("@/modules/documents/server/proposal-pdf-service", () => documents)

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

function request(path: string, method = "GET") {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:3000",
      "x-csrf-token": "test-csrf",
      "x-correlation-id": randomUUID(),
    },
  })
}

function context(proposalId: string, documentId?: string): RouteContext {
  return { params: Promise.resolve({ proposalId, ...(documentId ? { documentId } : {}) }) }
}

function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.context = createCompanyContext()
  state.version = 0
})

describe.sequential("proposal PDF route contracts", () => {
  it("generates immutable versions after Origin and CSRF", async () => {
    const POST = await route(
      "/src/app/api/administrative/proposals/[proposalId]/documents/route.ts",
      "POST",
    )
    const first = await POST(request("/documents", "POST"), context(ids.proposal))
    const second = await POST(request("/documents", "POST"), context(ids.proposal))
    expect([first.status, second.status]).toEqual([201, 201])
    expectNoStore(first)
    expect(security.origin).toHaveBeenCalledBefore(security.csrf)
    expect((await first.json()).version).toBe(1)
    expect((await second.json()).version).toBe(2)
  })

  it("lists only safe document metadata", async () => {
    state.version = 2
    const GET = await route(
      "/src/app/api/administrative/proposals/[proposalId]/documents/route.ts",
      "GET",
    )
    const response = await GET(request("/documents"), context(ids.proposal))
    expect(response.status).toBe(200)
    expectNoStore(response)
    const body = await response.json()
    expect(body).toEqual([{ documentId: ids.document, version: 2,
      checksumSha256: "a".repeat(64), templateVersion: "proposal-v1",
      createdAt: "2026-07-12T12:00:00.000Z" }])
    expect(JSON.stringify(body)).not.toMatch(/object|bucket|path|snapshot|fileObject/iu)
  })

  it("returns the same safe 404 for foreign and random proposals", async () => {
    const POST = await route(
      "/src/app/api/administrative/proposals/[proposalId]/documents/route.ts",
      "POST",
    )
    const foreign = await POST(request("/documents", "POST"), context(ids.foreignProposal))
    const random = await POST(request("/documents", "POST"), context(randomUUID()))
    expect(foreign.status).toBe(404)
    expect(random.status).toBe(404)
    const a = (await foreign.json()) as { error: Record<string, unknown> }
    const b = (await random.json()) as { error: Record<string, unknown> }
    expect({ ...a.error, correlationId: undefined }).toEqual({ ...b.error, correlationId: undefined })
  })

  it("streams a sandboxed no-store PDF and hides unrelated documents", async () => {
    const GET = await route(
      "/src/app/api/administrative/proposals/[proposalId]/documents/[documentId]/download/route.ts",
      "GET",
    )
    const valid = await GET(request("/download"), context(ids.proposal, ids.document))
    expect(valid.status).toBe(200)
    expect(valid.headers.get("content-type")).toBe("application/pdf")
    expect(valid.headers.get("x-content-type-options")).toBe("nosniff")
    expect(valid.headers.get("content-security-policy")).toBe("sandbox")
    expect(valid.headers.get("cache-control")).toContain("no-store")

    const foreign = await GET(
      request("/download"),
      context(ids.proposal, ids.foreignDocument),
    )
    const random = await GET(request("/download"), context(ids.proposal, randomUUID()))
    expect(foreign.status).toBe(404)
    expect(random.status).toBe(404)
  })
})
