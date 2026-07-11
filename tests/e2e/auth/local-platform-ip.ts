import { createHmac, randomBytes } from "node:crypto"

import { canonicalizeIp } from "@/lib/security/canonical-ip"

const FIXTURE_IP_ERROR = "Task 14 local E2E fixture IP is unavailable"

export function canonicalizeLocalFixtureClientIp(value: string): string {
  const canonical = canonicalizeIp(value)
  if (canonical === null) throw new Error(FIXTURE_IP_ERROR)
  return canonical
}

export function createUniqueLocalFixtureClientIp(): string {
  const groups = randomBytes(12).toString("hex").match(/.{4}/gu)
  if (groups === null || groups.length !== 6) {
    throw new Error(FIXTURE_IP_ERROR)
  }
  return canonicalizeLocalFixtureClientIp(`2001:db8:${groups.join(":")}`)
}

export function hashLocalFixtureClientIp(
  value: string,
  pepper: string,
): string {
  return createHmac("sha256", pepper)
    .update(canonicalizeLocalFixtureClientIp(value).trim().toLowerCase())
    .digest("hex")
}
