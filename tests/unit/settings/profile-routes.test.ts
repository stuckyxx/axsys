import { beforeEach, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { ApiError } from "@/lib/http/api-error"

const mocks = vi.hoisted(() => ({
  attachAvatar: vi.fn(),
  getOwnProfile: vi.fn(),
  updateDisplayName: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "csrf-profile" }) }) }))
vi.mock("@/lib/security/csrf", () => ({ assertCsrf: vi.fn(), CSRF_COOKIE_NAME: "__Host-axsys-csrf" }))
vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: vi.fn() }))
vi.mock("@/modules/auth/server/guards", () => {
  const context = {
    kind: "company",
    userId: "71000000-0000-4000-8000-000000000001",
    sessionId: "72000000-0000-4000-8000-000000000001",
    companyId: "73000000-0000-4000-8000-000000000001",
  }
  return {
    requireAccessApiContext: vi.fn(async () => context),
    requireCompanyApiContext: vi.fn(async () => context),
  }
})
vi.mock("@/modules/settings/server/profile-service", () => ({
  attachOwnAvatar: mocks.attachAvatar,
  getOwnProfile: mocks.getOwnProfile,
  updateOwnDisplayName: mocks.updateDisplayName,
}))

type Route = Partial<Record<"GET" | "PATCH" | "POST", (request: Request) => Promise<Response>>>
const routes = (import.meta as unknown as { glob<T>(pattern: string): Record<string, () => Promise<T>> }).glob<Route>(
  "/src/app/api/profile/**/route.ts",
)

async function handler(path: string, method: keyof Route) {
  const load = routes[path]
  if (!load) throw new Error(`Missing route ${path}`)
  const value = (await load())[method]
  if (!value) throw new Error(`Missing method ${method}`)
  return value
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "x-csrf-token": "csrf-profile" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function noStore(response: Response) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) expect(response.headers.get(key)).toBe(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getOwnProfile.mockResolvedValue({ displayName: "Gabriel Machado", email: "gabriel@example.test", preferredTheme: "dark", version: 4, avatarFileId: null })
  mocks.updateDisplayName.mockResolvedValue({ displayName: "Gabriel M.", email: "gabriel@example.test", preferredTheme: "dark", version: 5, avatarFileId: null })
  mocks.attachAvatar.mockResolvedValue({ displayName: "Gabriel Machado", email: "gabriel@example.test", preferredTheme: "dark", version: 5, avatarFileId: "74000000-0000-4000-8000-000000000001" })
})

describe("profile routes", () => {
  it("reads only the authenticated user's strict profile without cache", async () => {
    const GET = await handler("/src/app/api/profile/route.ts", "GET")
    const response = await GET(request("/api/profile"))
    expect(response.status).toBe(200)
    noStore(response)
    expect(mocks.getOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: expect.any(String), sessionId: expect.any(String) }))
  })

  it("updates display name with CAS and rejects email or privileges", async () => {
    const PATCH = await handler("/src/app/api/profile/route.ts", "PATCH")
    const good = await PATCH(request("/api/profile", "PATCH", { displayName: "Gabriel M.", version: 4 }))
    expect(good.status).toBe(200)
    noStore(good)
    expect(mocks.updateDisplayName).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Gabriel M.", version: 4 }))

    for (const forbidden of [{ email: "new@example.test" }, { role: "super_admin" }, { companyId: crypto.randomUUID() }, { modules: [] }]) {
      const response = await PATCH(request("/api/profile", "PATCH", { displayName: "Gabriel M.", version: 4, ...forbidden }))
      expect(response.status).toBe(422)
    }
  })

  it("attaches a ready avatar through the purpose-specific CAS service", async () => {
    const POST = await handler("/src/app/api/profile/avatar/route.ts", "POST")
    const response = await POST(request("/api/profile/avatar", "POST", { fileId: "74000000-0000-4000-8000-000000000001", version: 4 }))
    expect(response.status).toBe(200)
    noStore(response)
    expect(mocks.attachAvatar).toHaveBeenCalledWith(expect.objectContaining({ fileId: "74000000-0000-4000-8000-000000000001", version: 4 }))
  })

  it("returns the authoritative current profile on a CAS conflict", async () => {
    mocks.updateDisplayName.mockRejectedValueOnce(
      new ApiError("VERSION_CONFLICT", 409, "O perfil foi alterado."),
    )
    const PATCH = await handler("/src/app/api/profile/route.ts", "PATCH")
    const response = await PATCH(request("/api/profile", "PATCH", {
      displayName: "Gabriel M.", version: 3,
    }))

    expect(response.status).toBe(409)
    noStore(response)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
      current: { version: 4, displayName: "Gabriel Machado" },
    })
  })

  it("returns the authoritative current profile on an avatar CAS conflict", async () => {
    mocks.attachAvatar.mockRejectedValueOnce(
      new ApiError("VERSION_CONFLICT", 409, "O perfil foi alterado."),
    )
    const POST = await handler("/src/app/api/profile/avatar/route.ts", "POST")
    const response = await POST(request("/api/profile/avatar", "POST", {
      fileId: "74000000-0000-4000-8000-000000000001", version: 3,
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT" },
      current: { version: 4 },
    })
  })
})
