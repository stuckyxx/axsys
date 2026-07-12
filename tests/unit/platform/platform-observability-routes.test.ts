import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"

const state = vi.hoisted(() => ({ allowed: true }))
const mocks = vi.hoisted(() => ({
  getPlatformHealth: vi.fn(),
  listPlatformAuditEvents: vi.fn(),
  consumeRateLimit: vi.fn(async () => ({
    allowed: state.allowed,
    attempts: 1,
    retryAfterSeconds: state.allowed ? 0 : 60,
  })),
}))

vi.mock("@/modules/auth/server/guards", () => ({
  requirePlatformApiContext: vi.fn(async () => ({
    kind: "platform",
    userId: "71000000-0000-4000-8000-000000000001",
    sessionId: "72000000-0000-4000-8000-000000000001",
  })),
}))
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}))
vi.mock("@/modules/audit/server/list-platform-audit-events", () => ({
  listPlatformAuditEvents: mocks.listPlatformAuditEvents,
}))
vi.mock("@/modules/platform/server/platform-health", () => ({
  getPlatformHealth: mocks.getPlatformHealth,
}))

type RouteModule = Readonly<{ GET(request: Request): Promise<Response> }>
const routeModules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/platform/{audit,health}/route.ts")

async function getRoute(name: "audit" | "health") {
  const load = routeModules[`/src/app/api/platform/${name}/route.ts`]
  if (!load) throw new Error(`Missing ${name} route`)
  return (await load()).GET
}

function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.allowed = true
  mocks.listPlatformAuditEvents.mockResolvedValue({ items: [], nextCursor: null })
  mocks.getPlatformHealth.mockResolvedValue({
    checkedAt: "2026-07-12T12:00:00.000Z",
    database: "healthy",
    auth: "healthy",
    storage: "healthy",
  })
})

describe("platform audit and health routes", () => {
  it("validates audit filters, rate limits by platform actor and disables caches", async () => {
    const GET = await getRoute("audit")
    const response = await GET(new Request(
      "http://127.0.0.1:3000/api/platform/audit?action=company.updated&outcome=success&limit=25",
      { headers: { "x-correlation-id": crypto.randomUUID() } },
    ))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "platform-observability-read",
      "71000000-0000-4000-8000-000000000001:audit",
    )
    expect(mocks.listPlatformAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      expect.objectContaining({ action: "company.updated", outcome: "success", limit: 25 }),
    )
  })

  it("returns a stable no-store 429 without querying observability providers", async () => {
    state.allowed = false
    const GET = await getRoute("health")
    const response = await GET(new Request(
      "http://127.0.0.1:3000/api/platform/health",
      { headers: { "x-correlation-id": crypto.randomUUID() } },
    ))

    expect(response.status).toBe(429)
    expectNoStore(response)
    expect(mocks.getPlatformHealth).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PLATFORM_RATE_LIMITED" },
    })
  })

  it("rejects malformed audit filters before the database boundary", async () => {
    const GET = await getRoute("audit")
    const response = await GET(new Request(
      "http://127.0.0.1:3000/api/platform/audit?action=%3Cscript%3E&limit=1000",
      { headers: { "x-correlation-id": crypto.randomUUID() } },
    ))

    expect(response.status).toBe(422)
    expect(mocks.listPlatformAuditEvents).not.toHaveBeenCalled()
  })

  it("normalizes forbidden platform access without leaking provider details", async () => {
    const guards = await import("@/modules/auth/server/guards")
    vi.mocked(guards.requirePlatformApiContext).mockRejectedValueOnce(
      new ApiError("PLATFORM_FORBIDDEN", 403, "Operação não autorizada."),
    )
    const GET = await getRoute("health")
    const response = await GET(new Request("http://127.0.0.1:3000/api/platform/health"))
    expect(response.status).toBe(403)
    expectNoStore(response)
  })
})
