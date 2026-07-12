import { Buffer } from "node:buffer"

import sharp from "sharp"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import type { FileObject } from "@/modules/files/domain/file-types"
import {
  finalizeUploadIntent,
  type FileFinalizationDependencies,
  type FinalizableUploadIntent,
} from "@/modules/files/server/finalize-upload-intent"
import type { AccessContext } from "@/modules/auth/domain/access-context"

const COMPANY_ID = "30000000-0000-4000-8000-000000000001"
const USER_ID = "20000000-0000-4000-8000-000000000001"
const INTENT_ID = "11111111-1111-4111-8111-111111111111"
const RANDOM_ID = "33333333-3333-4333-8333-333333333333"
const FILE_ID = "44444444-4444-4444-8444-444444444444"
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-07-11T12:00:00.000Z")

const context = Object.freeze({
  kind: "company",
  userId: USER_ID,
  sessionId: "90000000-0000-4000-8000-000000000001",
  authenticatedAt: 1_783_771_200,
  companyId: COMPANY_ID,
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "company_admin",
  modules: ["administrative"],
  profile: {
    displayName: "Admin",
    email: "admin@example.test",
    preferredTheme: "dark",
    version: 1,
  },
} as const satisfies Extract<AccessContext, { kind: "company" }>)

let jpegBytes: Buffer
let pngBytes: Buffer
let webpBytes: Buffer

beforeAll(async () => {
  const source = sharp({
    create: {
      width: 16,
      height: 12,
      channels: 3,
      background: "#2563eb",
    },
  })
  ;[jpegBytes, pngBytes, webpBytes] = await Promise.all([
    source.clone().jpeg().toBuffer(),
    source.clone().png().toBuffer(),
    source.clone().webp().toBuffer(),
  ])
})

function intent(
  overrides: Partial<FinalizableUploadIntent> = {},
): FinalizableUploadIntent {
  return Object.freeze({
    id: INTENT_ID,
    companyId: COMPANY_ID,
    actorUserId: USER_ID,
    purpose: "company_letterhead",
    quarantinePath: `${COMPANY_ID}/${USER_ID}/${INTENT_ID}/${RANDOM_ID}`,
    declaredName: "letterhead.png",
    declaredMime: "image/png",
    declaredSize: pngBytes.byteLength,
    cleanupNotBefore: "2026-07-12T14:15:00.000Z",
    ...overrides,
  })
}

function readyFile(overrides: Partial<FileObject> = {}): FileObject {
  return Object.freeze({
    id: FILE_ID,
    companyId: COMPANY_ID,
    ownerUserId: null,
    purpose: "company_letterhead",
    bucket: "axsys-private",
    objectPath: `${COMPANY_ID}/company_letterhead/${FILE_ID}.webp`,
    originalName: "letterhead.png",
    detectedMime: "image/webp",
    byteSize: webpBytes.byteLength,
    sha256: "a".repeat(64),
    scanStatus: "clean",
    status: "ready",
    createdBy: USER_ID,
    createdAt: NOW.toISOString(),
    promotedAt: NOW.toISOString(),
    ...overrides,
  })
}

function dependencies(): FileFinalizationDependencies {
  return {
    scanner: { scan: vi.fn().mockResolvedValue("clean") },
    storage: {
      downloadQuarantine: vi.fn().mockResolvedValue(pngBytes),
      uploadPrivate: vi.fn().mockResolvedValue(undefined),
      removePrivate: vi.fn().mockResolvedValue(undefined),
      removeQuarantine: vi.fn().mockResolvedValue(undefined),
    },
    repository: {
      beginFinalization: vi
        .fn()
        .mockResolvedValue({ kind: "finalizing", intent: intent() }),
      commitReadyFile: vi.fn().mockResolvedValue(readyFile()),
      markCleanupRequired: vi.fn().mockResolvedValue(undefined),
      rejectUpload: vi.fn().mockResolvedValue(undefined),
      releaseForRetry: vi.fn().mockResolvedValue(undefined),
    },
    transformer: { toWebp: vi.fn().mockResolvedValue(webpBytes) },
    clock: () => NOW,
    uuid: () => FILE_ID,
  }
}

const input = Object.freeze({ context, intentId: INTENT_ID, correlationId: CORRELATION_ID })

describe("finalizeUploadIntent", () => {
  let deps: FileFinalizationDependencies

  beforeEach(() => {
    deps = dependencies()
  })

  it("scans, reencodes, rescans and promotes in the secure order", async () => {
    const result = await finalizeUploadIntent(deps, input)
    const scan = vi.mocked(deps.scanner.scan)
    const transform = vi.mocked(deps.transformer.toWebp)
    const upload = vi.mocked(deps.storage.uploadPrivate)
    const commit = vi.mocked(deps.repository.commitReadyFile)

    expect(result).toEqual(readyFile())
    expect(scan).toHaveBeenNthCalledWith(1, pngBytes)
    expect(transform).toHaveBeenCalledWith(pngBytes, "company_letterhead")
    expect(scan).toHaveBeenNthCalledWith(2, webpBytes)
    expect(scan.mock.invocationCallOrder[0]).toBeLessThan(
      transform.mock.invocationCallOrder[0]!,
    )
    expect(transform.mock.invocationCallOrder[0]).toBeLessThan(
      scan.mock.invocationCallOrder[1]!,
    )
    expect(scan.mock.invocationCallOrder[1]).toBeLessThan(
      upload.mock.invocationCallOrder[0]!,
    )
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0]!,
    )
    expect(upload).toHaveBeenCalledWith({
      path: `${COMPANY_ID}/company_letterhead/${FILE_ID}.webp`,
      bytes: webpBytes,
      contentType: "image/webp",
      upsert: false,
    })
    expect(deps.storage.removeQuarantine).not.toHaveBeenCalled()
  })

  it("returns an already committed file without touching Storage", async () => {
    vi.mocked(deps.repository.beginFinalization).mockResolvedValue({
      kind: "ready",
      file: readyFile(),
    })

    await expect(finalizeUploadIntent(deps, input)).resolves.toEqual(readyFile())
    expect(deps.storage.downloadQuarantine).not.toHaveBeenCalled()
    expect(deps.scanner.scan).not.toHaveBeenCalled()
    expect(deps.repository.commitReadyFile).not.toHaveBeenCalled()
  })

  it("rejects a declared MIME that disagrees with magic bytes", async () => {
    vi.mocked(deps.storage.downloadQuarantine).mockResolvedValue(jpegBytes)
    vi.mocked(deps.repository.beginFinalization).mockResolvedValue({
      kind: "finalizing",
      intent: intent({ declaredSize: jpegBytes.byteLength }),
    })

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_TYPE_MISMATCH",
    })
    expect(deps.repository.rejectUpload).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "FILE_TYPE_MISMATCH" }),
    )
    expect(deps.storage.removeQuarantine).toHaveBeenCalledWith(
      intent().quarantinePath,
    )
    expect(deps.storage.uploadPrivate).not.toHaveBeenCalled()
  })

  it("rejects and deletes quarantine immediately when malware is detected", async () => {
    vi.mocked(deps.scanner.scan).mockResolvedValueOnce("infected")

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_INFECTED",
      status: 400,
    })
    expect(deps.repository.rejectUpload).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "MALWARE_DETECTED" }),
    )
    expect(deps.storage.removeQuarantine).toHaveBeenCalledWith(
      intent().quarantinePath,
    )
    expect(deps.transformer.toWebp).not.toHaveBeenCalled()
    expect(deps.storage.uploadPrivate).not.toHaveBeenCalled()
  })

  it("returns the intent to issued when the scanner is temporarily unavailable", async () => {
    const scannerError = new ApiError(
      "FILE_SCANNER_UNAVAILABLE",
      503,
      "Scanner unavailable",
    )
    vi.mocked(deps.scanner.scan).mockRejectedValueOnce(scannerError)

    await expect(finalizeUploadIntent(deps, input)).rejects.toBe(scannerError)
    expect(deps.repository.releaseForRetry).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "FILE_SCANNER_UNAVAILABLE",
    })
    expect(deps.repository.rejectUpload).not.toHaveBeenCalled()
    expect(deps.storage.removeQuarantine).not.toHaveBeenCalled()
  })

  it("returns the intent to issued when quarantine download is unavailable", async () => {
    vi.mocked(deps.storage.downloadQuarantine).mockRejectedValue(
      new Error("storage unavailable"),
    )

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_STORAGE_UNAVAILABLE",
      status: 503,
    })
    expect(deps.repository.releaseForRetry).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "FILE_QUARANTINE_DOWNLOAD_FAILED",
    })
  })

  it("returns the intent to issued after an unexpected transformation failure", async () => {
    vi.mocked(deps.transformer.toWebp).mockRejectedValue(
      new Error("image worker unavailable"),
    )

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_TRANSFORM_UNAVAILABLE",
      status: 503,
    })
    expect(deps.repository.releaseForRetry).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "FILE_TRANSFORM_UNAVAILABLE",
    })
    expect(deps.repository.rejectUpload).not.toHaveBeenCalled()
  })

  it("rejects transformed bytes that do not satisfy the output policy", async () => {
    vi.mocked(deps.transformer.toWebp).mockResolvedValue(
      Buffer.from("not-a-webp", "utf8"),
    )

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_MAGIC_BYTES_INVALID",
    })
    expect(deps.repository.rejectUpload).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "TRANSFORMED_FILE_INVALID",
    })
    expect(deps.storage.uploadPrivate).not.toHaveBeenCalled()
  })

  it("rejects a transformed image if its second scan is infected", async () => {
    vi.mocked(deps.scanner.scan)
      .mockResolvedValueOnce("clean")
      .mockResolvedValueOnce("infected")

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_INFECTED",
    })
    expect(deps.repository.rejectUpload).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "MALWARE_DETECTED" }),
    )
    expect(deps.storage.uploadPrivate).not.toHaveBeenCalled()
  })

  it("rejects a quarantine object whose size differs from the reservation", async () => {
    vi.mocked(deps.storage.downloadQuarantine).mockResolvedValue(
      Buffer.concat([pngBytes, Buffer.from([0])]),
    )

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_SIZE_MISMATCH",
    })
    expect(deps.repository.rejectUpload).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "FILE_SIZE_MISMATCH" }),
    )
    expect(deps.scanner.scan).not.toHaveBeenCalled()
  })

  it.each([
    { companyId: "30000000-0000-4000-8000-000000000002" },
    { actorUserId: "20000000-0000-4000-8000-000000000002" },
    { quarantinePath: `${COMPANY_ID}/${USER_ID}/${INTENT_ID}/not-a-uuid` },
    { cleanupNotBefore: "2026-07-11T11:59:59.000Z" },
  ])("fails closed for a repository contract violation %#", async (override) => {
    vi.mocked(deps.repository.beginFinalization).mockResolvedValue({
      kind: "finalizing",
      intent: intent(override),
    })

    await expect(finalizeUploadIntent(deps, input)).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
      status: 404,
    })
    expect(deps.storage.downloadQuarantine).not.toHaveBeenCalled()
  })

  it("compensates promoted storage and marks cleanup when DB commit fails", async () => {
    const persistenceError = new Error("database unavailable")
    vi.mocked(deps.repository.commitReadyFile).mockRejectedValue(persistenceError)

    await expect(finalizeUploadIntent(deps, input)).rejects.toBe(persistenceError)
    expect(deps.storage.removePrivate).toHaveBeenCalledWith(
      `${COMPANY_ID}/company_letterhead/${FILE_ID}.webp`,
    )
    expect(deps.repository.markCleanupRequired).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "FILE_METADATA_COMMIT_FAILED",
    })
  })

  it("treats a private upload failure as ambiguous and schedules exact-path cleanup", async () => {
    const uploadError = new Error("storage timeout")
    vi.mocked(deps.storage.uploadPrivate).mockRejectedValue(uploadError)

    await expect(finalizeUploadIntent(deps, input)).rejects.toBe(uploadError)
    expect(deps.storage.removePrivate).toHaveBeenCalledWith(
      `${COMPANY_ID}/company_letterhead/${FILE_ID}.webp`,
    )
    expect(deps.repository.markCleanupRequired).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      sessionId: context.sessionId,
      intentId: INTENT_ID,
      reasonCode: "FILE_PRIVATE_UPLOAD_AMBIGUOUS",
    })
    expect(deps.repository.releaseForRetry).not.toHaveBeenCalled()
  })
})
