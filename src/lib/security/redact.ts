import "server-only"

import { Buffer } from "node:buffer"
import { createHmac } from "node:crypto"

import { getServerEnv } from "@/lib/env/server"

const SENSITIVE_KEY =
  /password|passphrase|secret|token|authorization|cookie|cpf|account|branch|document|certificate.*(?:path|token)|public.*path|jwt|key|bytes|model.?output/iu
const SENSITIVE_VALUE =
  /(?:\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bsb_(?:secret|service_role|publishable)_[A-Za-z0-9_-]{16,}\b|\bt_[A-Za-z0-9_-]{43}\b|\bpostgres(?:ql)?:\/\/[^\s]+|https?:\/\/[^\s/:@]+:[^\s@]+@[^\s]+|[?&](?:access_?token|token|signature|sig|key|password|x-amz-signature|x-goog-signature)=[^\s&#]+|\b(?:[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{11})\b|\/(?:public\/certidoes|api\/public\/certificates)\/[^\s/?#]+(?:\/[^\s?#]*)?)/iu

const REDACTED = "[REDACTED]"
const TRUNCATED = "[TRUNCATED]"
const CYCLE = "[CYCLE]"
const UNSUPPORTED = "[UNSUPPORTED]"
const MAX_DEPTH = 6
const MAX_KEYS = 50
const MAX_ARRAY = 25
const MAX_STRING = 512
const MAX_NODES = 500
const MAX_OUTPUT_BYTES = 16_384

type RedactionBudget = { nodesLeft: number }

export function hashSensitive(value: string): string {
  return createHmac("sha256", getServerEnv().SECURITY_HASH_PEPPER)
    .update(value.trim().toLowerCase())
    .digest("hex")
}

export function fingerprintSensitiveExact(
  purpose: string,
  value: string,
): string {
  if (!/^[a-z][a-z0-9-]{2,63}$/u.test(purpose) || value.length === 0) {
    throw new Error("Invalid sensitive fingerprint input")
  }
  return createHmac("sha256", getServerEnv().SECURITY_HASH_PEPPER)
    .update(`${purpose.length}:${purpose}${value.length}:${value}`, "utf8")
    .digest("hex")
}

function truncateString(value: string): string {
  const characters = Array.from(value)
  return characters.length > MAX_STRING
    ? `${characters.slice(0, MAX_STRING).join("")}…`
    : value
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: RedactionBudget,
): unknown {
  if (depth > MAX_DEPTH || budget.nodesLeft <= 0) return TRUNCATED
  budget.nodesLeft -= 1

  if (typeof value === "string") {
    return SENSITIVE_VALUE.test(value) ? REDACTED : truncateString(value)
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (typeof value !== "object") return UNSUPPORTED
  if (seen.has(value)) return CYCLE
  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => redactValue(item, depth + 1, seen, budget))
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_KEYS)
      .map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key)
          ? REDACTED
          : redactValue(item, depth + 1, seen, budget),
      ]),
  )
}

export function redactRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const redacted = redactValue(input, 0, new WeakSet(), {
    nodesLeft: MAX_NODES,
  }) as Record<string, unknown>
  const serialized = JSON.stringify(redacted)
  return Buffer.byteLength(serialized, "utf8") <= MAX_OUTPUT_BYTES
    ? redacted
    : { _redacted: TRUNCATED }
}
