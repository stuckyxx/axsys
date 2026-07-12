import { Buffer } from "node:buffer"
import { createServer, type Server, type Socket } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getClamAvScanner } from "@/modules/files/server/clamav-client"
import { TEST_FILE_SERVICE_ENV } from "../../helpers/file-service-env"

const HOST = "127.0.0.1"

function expectedInstreamFrame(buffer: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from("zINSTREAM\0", "ascii")]
  for (let offset = 0; offset < buffer.byteLength; offset += 64 * 1024) {
    const chunk = buffer.subarray(offset, offset + 64 * 1024)
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(chunk.byteLength)
    parts.push(length, chunk)
  }
  parts.push(Buffer.alloc(4))
  return Buffer.concat(parts)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, HOST, () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("ClamAV test server did not expose a TCP port")
  }
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function scanWithServer(input: {
  bytes: Buffer
  response?: Buffer
  closeWithoutResponse?: boolean
}): Promise<{ frame: Buffer; result: "clean" | "infected" }> {
  let resolveFrame!: (frame: Buffer) => void
  const receivedFrame = new Promise<Buffer>((resolve) => {
    resolveFrame = resolve
  })
  const server = createServer((socket) => {
    const received: Buffer[] = []
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk)
      const frame = Buffer.concat(received)
      if (!frame.subarray(-4).equals(Buffer.alloc(4))) return

      resolveFrame(frame)
      if (input.closeWithoutResponse) socket.destroy()
      else socket.end(input.response ?? Buffer.from("stream: OK\0", "ascii"))
    })
  })
  const port = await listen(server)
  vi.stubEnv("CLAMAV_PORT", String(port))

  try {
    const result = await getClamAvScanner().scan(input.bytes)
    return { frame: await receivedFrame, result }
  } finally {
    await close(server)
  }
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"a".repeat(32)}`)
  vi.stubEnv(
    "BFF_DATABASE_URL",
    "postgresql://axsys_bff:local@127.0.0.1:54322/postgres",
  )
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000")
  vi.stubEnv("CSRF_SECRET", "c".repeat(32))
  vi.stubEnv("SECURITY_HASH_PEPPER", "p".repeat(32))
  for (const [name, value] of Object.entries(TEST_FILE_SERVICE_ENV)) {
    vi.stubEnv(name, value)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("getClamAvScanner", () => {
  it("sends exact INSTREAM frames with 64 KiB chunks", async () => {
    const bytes = Buffer.alloc(64 * 1024 + 7, 0x5a)
    const { frame, result } = await scanWithServer({ bytes })

    expect(result).toBe("clean")
    expect(frame).toEqual(expectedInstreamFrame(bytes))
  })

  it("maps a FOUND response to infected", async () => {
    await expect(
      scanWithServer({
        bytes: Buffer.from("EICAR fixture marker", "utf8"),
        response: Buffer.from("stream: Eicar-Signature FOUND\0", "ascii"),
      }),
    ).resolves.toMatchObject({ result: "infected" })
  })

  it("fails closed on an unknown scanner response", async () => {
    await expect(
      scanWithServer({
        bytes: Buffer.from("unknown response", "utf8"),
        response: Buffer.from("stream: ERROR\0", "ascii"),
      }),
    ).rejects.toMatchObject({ code: "FILE_SCANNER_UNAVAILABLE" })
  })

  it("fails closed when the scanner closes before a verdict", async () => {
    await expect(
      scanWithServer({
        bytes: Buffer.from("closed response", "utf8"),
        closeWithoutResponse: true,
      }),
    ).rejects.toMatchObject({ code: "FILE_SCANNER_UNAVAILABLE" })
  })

  it("sets and enforces a 15 second total scan timeout", async () => {
    let confirmConnection!: () => void
    let acceptedSocket: Socket | undefined
    const connected = new Promise<void>((resolve) => {
      confirmConnection = resolve
    })
    const server = createServer((socket) => {
      acceptedSocket = socket
      confirmConnection()
    })
    const port = await listen(server)
    vi.stubEnv("CLAMAV_PORT", String(port))
    vi.useFakeTimers()

    try {
      const result = expect(
        getClamAvScanner().scan(Buffer.from("timeout", "utf8")),
      ).rejects.toMatchObject({ code: "FILE_SCANNER_UNAVAILABLE" })
      await connected
      await vi.advanceTimersByTimeAsync(14_999)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await result
    } finally {
      vi.useRealTimers()
      acceptedSocket?.destroy()
      await close(server)
    }
  })
})
