import "server-only"

import { createHash } from "node:crypto"

export async function readVerifiedPrivateBuffer(input: Readonly<{
  source: ReadableStream<Uint8Array>
  expectedBytes: number
  expectedSha256: string
  maxBytes: number
}>): Promise<Buffer> {
  const reader = input.source.getReader()
  const chunks: Buffer[] = []
  const hash = createHash("sha256")
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > input.expectedBytes || size > input.maxBytes) {
        await reader.cancel()
        throw new Error("Private object integrity mismatch")
      }
      const chunk = Buffer.from(result.value)
      chunks.push(chunk)
      hash.update(chunk)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new Error("Private object unavailable")
  }
  if (size !== input.expectedBytes || hash.digest("hex") !== input.expectedSha256) {
    throw new Error("Private object integrity mismatch")
  }
  return Buffer.concat(chunks, size)
}
