import "server-only"

import { z } from "zod"

import { bffDb } from "@/lib/db/bff"
import { redactRecord } from "@/lib/security/redact"

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u).nullable()
const metadataSchema = z
  .object({ rememberMe: z.boolean().optional() })
  .strict()

const authenticatedAuditEventSchema = z
  .object({
    actorUserId: z.uuid(),
    sessionId: z.uuid(),
    action: z.literal("auth.login"),
    resourceType: z.literal("session"),
    resourceId: z.null(),
    outcome: z.literal("success"),
    reasonCode: z.null(),
    correlationId: z.uuid(),
    ipHash: hashSchema,
    userAgentHash: hashSchema,
    metadata: metadataSchema.optional().default({}),
  })
  .strict()

export type AuthenticatedAuditEventInput = Readonly<
  z.input<typeof authenticatedAuditEventSchema>
>

export async function writeAuditEvent(
  input: AuthenticatedAuditEventInput,
): Promise<void> {
  const parsed = authenticatedAuditEventSchema.safeParse(input)
  if (!parsed.success) throw new Error("Invalid audit event")

  const event = parsed.data
  await bffDb.writeAuthenticatedAuditEvent({
    actorUserId: event.actorUserId,
    sessionId: event.sessionId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    ipHash: event.ipHash,
    userAgentHash: event.userAgentHash,
    metadata: redactRecord(event.metadata),
  })
}
