import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  listPlatformAuditEvents,
  sanitizeAuditMetadata,
} from "@/modules/audit/server/list-platform-audit-events"
import { getPlatformHealth } from "@/modules/platform/server/platform-health"

const mocks = vi.hoisted(() => ({
  getPlatformHealth: vi.fn(),
  listPlatformAuditEvents: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({ bffDb: mocks }))

const identity = Object.freeze({
  userId: "71000000-0000-4000-8000-000000000001",
  sessionId: "72000000-0000-4000-8000-000000000001",
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPlatformHealth.mockResolvedValue({
    checkedAt: "2026-07-12T12:00:00.000Z",
    pendingCompensations: 2,
    pendingCompanyAccessReconciliations: 1,
    pendingMemberAccessReconciliations: 1,
    pendingFileCleanup: 3,
    scanFailures: 1,
    storageBytes: 12_500,
    reservedStorageBytes: 640,
    companiesNearQuota: 2,
    quotaDriftAlerts: 0,
  })
})

describe("platform observability", () => {
  it("allowlists audit metadata again at the application boundary", () => {
    expect(sanitizeAuditMetadata({
      accountLast4: "2901",
      madeDefault: true,
      moduleCount: 2,
      temporaryPassword: "must-not-leak",
      nested: { token: "must-not-leak" },
    })).toEqual({ accountLast4: "2901", madeDefault: true, moduleCount: 2 })
  })

  it("drops invalid values even when they use an allowlisted metadata key", () => {
    expect(sanitizeAuditMetadata({
      accountLast4: "full-account-482901",
      bankCode: { secret: "001" },
      madeDefault: "true",
      moduleCount: 99,
      nextStatus: "private-value",
    })).toEqual({})
  })

  it("uses the authoritative keyset tuple and returns a fresh encoded cursor", async () => {
    const event = {
        id: "73000000-0000-4000-8000-000000000001",
        actorUserId: identity.userId,
        action: "company.updated",
        resourceType: "company",
        resourceId: "74000000-0000-4000-8000-000000000001",
        outcome: "success",
        reasonCode: null,
        correlationId: "75000000-0000-4000-8000-000000000001",
        metadata: { moduleCount: 2, secret: "drop" },
        occurredAt: "2026-07-12T12:00:00.000Z",
      }
    mocks.listPlatformAuditEvents.mockResolvedValue([
      event,
      { ...event, id: "73000000-0000-4000-8000-000000000002" },
    ])

    const result = await listPlatformAuditEvents(identity, {
      action: "company.updated",
      limit: 1,
    })

    expect(mocks.listPlatformAuditEvents).toHaveBeenCalledWith({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      action: "company.updated",
      resourceType: null,
      outcome: null,
      cursorOccurredAt: null,
      cursorId: null,
      limit: 2,
    })
    expect(result.items[0]?.metadata).toEqual({ moduleCount: 2 })
    expect(result.nextCursor).toEqual(expect.any(String))
  })

  it("checks database, Auth and private Storage in parallel with fixed probes", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const authProbe = vi.fn(async () => { await gate; return true })
    const storageProbe = vi.fn(async () => { await gate; return true })

    const pending = getPlatformHealth(identity, { authProbe, storageProbe })
    await vi.waitFor(() => {
      expect(mocks.getPlatformHealth).toHaveBeenCalledOnce()
      expect(authProbe).toHaveBeenCalledOnce()
      expect(storageProbe).toHaveBeenCalledOnce()
    })
    release?.()

    await expect(pending).resolves.toMatchObject({
      database: "healthy",
      auth: "healthy",
      storage: "healthy",
      pendingCompensations: 2,
    })
  })

  it("degrades an unavailable probe without discarding database counters", async () => {
    const result = await getPlatformHealth(identity, {
      authProbe: async () => false,
      storageProbe: async () => { throw new Error("provider detail") },
    })

    expect(result).toMatchObject({
      database: "healthy",
      auth: "degraded",
      storage: "degraded",
      pendingFileCleanup: 3,
    })
    expect(JSON.stringify(result)).not.toContain("provider detail")
  })
})
