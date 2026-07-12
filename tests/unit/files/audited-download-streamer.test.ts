import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createAuditedDownloadResponse } from "@/modules/files/server/audited-download-streamer"

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function sourceOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk === undefined) controller.close()
      else controller.enqueue(chunk)
    },
  })
}

describe("audited download streamer", () => {
  it("streams verified bytes with hardened non-cacheable headers", async () => {
    const bytes = new TextEncoder().encode("arquivo seguro")
    const complete = vi.fn().mockResolvedValue(undefined)
    const response = createAuditedDownloadResponse({
      source: sourceOf(bytes),
      expectedBytes: bytes.byteLength,
      expectedSha256: sha256(bytes),
      mimeType: "image/webp",
      originalName: 'marca\r\nX-Evil: "sim"\ud800.webp',
      complete,
    })

    await expect(response.arrayBuffer()).resolves.toEqual(bytes.buffer)
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith({
      outcome: "completed",
      byteClass: "under_1_mib",
    })
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("content-security-policy")).toBe("sandbox")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-disposition")).not.toMatch(/[\r\n]/u)
    expect(response.headers.get("content-disposition")).toContain("attachment;")
  })

  it("fails closed and audits integrity when size or hash diverges", async () => {
    const bytes = new TextEncoder().encode("alterado")
    const complete = vi.fn().mockResolvedValue(undefined)
    const response = createAuditedDownloadResponse({
      source: sourceOf(bytes),
      expectedBytes: bytes.byteLength,
      expectedSha256: "0".repeat(64),
      mimeType: "image/webp",
      originalName: "imagem.webp",
      complete,
    })

    const firstRead = response.body!.getReader().read()
    await expect(firstRead).rejects.toThrow("Download unavailable")
    expect(complete).toHaveBeenCalledWith({
      outcome: "integrity_failed",
      byteClass: "under_1_mib",
    })
  })

  it("keeps RFC 5987 filenames valid at Unicode truncation boundaries", () => {
    const bytes = new Uint8Array()
    const response = createAuditedDownloadResponse({
      source: sourceOf(bytes),
      expectedBytes: 0,
      expectedSha256: sha256(bytes),
      mimeType: "image/webp",
      originalName: `'()*${"a".repeat(175)}😀.webp`,
      complete: vi.fn().mockResolvedValue(undefined),
    })

    const disposition = response.headers.get("content-disposition")!
    expect(disposition).toContain("filename*=UTF-8''")
    expect(disposition).toContain("%F0%9F%98%80")
    const extendedValue = disposition.split("filename*=UTF-8''")[1]
    expect(extendedValue).not.toMatch(/['()]/u)
    expect(extendedValue).toContain("%27%28%29%2A")
  })

  it("audits cancellation once when the client aborts", async () => {
    const first = new Uint8Array(64)
    const second = new Uint8Array(64)
    const complete = vi.fn().mockResolvedValue(undefined)
    const response = createAuditedDownloadResponse({
      source: sourceOf(first, second),
      expectedBytes: 128,
      expectedSha256: sha256(new Uint8Array(128)),
      mimeType: "application/pdf",
      originalName: "documento.pdf",
      complete,
    })
    const reader = response.body!.getReader()

    await reader.read()
    await reader.cancel()

    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith({
      outcome: "aborted",
      byteClass: "under_1_mib",
    })
  })

  it("audits source failures without exposing the underlying error", async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const source = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("storage details and private path")
      },
    })
    const response = createAuditedDownloadResponse({
      source,
      expectedBytes: 1,
      expectedSha256: "0".repeat(64),
      mimeType: "application/octet-stream",
      originalName: "arquivo.bin",
      complete,
    })

    await expect(response.arrayBuffer()).rejects.toThrow("Download unavailable")
    expect(complete).toHaveBeenCalledWith({
      outcome: "stream_failed",
      byteClass: "under_1_mib",
    })
  })

  it("rejects an oversized contract before acquiring the source", () => {
    const source = sourceOf(new Uint8Array())
    expect(() =>
      createAuditedDownloadResponse({
        source,
        expectedBytes: 25 * 1024 * 1024 + 1,
        expectedSha256: sha256(new Uint8Array()),
        mimeType: "application/octet-stream",
        originalName: "arquivo.bin",
        complete: vi.fn().mockResolvedValue(undefined),
      }),
    ).toThrow("Download unavailable")
    expect(source.locked).toBe(false)
  })

  it("cancels Storage promptly even while the audit writer is pending", async () => {
    let releaseAudit!: () => void
    const auditPending = new Promise<void>((resolve) => {
      releaseAudit = resolve
    })
    const storageCancelled = vi.fn()
    let emitted = false
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          emitted = true
          controller.enqueue(new Uint8Array([1]))
          return
        }
        return new Promise<void>(() => undefined)
      },
      cancel: storageCancelled,
    })
    const response = createAuditedDownloadResponse({
      source,
      expectedBytes: 2,
      expectedSha256: "0".repeat(64),
      mimeType: "application/octet-stream",
      originalName: "arquivo.bin",
      complete: () => auditPending,
    })
    const reader = response.body!.getReader()
    void reader.read().catch(() => undefined)

    const cancellation = reader.cancel()
    await vi.waitFor(() => expect(storageCancelled).toHaveBeenCalledOnce())
    releaseAudit()
    await cancellation
  })

  it("releases verification capacity when source and audit both fail", async () => {
    for (let index = 0; index < 4; index += 1) {
      const failing = createAuditedDownloadResponse({
        source: new ReadableStream<Uint8Array>({
          pull() {
            throw new Error("storage failed")
          },
        }),
        expectedBytes: 1,
        expectedSha256: "0".repeat(64),
        mimeType: "application/octet-stream",
        originalName: "arquivo.bin",
        complete: vi.fn().mockRejectedValue(new Error("audit failed")),
      })
      await expect(failing.arrayBuffer()).rejects.toThrow(
        "Download unavailable",
      )
    }

    const bytes = new Uint8Array([7])
    const healthy = createAuditedDownloadResponse({
      source: sourceOf(bytes),
      expectedBytes: 1,
      expectedSha256: sha256(bytes),
      mimeType: "application/octet-stream",
      originalName: "arquivo.bin",
      complete: vi.fn().mockResolvedValue(undefined),
    })
    await expect(healthy.arrayBuffer()).resolves.toEqual(bytes.buffer)
  })
})
