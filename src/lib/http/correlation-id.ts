import { randomUUID } from "node:crypto"

import { z } from "zod"

const correlationIdSchema = z.uuid()

export function getCorrelationId(request: Request): string {
  const provided = request.headers.get("x-correlation-id")
  return correlationIdSchema.safeParse(provided).success ? provided! : randomUUID()
}
