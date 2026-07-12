import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { createPlatformContext } from "../../helpers/auth"

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

type RouteModule = Partial<Record<"GET" | "POST" | "PATCH", RouteHandler>>

const ids = vi.hoisted(() => ({
  company: "91000000-0000-4000-8000-000000000001",
  membership: "92000000-0000-4000-8000-000000000001",
  targetUser: "93000000-0000-4000-8000-000000000001",
  operation: "94000000-0000-4000-8000-000000000001",
}))

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  provision: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  reset: vi.fn(),
  recent: vi.fn(),
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
  enforceUserMutationRateLimit: vi.fn(async () => null),
}))
vi.mock("@/modules/auth/server/guards", () => ({
  requirePlatformApiContext: vi.fn(async () => createPlatformContext()),
  requireRecentAuthentication: mocks.recent,
}))
vi.mock("@/modules/users/server/user-provisioner", () => ({
  provisionCompanyUserWithDefaults: mocks.provision,
}))
vi.mock("@/modules/users/server/user-service", () => ({
  listPlatformCompanyAdmins: mocks.list,
  updatePlatformCompanyAdmin: mocks.update,
  getPlatformCompanyAdmin: mocks.get,
  resetTemporaryPassword: mocks.reset,
}))

const routeModules = (import.meta as unknown as {
  glob<T>(pattern: string): Record<string, () => Promise<T>>
}).glob<RouteModule>("/src/app/api/platform/{companies/**/admins,admins/**}/route.ts")

async function handler(path: string, method: "GET" | "POST" | "PATCH") {
  const load = routeModules[path]
  if (!load) throw new Error(`Missing route module: ${path}`)
  const value = (await load())[method]
  if (!value) throw new Error(`Missing ${method}: ${path}`)
  return value
}

function request(path: string, method: "GET" | "POST" | "PATCH", body?: unknown) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "idempotency-key": "platform-admin-create-0001",
      "x-csrf-token": "test-csrf",
      "x-correlation-id": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ items: [] })
  mocks.update.mockResolvedValue({ membershipId: ids.membership })
  mocks.get.mockResolvedValue({ targetUserId: ids.targetUser })
  mocks.reset.mockResolvedValue({ status: "completed" })
})

describe("platform company-admin HTTP boundary", () => {
  it("lists only the selected company administrators without cache", async () => {
    const GET = await handler(
      "/src/app/api/platform/companies/[companyId]/admins/route.ts",
      "GET",
    )
    const response = await GET(request("/api/platform/companies/x/admins", "GET"), {
      params: Promise.resolve({ companyId: ids.company }),
    })
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ids.company }),
    )
  })

  it("rejects a non-admin role before platform provisioning", async () => {
    const POST = await handler(
      "/src/app/api/platform/companies/[companyId]/admins/route.ts",
      "POST",
    )
    const response = await POST(
      request("/api/platform/companies/x/admins", "POST", {
        displayName: "Pessoa Plataforma",
        email: "pessoa@example.test",
        temporaryPassword: "Frase provisória forte 42!",
        role: "member",
        modules: [],
      }),
      { params: Promise.resolve({ companyId: ids.company }) },
    )
    expect(response.status).toBe(422)
    expect(mocks.provision).not.toHaveBeenCalled()
  })

  it("requires recent authentication and forwards a strict admin update", async () => {
    const PATCH = await handler(
      "/src/app/api/platform/admins/[membershipId]/route.ts",
      "PATCH",
    )
    const response = await PATCH(
      request("/api/platform/admins/x", "PATCH", {
        displayName: "Admin Atualizada",
        role: "company_admin",
        modules: ["financial"],
        status: "active",
        suspensionReason: null,
        version: 1,
      }),
      { params: Promise.resolve({ membershipId: ids.membership }) },
    )
    expect(response.status).toBe(200)
    expect(mocks.recent).toHaveBeenCalledWith(expect.any(Object), 600)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: ids.membership }),
    )
  })

  it("returns safe retry metadata without exposing a provisional password", async () => {
    mocks.reset.mockRejectedValue(
      Object.assign(
        new ApiError("TEMPORARY_PASSWORD_RETRY_REQUIRED", 503, "Pendente."),
        { operationId: ids.operation, operationStatus: "failed" },
      ),
    )
    const POST = await handler(
      "/src/app/api/platform/admins/[membershipId]/reset-password/route.ts",
      "POST",
    )
    const password = "Frase provisória forte 42!"
    const response = await POST(
      request("/api/platform/admins/x/reset-password", "POST", {
        temporaryPassword: password,
        reasonCode: "ADMIN_RESET_USER_REQUEST",
      }),
      { params: Promise.resolve({ membershipId: ids.membership }) },
    )
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(body).toContain(ids.operation)
    expect(body).not.toContain(password)
  })
})
