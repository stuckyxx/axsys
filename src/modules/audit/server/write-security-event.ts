import "server-only"

import { z } from "zod"

import { bffDb } from "@/lib/db/bff"
import { redactRecord } from "@/lib/security/redact"

const SECURITY_EVENT_TYPES = [
  "auth.login.failed",
  "auth.login.rate_limited",
  "auth.reauthentication.failed",
  "auth.reauthentication.rate_limited",
  "auth.password_recovery.requested",
  "auth.password_recovery.failed",
  "auth.password_recovery.rate_limited",
] as const

const SECURITY_REASON_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_PROVIDER_FAILURE",
  "IP_RATE_LIMITED",
  "ACCOUNT_RATE_LIMITED",
] as const

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u).nullable().optional()
const metadataSchema = z
  .object({
    attempts: z.int().min(0).max(1_000_000).optional(),
    retryAfterSeconds: z.int().min(0).max(86_400).optional(),
  })
  .strict()

const securityEventSchema = z
  .object({
    eventType: z.enum(SECURITY_EVENT_TYPES),
    emailHash: hashSchema,
    ipHash: hashSchema,
    outcome: z.enum(["success", "denied", "failure"]),
    reasonCode: z.enum(SECURITY_REASON_CODES).nullable().optional(),
    correlationId: z.uuid(),
    metadata: metadataSchema.optional().default({}),
  })
  .strict()

const SECURITY_EVENT_VOCABULARY = new Set([
  "auth.login.failed|denied|AUTH_INVALID_CREDENTIALS",
  "auth.login.failed|failure|AUTH_PROVIDER_FAILURE",
  "auth.login.rate_limited|denied|IP_RATE_LIMITED",
  "auth.login.rate_limited|denied|ACCOUNT_RATE_LIMITED",
  "auth.reauthentication.failed|denied|AUTH_INVALID_CREDENTIALS",
  "auth.reauthentication.failed|failure|AUTH_PROVIDER_FAILURE",
  "auth.reauthentication.rate_limited|denied|IP_RATE_LIMITED",
  "auth.reauthentication.rate_limited|denied|ACCOUNT_RATE_LIMITED",
  "auth.password_recovery.requested|success|",
  "auth.password_recovery.failed|failure|AUTH_PROVIDER_FAILURE",
  "auth.password_recovery.rate_limited|denied|IP_RATE_LIMITED",
  "auth.password_recovery.rate_limited|denied|ACCOUNT_RATE_LIMITED",
])

export type SecurityEventInput = Readonly<z.input<typeof securityEventSchema>>

export async function writeSecurityEvent(
  input: SecurityEventInput,
): Promise<void> {
  const parsed = securityEventSchema.safeParse(input)
  if (!parsed.success) throw new Error("Invalid security event")

  const event = parsed.data
  const reasonCode = event.reasonCode ?? null
  if (
    !SECURITY_EVENT_VOCABULARY.has(
      `${event.eventType}|${event.outcome}|${reasonCode ?? ""}`,
    )
  ) {
    throw new Error("Invalid security event")
  }

  await bffDb.writeSecurityEvent({
    eventType: event.eventType,
    emailHash: event.emailHash ?? null,
    ipHash: event.ipHash ?? null,
    outcome: event.outcome,
    reasonCode,
    correlationId: event.correlationId,
    metadata: redactRecord(event.metadata),
  })
}
