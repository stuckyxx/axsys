import "server-only"

import { createHash } from "node:crypto"

export type DownloadAuditOutcome =
  | "completed"
  | "aborted"
  | "integrity_failed"
  | "stream_failed"

export type DownloadByteClass =
  | "empty"
  | "under_1_mib"
  | "under_10_mib"
  | "at_least_10_mib"

export type AuditedDownloadInput = Readonly<{
  source: ReadableStream<Uint8Array>
  expectedBytes: number
  expectedSha256: string
  mimeType: string
  originalName: string
  capacityLease?: () => void
  complete(
    input: {
      outcome: DownloadAuditOutcome
      byteClass: DownloadByteClass
    },
    signal: AbortSignal,
  ): Promise<void>
}>

const SHA256_HEX = /^[0-9a-f]{64}$/u
const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u
const DOWNLOAD_ERROR = "Download unavailable"
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
const MAX_CONCURRENT_VERIFICATIONS = 4
const VERIFICATION_SLOT_LEASE_MS = 120_000
const AUDIT_COMPLETION_TIMEOUT_MS = 10_000
const STORAGE_CANCEL_TIMEOUT_MS = 5_000
let activeVerifications = 0

export function acquireDownloadCapacity(): () => void {
  if (activeVerifications >= MAX_CONCURRENT_VERIFICATIONS) {
    throw new Error(DOWNLOAD_ERROR)
  }
  activeVerifications += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeVerifications -= 1
  }
}

export function classifyDownloadBytes(byteSize: number): DownloadByteClass {
  if (byteSize === 0) return "empty"
  if (byteSize < 1024 * 1024) return "under_1_mib"
  if (byteSize < 10 * 1024 * 1024) return "under_10_mib"
  return "at_least_10_mib"
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
        timeout = setTimeout(
          () => {
            onTimeout?.()
            reject(new Error(DOWNLOAD_ERROR))
          },
          timeoutMs,
        )
        timeout.unref()
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\uD800-\uDFFF]/gu, "_")
    .replace(/[\u0000-\u001f\u007f/\\"]/gu, "_")
    .trim()
  const truncated = Array.from(normalized).slice(0, 180).join("")
  return truncated.length > 0 ? truncated : "arquivo"
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function contentDisposition(filename: string): string {
  const safe = safeFilename(filename)
  const ascii = safe.replace(/[^\u0020-\u007e]/gu, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(safe)}`
}

function assertContract(input: AuditedDownloadInput): void {
  if (
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes < 0 ||
    input.expectedBytes > MAX_DOWNLOAD_BYTES ||
    !SHA256_HEX.test(input.expectedSha256)
  ) {
    throw new Error(DOWNLOAD_ERROR)
  }
}

export function createAuditedDownloadResponse(
  input: AuditedDownloadInput,
): Response {
  assertContract(input)
  const reader = input.source.getReader()
  const byteClass = classifyDownloadBytes(input.expectedBytes)
  let settled = false
  let verifiedChunks: readonly Uint8Array[] | null = null
  let nextChunk = 0
  let releaseVerificationSlot: (() => void) | null =
    input.capacityLease ?? null
  let verificationSlotLease: ReturnType<typeof setTimeout> | null = null
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null
  let consumerCancelled = false
  let responseErrored = false
  let leaseExpired = false

  function errorResponse(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (consumerCancelled || responseErrored) return
    responseErrored = true
    try {
      controller.error(new Error(DOWNLOAD_ERROR))
    } catch {
      // A concurrent cancellation or expiry already closed the response.
    }
  }

  function releaseSlot(): void {
    if (verificationSlotLease !== null) {
      clearTimeout(verificationSlotLease)
      verificationSlotLease = null
    }
    releaseVerificationSlot?.()
    releaseVerificationSlot = null
  }

  async function settle(outcome: DownloadAuditOutcome): Promise<void> {
    if (settled) return
    settled = true
    const auditAbort = new AbortController()
    await withTimeout(
      input.complete({ outcome, byteClass }, auditAbort.signal),
      AUDIT_COMPLETION_TIMEOUT_MS,
      () => auditAbort.abort(),
    )
  }

  function armSlotLease(): void {
    if (verificationSlotLease !== null) return
    verificationSlotLease = setTimeout(() => {
      leaseExpired = true
      verifiedChunks = []
      releaseSlot()
      void Promise.allSettled([
        withTimeout(reader.cancel(), STORAGE_CANCEL_TIMEOUT_MS),
        settle("aborted"),
      ])
      if (streamController !== null) errorResponse(streamController)
    }, VERIFICATION_SLOT_LEASE_MS)
    verificationSlotLease.unref()
  }

  async function spoolAndVerify(): Promise<readonly Uint8Array[]> {
    if (leaseExpired) throw new Error(DOWNLOAD_ERROR)
    releaseVerificationSlot ??= acquireDownloadCapacity()
    armSlotLease()
    const hash = createHash("sha256")
    const chunks: Uint8Array[] = []
    let byteSize = 0
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) break
        byteSize += result.value.byteLength
        if (byteSize > input.expectedBytes) {
          await Promise.allSettled([
            reader.cancel(),
            settle("integrity_failed"),
          ])
          throw new Error(DOWNLOAD_ERROR)
        }
        const immutableChunk = result.value.slice()
        chunks.push(immutableChunk)
        hash.update(immutableChunk)
      }
    } catch {
      try {
        if (!settled) await settle("stream_failed")
      } finally {
        releaseSlot()
      }
      throw new Error(DOWNLOAD_ERROR)
    }

    if (
      byteSize !== input.expectedBytes ||
      hash.digest("hex") !== input.expectedSha256
    ) {
      try {
        await settle("integrity_failed")
      } finally {
        releaseSlot()
      }
      throw new Error(DOWNLOAD_ERROR)
    }
    return chunks
  }

  if (releaseVerificationSlot !== null) armSlotLease()

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      streamController = controller
      try {
        verifiedChunks ??= await spoolAndVerify()
        const chunk = verifiedChunks[nextChunk]
        if (chunk !== undefined) {
          nextChunk += 1
          controller.enqueue(chunk)
          return
        }
        verifiedChunks = []
        releaseSlot()
        await settle("completed")
        controller.close()
      } catch {
        void Promise.allSettled([
          withTimeout(reader.cancel(), STORAGE_CANCEL_TIMEOUT_MS),
          settle("stream_failed"),
        ])
        errorResponse(controller)
      }
    },

    async cancel(reason) {
      consumerCancelled = true
      const storageCancellation = withTimeout(
        reader.cancel(reason),
        STORAGE_CANCEL_TIMEOUT_MS,
      ).catch(() => undefined)
      const auditCompletion = settle("aborted")
      verifiedChunks = []
      releaseSlot()
      await Promise.allSettled([storageCancellation, auditCompletion])
    },
  })

  const mimeType = SAFE_MIME.test(input.mimeType)
    ? input.mimeType
    : "application/octet-stream"
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": contentDisposition(input.originalName),
      "Content-Length": String(input.expectedBytes),
      "Content-Security-Policy": "sandbox",
      "Content-Type": mimeType,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
