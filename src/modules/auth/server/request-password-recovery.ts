import "server-only"

import { getServerEnv } from "@/lib/env/server"
import { ApiError } from "@/lib/http/api-error"
import {
  consumeRateLimit,
  getClientIp,
  type RateLimitDecision,
} from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import { writeSecurityEvent } from "@/modules/audit/server/write-security-event"
import { forgotPasswordSchema } from "@/modules/auth/schemas/auth-schemas"

export const PASSWORD_RECOVERY_NEUTRAL_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos as instruções."

type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>

export type PasswordRecoveryRequestResult = Readonly<{
  message: typeof PASSWORD_RECOVERY_NEUTRAL_MESSAGE
}>

export class PasswordRecoveryRateLimitError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "PASSWORD_RECOVERY_RATE_LIMITED",
      429,
      PASSWORD_RECOVERY_NEUTRAL_MESSAGE,
    )
  }
}

async function bestEffortSecurityEvent(
  input: Parameters<typeof writeSecurityEvent>[0],
): Promise<void> {
  try {
    await writeSecurityEvent(input)
  } catch {
    // Recovery responses remain account-neutral if observability is unavailable.
  }
}

async function throwIfRateLimited(input: {
  decision: RateLimitDecision
  scope: "IP" | "ACCOUNT"
  emailHash: string
  ipHash: string
  correlationId: string
}): Promise<void> {
  if (input.decision.allowed) return

  await bestEffortSecurityEvent({
    eventType: "auth.password_recovery.rate_limited",
    emailHash: input.emailHash,
    ipHash: input.ipHash,
    outcome: "denied",
    reasonCode:
      input.scope === "IP" ? "IP_RATE_LIMITED" : "ACCOUNT_RATE_LIMITED",
    correlationId: input.correlationId,
    metadata: {
      attempts: input.decision.attempts,
      retryAfterSeconds: input.decision.retryAfterSeconds,
    },
  })
  throw new PasswordRecoveryRateLimitError(input.decision.retryAfterSeconds)
}

export async function requestPasswordRecovery(
  input: ForgotPasswordInput,
  request: Request,
  correlationId: string,
): Promise<PasswordRecoveryRequestResult> {
  const parsed = forgotPasswordSchema.parse(input)
  const ip = getClientIp(request)
  const emailHash = hashSensitive(parsed.email)
  const ipHash = hashSensitive(ip)

  const ipDecision = await consumeRateLimit("forgot-ip-volume", ip)
  await throwIfRateLimited({
    decision: ipDecision,
    scope: "IP",
    emailHash,
    ipHash,
    correlationId,
  })

  const accountDecision = await consumeRateLimit(
    "forgot-account-volume",
    parsed.email,
  )
  await throwIfRateLimited({
    decision: accountDecision,
    scope: "ACCOUNT",
    emailHash,
    ipHash,
    correlationId,
  })

  let providerSucceeded = false
  try {
    const client = await createServerSupabase()
    const result = await client.auth.resetPasswordForEmail(parsed.email, {
      redirectTo: `${getServerEnv().APP_ORIGIN}/auth/callback?next=/reset-password`,
    })
    providerSucceeded = result.error === null
  } catch {
    providerSucceeded = false
  }

  await bestEffortSecurityEvent({
    eventType: providerSucceeded
      ? "auth.password_recovery.requested"
      : "auth.password_recovery.failed",
    emailHash,
    ipHash,
    outcome: providerSucceeded ? "success" : "failure",
    reasonCode: providerSucceeded ? null : "AUTH_PROVIDER_FAILURE",
    correlationId,
    metadata: { attempts: accountDecision.attempts },
  })

  return Object.freeze({ message: PASSWORD_RECOVERY_NEUTRAL_MESSAGE })
}
