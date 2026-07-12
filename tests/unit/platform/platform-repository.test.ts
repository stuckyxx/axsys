import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getPlatformDashboard,
  getCompanyDetail,
  listPlatformAdmins,
  listCompanies,
} from "@/modules/platform/server/platform-repository"

const mocks = vi.hoisted(() => ({
  getCompanyDetail: vi.fn(),
  getPlatformDashboard: vi.fn(),
  listPlatformAdmins: vi.fn(),
  listCompanies: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    getCompanyDetail: mocks.getCompanyDetail,
    getPlatformDashboard: mocks.getPlatformDashboard,
    listPlatformAdmins: mocks.listPlatformAdmins,
    listCompanies: mocks.listCompanies,
  },
}))

const identity = {
  userId: "71000000-0000-4000-8000-000000000001",
  sessionId: "72000000-0000-4000-8000-000000000001",
}

beforeEach(() => {
  mocks.listCompanies.mockResolvedValue({ items: [], nextCursor: null })
})

describe("platform repository", () => {
  it("forwards only a validated keyset cursor through the BFF boundary", async () => {
    const cursorValue = Buffer.from(
      JSON.stringify({
        createdAt: "2026-07-12T12:00:00.000Z",
        id: "73000000-0000-4000-8000-000000000001",
      }),
    ).toString("base64url")
    mocks.listCompanies.mockResolvedValue({
      items: [{ id: "74000000-0000-4000-8000-000000000001" }],
      nextCursor: {
        createdAt: "2026-07-11T12:00:00.000Z",
        id: "74000000-0000-4000-8000-000000000001",
      },
    })

    const result = await listCompanies(identity, {
      search: "Empresa",
      status: "active",
      cursor: cursorValue,
      limit: 25,
    })

    expect(mocks.listCompanies).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      search: "Empresa",
      status: "active",
      cursorCreatedAt: "2026-07-12T12:00:00.000Z",
      cursorId: "73000000-0000-4000-8000-000000000001",
      limit: 25,
    })
    expect(result.nextCursor).toEqual(expect.any(String))
  })

  it("rejects malformed cursors before a database call", async () => {
    await expect(
      listCompanies(identity, { cursor: "not-json", limit: 25 }),
    ).rejects.toBeDefined()
    expect(mocks.listCompanies).not.toHaveBeenCalled()
  })

  it("forwards detail reads with the authoritative actor session", async () => {
    const companyId = "75000000-0000-4000-8000-000000000001"
    const detail = { company: { id: companyId } }
    mocks.getCompanyDetail.mockResolvedValue(detail)

    await expect(getCompanyDetail(identity, companyId)).resolves.toBe(detail)
    expect(mocks.getCompanyDetail).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      companyId,
    })
  })

  it("decodes the administrator keyset without enumerating companies", async () => {
    const cursor = Buffer.from(JSON.stringify({
      createdAt: "2026-07-12T12:00:00.000Z",
      membershipId: "76000000-0000-4000-8000-000000000001",
    }), "utf8").toString("base64url")
    mocks.listPlatformAdmins.mockResolvedValue({
      items: [],
      nextCursor: {
        createdAt: "2026-07-11T12:00:00.000Z",
        membershipId: "76000000-0000-4000-8000-000000000002",
      },
    })

    const result = await listPlatformAdmins(identity, {
      search: "sertao",
      cursor,
      limit: 25,
    })

    expect(mocks.listPlatformAdmins).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      search: "sertao",
      cursorCreatedAt: "2026-07-12T12:00:00.000Z",
      cursorMembershipId: "76000000-0000-4000-8000-000000000001",
      limit: 25,
    })
    expect(result.nextCursor).toEqual(expect.any(String))
    expect(mocks.listCompanies).not.toHaveBeenCalled()
    expect(mocks.getCompanyDetail).not.toHaveBeenCalled()
  })

  it("reads the dashboard from one aggregate BFF call", async () => {
    const dashboard = { activeCompanies: 7 }
    mocks.getPlatformDashboard.mockResolvedValue(dashboard)
    await expect(getPlatformDashboard(identity)).resolves.toBe(dashboard)
    expect(mocks.getPlatformDashboard).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
    })
  })
})
