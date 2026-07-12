import "server-only"

import { withNoStore } from "@/lib/security/no-store"
import {
  consumeRateLimit,
  type RateLimitBucket,
} from "@/lib/security/rate-limit"

export async function enforceUserMutationRateLimit(
  bucket: Extract<
    RateLimitBucket,
    "user-provisioning" | "administrative-password-reset"
  >,
  key: string,
  correlationId: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit(bucket, key)
  if (decision.allowed) return null
  return withNoStore(
    Response.json(
      {
        error: {
          code: "USER_RATE_LIMITED",
          message: "Muitas solicitações. Tente novamente mais tarde.",
          correlationId,
        },
      },
      { status: 429 },
    ),
  )
}
