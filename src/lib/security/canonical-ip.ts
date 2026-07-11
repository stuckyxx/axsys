import { isIP } from "node:net"

const MAX_IP_LENGTH = 64

export function canonicalizeIp(value: string): string | null {
  if (value.length === 0 || value.length > MAX_IP_LENGTH) return null

  const version = isIP(value)
  if (version === 4) {
    return value
      .split(".")
      .map((octet) => String(Number(octet)))
      .join(".")
  }
  if (version !== 6) return null

  try {
    const hostname = new URL(`http://[${value}]/`).hostname
    const normalized = hostname.slice(1, -1).toLowerCase()
    const mapped = normalized.match(
      /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u,
    )
    if (!mapped) return normalized

    const high = Number.parseInt(mapped[1], 16)
    const low = Number.parseInt(mapped[2], 16)
    return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".")
  } catch {
    return null
  }
}
