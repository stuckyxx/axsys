import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { retireUploadAuthorizations } from "@/modules/files/server/expired-upload-cleaner"

function claim() {
  return {
    intentId: randomUUID(),
    quarantineObjectPath: `${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}`,
    retirementStatus: "expired" as const,
    claimId: randomUUID(),
    expectedVersion: 4,
  }
}

function fixture(claims = [claim()]) {
  const repository = {
    claim: vi.fn().mockResolvedValue(claims),
    complete: vi.fn().mockResolvedValue({ releasedBytes: 200 }),
    release: vi.fn().mockResolvedValue(5),
    cancelStaleReserved: vi.fn().mockResolvedValue(2),
  }
  const storage = { removeQuarantine: vi.fn().mockResolvedValue(undefined) }
  return { repository, storage }
}

describe("expired upload authorization cleaner", () => {
  it("deletes the exact object before releasing quota and state", async () => {
    const deps = fixture()
    const workerId = randomUUID()

    await expect(
      retireUploadAuthorizations(deps, { workerId, limit: 25 }),
    ).resolves.toEqual({
      claimed: 1,
      retired: 1,
      releasedClaims: 0,
      cancelledReserved: 2,
      releasedBytes: 200,
    })
    expect(deps.repository.claim).toHaveBeenCalledWith(25, workerId)
    expect(deps.storage.removeQuarantine).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f/-]+$/u),
    )
    expect(
      deps.storage.removeQuarantine.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.repository.complete.mock.invocationCallOrder[0]!)
  })

  it("releases only the lease and preserves quota when deletion fails", async () => {
    const deps = fixture()
    deps.storage.removeQuarantine.mockRejectedValue(
      Object.assign(new Error("private storage detail"), {
        code: "FILE_QUARANTINE_DELETE_UNAVAILABLE",
      }),
    )

    await expect(
      retireUploadAuthorizations(deps, {
        workerId: randomUUID(),
        limit: 10,
      }),
    ).resolves.toMatchObject({ retired: 0, releasedClaims: 1 })
    expect(deps.repository.complete).not.toHaveBeenCalled()
    expect(deps.repository.release).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "FILE_QUARANTINE_DELETE_UNAVAILABLE",
      }),
    )
  })

  it("keeps the claim leased when completion is ambiguous after delete", async () => {
    const deps = fixture()
    deps.repository.complete.mockRejectedValue(new Error("database timeout"))

    await expect(
      retireUploadAuthorizations(deps, {
        workerId: randomUUID(),
        limit: 10,
      }),
    ).rejects.toThrow("Upload retirement unavailable")
    expect(deps.repository.release).not.toHaveBeenCalled()
  })
})
