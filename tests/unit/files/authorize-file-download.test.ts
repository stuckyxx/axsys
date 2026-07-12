import { createHash, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import { createAuthorizedDownload } from "@/modules/files/server/authorize-file-download"

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

function fixture(overrides: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode("webp seguro")
  const authorization = {
    fileId,
    companyId,
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
    })
    expect(deps.storage.downloadPrivate).toHaveBeenCalledWith(
      `${companyId}/profile_avatar/${fileId}.webp`,
    )
    expect(deps.repository.completeDownloadAudit).toHaveBeenCalledWith({
      attemptId,
      completionNonce: "n".repeat(43),
      outcome: "completed",
      byteClass: "under_1_mib",
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
})
