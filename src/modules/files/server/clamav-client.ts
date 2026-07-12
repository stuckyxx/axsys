import "server-only"

import { Buffer } from "node:buffer"

import { getServerEnv } from "@/lib/env/server"
import { ApiError } from "@/lib/http/api-error"

const INSTREAM_COMMAND = Buffer.from("zINSTREAM\0", "ascii")
const TERMINATOR = Buffer.alloc(4)
const CHUNK_BYTES = 64 * 1024
const SCAN_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 4 * 1024

export type MalwareScanner = Readonly<{
  scan(buffer: Buffer): Promise<"clean" | "infected">
}>

function scannerUnavailable(): ApiError {
  return new ApiError(
    "FILE_SCANNER_UNAVAILABLE",
    503,
    "A verificação de segurança está temporariamente indisponível.",
  )
}

function parseVerdict(response: Buffer): "clean" | "infected" | null {
  const terminator = response.indexOf(0)
  if (terminator === -1) return null
  if (terminator !== response.byteLength - 1) throw scannerUnavailable()

  const verdict = response.subarray(0, terminator).toString("utf8")
  if (verdict === "stream: OK") return "clean"
  if (/^stream: [^\u0000\r\n]{1,512} FOUND$/u.test(verdict)) return "infected"
  throw scannerUnavailable()
}

export function getClamAvScanner(): MalwareScanner {
  return Object.freeze({
    async scan(buffer: Buffer): Promise<"clean" | "infected"> {
      const env = getServerEnv()
      const { createConnection } = await import("node:net")

      return new Promise<"clean" | "infected">((resolve, reject) => {
        const socket = createConnection({
          host: env.CLAMAV_HOST,
          port: Number(env.CLAMAV_PORT),
        })
        const responseParts: Buffer[] = []
        let responseBytes = 0
        let settled = false

        const timeout = setTimeout(() => {
          fail()
        }, SCAN_TIMEOUT_MS)

        function cleanup(): void {
          clearTimeout(timeout)
          socket.removeAllListeners()
          socket.destroy()
        }

        function fail(): void {
          if (settled) return
          settled = true
          cleanup()
          reject(scannerUnavailable())
        }

        function succeed(verdict: "clean" | "infected"): void {
          if (settled) return
          settled = true
          cleanup()
          resolve(verdict)
        }

        socket.once("connect", () => {
          try {
            socket.write(INSTREAM_COMMAND)
            for (
              let offset = 0;
              offset < buffer.byteLength;
              offset += CHUNK_BYTES
            ) {
              const chunk = buffer.subarray(offset, offset + CHUNK_BYTES)
              const length = Buffer.allocUnsafe(4)
              length.writeUInt32BE(chunk.byteLength)
              socket.write(length)
              socket.write(chunk)
            }
            socket.write(TERMINATOR)
          } catch {
            fail()
          }
        })

        socket.on("data", (chunk: Buffer) => {
          if (settled) return
          responseBytes += chunk.byteLength
          if (responseBytes > MAX_RESPONSE_BYTES) {
            fail()
            return
          }
          responseParts.push(chunk)
          try {
            const verdict = parseVerdict(Buffer.concat(responseParts, responseBytes))
            if (verdict !== null) succeed(verdict)
          } catch {
            fail()
          }
        })
        socket.once("error", fail)
        socket.once("end", fail)
        socket.once("close", fail)
      })
    },
  })
}
