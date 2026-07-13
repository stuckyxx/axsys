import { beforeEach, describe, expect, it, vi } from "vitest"

import { NO_STORE_HEADERS } from "@/lib/security/no-store"

const context = Object.freeze({
  kind: "company" as const,
  userId: "71000000-0000-4000-8000-000000000001",
  sessionId: "72000000-0000-4000-8000-000000000001",
  companyId: "73000000-0000-4000-8000-000000000001",
})
const profile = Object.freeze({
  userId: context.userId,
  email: "gabriel@example.test",
  displayName: "Gabriel Machado",
  preferredTheme: "dark" as const,
  avatarFileId: null,
  version: 4,
})
const db = vi.hoisted(() => ({
  attachOwnAvatar: vi.fn(),
  getOwnProfile: vi.fn(),
  updateOwnProfile: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "csrf-profile" }) }) }))
vi.mock("@/lib/security/csrf", () => ({ assertCsrf: vi.fn(), CSRF_COOKIE_NAME: "__Host-axsys-csrf" }))
vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: vi.fn() }))
vi.mock("@/modules/auth/server/guards", () => ({
  requireAccessApiContext: vi.fn(async () => context),
  requireCompanyApiContext: vi.fn(async () => context),
}))
vi.mock("@/lib/db/bff", () => ({ bffDb: db }))

import { GET, PATCH } from "@/app/api/profile/route"
import { POST } from "@/app/api/profile/avatar/route"

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "x-csrf-token": "csrf-profile" },
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
  db.getOwnProfile.mockResolvedValue(profile)
  db.updateOwnProfile.mockResolvedValue({ ...profile, displayName: "Gabriel M.", version: 5 })
  db.attachOwnAvatar.mockResolvedValue({ ...profile, avatarFileId: "74000000-0000-4000-8000-000000000001", version: 5 })
})

describe("profile API integration", () => {
  it("binds the verified actor/session to the BFF own-profile read", async () => {
    const response = await GET(request("/api/profile"))
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(db.getOwnProfile).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
    })
  })

  it("updates only display name with a server correlation and CAS version", async () => {
    const response = await PATCH(request("/api/profile", "PATCH", {
      displayName: "Gabriel M.", version: 4,
    }))
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(db.updateOwnProfile).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      displayName: "Gabriel M.",
      expectedVersion: 4,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    })

    const rejected = await PATCH(request("/api/profile", "PATCH", {
      displayName: "Gabriel M.", email: "other@example.test", version: 4,
    }))
    expect(rejected.status).toBe(422)
  })

  it("attaches only the authenticated company user's ready avatar id", async () => {
    const fileId = "74000000-0000-4000-8000-000000000001"
    const response = await POST(request("/api/profile/avatar", "POST", {
      fileId, version: 4,
    }))
    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(db.attachOwnAvatar).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      fileId,
      expectedVersion: 4,
    }))
  })
})
