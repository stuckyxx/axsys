import "server-only"

import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type { EnabledImagePurpose } from "@/modules/files/domain/file-types"
import {
  acquireDownloadCapacity,
  classifyDownloadBytes,
  createAuditedDownloadResponse,
  type DownloadAuditOutcome,
  type DownloadByteClass,
} from "@/modules/files/server/audited-download-streamer"

type CompanyAccessContext = Extract<AccessContext, { kind: "company" }>

export type ImageDownloadAuthorization = Readonly<{
  fileId: string
  companyId: string
  purpose: EnabledImagePurpose
  ownerUserId: string | null
  bucket: "axsys-private"
  objectPath: string
  mimeType: string
  byteSize: number
  sha256: string
  originalName: string
  attemptId: string
  completionNonce: string
}>

export type AuthorizedDownloadDependencies = Readonly<{
  repository: Readonly<{
    authorizeImageDownload(input: {
      actorUserId: string
      sessionId: string
      fileId: string
      correlationId: string
    }): Promise<ImageDownloadAuthorization>
    completeDownloadAudit(input: {
      attemptId: string
      completionNonce: string
      outcome: DownloadAuditOutcome
      byteClass: DownloadByteClass
      signal: AbortSignal
    }): Promise<void>
  }>
  storage: Readonly<{
    downloadPrivate(
      path: string,
      signal: AbortSignal,
    ): Promise<ReadableStream<Uint8Array>>
  }>
}>

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256_HEX = /^[0-9a-f]{64}$/u
const NONCE = /^[A-Za-z0-9_-]{43}$/u
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024
const STORAGE_OPEN_TIMEOUT_MS = 15_000
const AUDIT_WRITE_TIMEOUT_MS = 10_000
const IMAGE_PURPOSES = new Set<EnabledImagePurpose>([
  "profile_avatar",
  "company_letterhead",
  "company_signature",
])

function notFound(): ApiError {
  return new ApiError("FILE_NOT_FOUND", 404, "Arquivo não encontrado.")
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.()
          reject(new Error("Download unavailable"))
        }, timeoutMs)
        timeout.unref()
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

function hasValidAuthorization(
  value: ImageDownloadAuthorization,
  context: CompanyAccessContext,
  fileId: string,
): boolean {
  const segments = value.objectPath.split("/")
  const purpose = segments[1] as EnabledImagePurpose | undefined
  const hasPurposeAccess =
    value.purpose === "profile_avatar"
      ? value.ownerUserId !== null &&
        (value.ownerUserId === context.userId || context.role === "company_admin")
      : value.ownerUserId === null
  return (
    value.fileId === fileId &&
    value.companyId === context.companyId &&
    value.bucket === "axsys-private" &&
    segments.length === 3 &&
    segments[0] === context.companyId &&
    purpose !== undefined &&
    IMAGE_PURPOSES.has(purpose) &&
    purpose === value.purpose &&
    hasPurposeAccess &&
    segments[2] === `${fileId}.webp` &&
    value.mimeType === "image/webp" &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    value.byteSize <= MAX_IMAGE_FILE_BYTES &&
    SHA256_HEX.test(value.sha256) &&
    UUID.test(value.attemptId) &&
    NONCE.test(value.completionNonce) &&
    value.originalName.length > 0 &&
    value.originalName.length <= 255
  )
}

export async function createAuthorizedDownload(
  deps: AuthorizedDownloadDependencies,
  input: Readonly<{
    context: CompanyAccessContext
    fileId: string
    correlationId: string
  }>,
): Promise<Response> {
  if (!UUID.test(input.fileId) || !UUID.test(input.correlationId)) {
    throw notFound()
  }

  let authorization: ImageDownloadAuthorization
  try {
    authorization = await deps.repository.authorizeImageDownload({
      actorUserId: input.context.userId,
      sessionId: input.context.sessionId,
      fileId: input.fileId,
      correlationId: input.correlationId,
    })
  } catch {
    throw notFound()
  }
  if (!hasValidAuthorization(authorization, input.context, input.fileId)) {
    throw notFound()
  }

  const complete = (
    result: {
      outcome: DownloadAuditOutcome
      byteClass: DownloadByteClass
    },
    signal: AbortSignal,
  ) =>
    deps.repository.completeDownloadAudit({
      attemptId: authorization.attemptId,
      completionNonce: authorization.completionNonce,
      ...result,
      signal,
    })

  const completeSafely = (result: {
    outcome: DownloadAuditOutcome
    byteClass: DownloadByteClass
  }) => {
    const auditAbort = new AbortController()
    void withTimeout(
      complete(result, auditAbort.signal),
      AUDIT_WRITE_TIMEOUT_MS,
      () => auditAbort.abort(),
    ).catch(() => undefined)
  }

  let capacityLease: (() => void) | null = null
  try {
    capacityLease = acquireDownloadCapacity()
  } catch {
    completeSafely({
      outcome: "stream_failed",
      byteClass: classifyDownloadBytes(authorization.byteSize),
    })
    throw notFound()
  }

  let source: ReadableStream<Uint8Array>
  const storageAbort = new AbortController()
  try {
    source = await withTimeout(
      deps.storage.downloadPrivate(
        authorization.objectPath,
        storageAbort.signal,
      ),
      STORAGE_OPEN_TIMEOUT_MS,
      () => storageAbort.abort(),
    )
  } catch {
    capacityLease()
    capacityLease = null
    storageAbort.abort()
    completeSafely({
      outcome: "stream_failed",
      byteClass: classifyDownloadBytes(authorization.byteSize),
    })
    throw notFound()
  }

  try {
    return createAuditedDownloadResponse({
      source,
      expectedBytes: authorization.byteSize,
      expectedSha256: authorization.sha256,
      mimeType: authorization.mimeType,
      originalName: authorization.originalName,
      complete,
      capacityLease,
    })
  } catch {
    capacityLease()
    capacityLease = null
    void source.cancel().catch(() => undefined)
    completeSafely({
      outcome: "stream_failed",
      byteClass: classifyDownloadBytes(authorization.byteSize),
    })
    throw notFound()
  }
}
