import { createHash, randomUUID } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import { createAuthorizedDownload } from "@/modules/files/server/authorize-file-download"
import { acquireDownloadCapacity } from "@/modules/files/server/audited-download-streamer"

const actorUserId = randomUUID()
const sessionId = randomUUID()
const companyId = randomUUID()
const fileId = randomUUID()
const attemptId = randomUUID()

const context: Extract<AccessContext, { kind: "company" }> = {
  kind: "company",
  userId: actorUserId,
  sessionId,
  authenticatedAt: Date.now(),
  companyId,
  membershipId: randomUUID(),
  role: "company_admin",
  modules: [],
  profile: {
    displayName: "Admin",
    email: "admin@example.com",
    preferredTheme: "dark",
    version: 1,
  },
}

afterEach(() => vi.useRealTimers())

function fixture(overrides: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode("webp seguro")
  const authorization = {
    fileId,
    companyId,
    purpose: "profile_avatar" as const,
    ownerUserId: actorUserId,
    bucket: "axsys-private" as const,
    objectPath: `${companyId}/profile_avatar/${fileId}.webp`,
    mimeType: "image/webp",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    originalName: "avatar.webp",
    attemptId,
    completionNonce: "n".repeat(43),
    ...overrides,
  }
  const repository = {
    authorizeImageDownload: vi.fn().mockResolvedValue(authorization),
    completeDownloadAudit: vi.fn().mockResolvedValue(undefined),
  }
  const storage = {
    downloadPrivate: vi.fn().mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
    ),
  }
  return { bytes, repository, storage }
}

describe("authorized file download", () => {
  it("rejects branding download for a member outside settings modules", async () => {
    const deps = fixture({
      purpose: "company_letterhead",
      ownerUserId: null,
      objectPath: `${companyId}/company_letterhead/${fileId}.webp`,
    })
    const certificatesOnly = {
      ...context,
      role: "member" as const,
      modules: ["certificates"] as const,
    }

    await expect(createAuthorizedDownload(deps, {
      context: certificatesOnly,
      fileId,
      correlationId: randomUUID(),
    })).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
    expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
  })

  it("derives authorization from actor/session and never returns a Storage URL", async () => {
    const deps = fixture()

    const response = await createAuthorizedDownload(deps, {
      context,
      fileId,
      correlationId: randomUUID(),
    })
    await response.arrayBuffer()

    expect(deps.repository.authorizeImageDownload).toHaveBeenCalledWith({
      actorUserId,
      sessionId,
      fileId,
      correlationId: expect.any(String),
      signal: expect.any(AbortSignal),
    })
    expect(deps.storage.downloadPrivate).toHaveBeenCalledWith(
      `${companyId}/profile_avatar/${fileId}.webp`,
      expect.any(AbortSignal),
    )
    expect(deps.repository.completeDownloadAudit).toHaveBeenCalledWith({
      attemptId,
      completionNonce: "n".repeat(43),
      outcome: "completed",
      byteClass: "under_1_mib",
      signal: expect.any(AbortSignal),
    })
    expect(response.headers.has("location")).toBe(false)
  })

  it("rejects cross-tenant or malformed repository output before Storage", async () => {
    const deps = fixture({ companyId: randomUUID() })

    await expect(
      createAuthorizedDownload(deps, {
        context,
        fileId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
    expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
  })

  it("rejects another member avatar inside the same tenant", async () => {
    const deps = fixture({ ownerUserId: randomUUID() })
    const memberContext = { ...context, role: "member" as const }

    await expect(
      createAuthorizedDownload(deps, {
        context: memberContext,
        fileId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
    expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
  })

  it("aborts a stalled authorization before opening Storage", async () => {
    vi.useFakeTimers()
    const deps = fixture()
    let observedSignal: AbortSignal | undefined
    deps.repository.authorizeImageDownload.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        observedSignal = signal
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        )
      },
    )
    const pending = createAuthorizedDownload(deps, {
      context,
      fileId,
      correlationId: randomUUID(),
    })
    const rejection = expect(pending).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
      status: 404,
    })

    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(observedSignal?.aborted).toBe(true)
    expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
  })

  it("closes the audit attempt when Storage cannot be opened", async () => {
    const deps = fixture()
    deps.storage.downloadPrivate.mockRejectedValue(
      new Error("private bucket and path details"),
    )

    await expect(
      createAuthorizedDownload(deps, {
        context,
        fileId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
    expect(deps.repository.completeDownloadAudit).toHaveBeenCalledWith({
      attemptId,
      completionNonce: "n".repeat(43),
      outcome: "stream_failed",
      byteClass: "under_1_mib",
      signal: expect.any(AbortSignal),
    })
  })

  it("normalizes and audits a resolved but unusable Storage stream", async () => {
    const deps = fixture()
    const lockedSource = new ReadableStream<Uint8Array>()
    const existingReader = lockedSource.getReader()
    deps.storage.downloadPrivate.mockResolvedValue(lockedSource)

    await expect(
      createAuthorizedDownload(deps, {
        context,
        fileId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
    expect(deps.repository.completeDownloadAudit).toHaveBeenCalledWith({
      attemptId,
      completionNonce: "n".repeat(43),
      outcome: "stream_failed",
      byteClass: "under_1_mib",
      signal: expect.any(AbortSignal),
    })
    existingReader.releaseLock()
  })

  it("rejects empty or oversized image metadata before Storage", async () => {
    for (const byteSize of [0, 5 * 1024 * 1024 + 1]) {
      const deps = fixture({ byteSize })
      await expect(
        createAuthorizedDownload(deps, {
          context,
          fileId,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
      expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
    }
  })

  it("rejects before opening Storage when verification capacity is full", async () => {
    const leases = Array.from({ length: 4 }, () => acquireDownloadCapacity())
    const deps = fixture()
    try {
      await expect(
        createAuthorizedDownload(deps, {
          context,
          fileId,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 })
      expect(deps.storage.downloadPrivate).not.toHaveBeenCalled()
      expect(deps.repository.completeDownloadAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "stream_failed" }),
      )
    } finally {
      for (const lease of leases) lease()
    }
  })
})
