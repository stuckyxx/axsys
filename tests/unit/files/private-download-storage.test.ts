import { describe, expect, it, vi } from "vitest"

import { createPrivateDownloadStorage } from "@/modules/files/server/file-storage"

describe("private download Storage adapter", () => {
  it("opens the exact authenticated object without redirects or caching", async () => {
    const body = new ReadableStream<Uint8Array>()
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    )
    const storage = createPrivateDownloadStorage({
      baseUrl: "http://127.0.0.1:54321",
      secretKey: "test-secret-key",
      fetchImplementation,
    })
    const signal = new AbortController().signal

    await expect(
      storage.downloadPrivate("tenant/profile_avatar/file.webp", signal),
    ).resolves.toBe(body)
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/storage/v1/object/authenticated/axsys-private/tenant/profile_avatar/file.webp",
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        signal,
        headers: {
          apikey: "test-secret-key",
          Authorization: "Bearer test-secret-key",
        },
      }),
    )
  })

  it("rejects path traversal and normalizes Storage failures", async () => {
    const fetchImplementation = vi.fn()
    const storage = createPrivateDownloadStorage({
      baseUrl: "http://127.0.0.1:54321",
      secretKey: "test-secret-key",
      fetchImplementation,
    })

    await expect(
      storage.downloadPrivate("tenant/../secret", new AbortController().signal),
    ).rejects.toThrow("Private download unavailable")
    expect(fetchImplementation).not.toHaveBeenCalled()

    fetchImplementation.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(
      storage.downloadPrivate(
        "tenant/profile_avatar/missing.webp",
        new AbortController().signal,
      ),
    ).rejects.toThrow("Private download unavailable")
  })
})
