import "server-only"

import { cookies } from "next/headers"
import { z } from "zod"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import {
  clearAccountFailureRateLimit,
  consumeRateLimit,
  getClientIp,
  progressiveDelayMs,
  type RateLimitDecision,
} from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event"
import { writeSecurityEvent } from "@/modules/audit/server/write-security-event"
import { loginSchema } from "@/modules/auth/schemas/auth-schemas"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
})

const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u

type LoginInput = z.input<typeof loginSchema>

export type LoginResult = Readonly<{
  redirectTo: "/platform" | "/app/dashboard" | "/change-password"
}>

export type LoginDependencies = Readonly<{
  sleep?: (milliseconds: number) => Promise<void>
}>

export class AuthenticationRateLimitError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "AUTH_RATE_LIMITED",
      429,
      "Muitas tentativas. Tente novamente mais tarde.",
    )
  }
}

function invalidCredentials(): ApiError {
  return new ApiError(
    "AUTH_INVALID_CREDENTIALS",
    401,
    "E-mail ou senha inválidos.",
  )
}

function loginUnavailable(): ApiError {
  return new ApiError(
    "AUTH_LOGIN_UNAVAILABLE",
    403,
    "Não foi possível concluir o acesso.",
  )
}

function temporaryPasswordExpired(): ApiError {
  return new ApiError(
    "TEMPORARY_PASSWORD_EXPIRED",
    403,
    "A senha provisória expirou. Solicite uma nova senha.",
  )
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function clearSupabaseAuthenticationCookies(): Promise<void> {
  try {
    const store = await cookies()
    for (const cookie of store.getAll()) {
      if (AUTH_COOKIE_NAME.test(cookie.name)) {
        store.delete(cookie.name)
      }
    }
  } catch {
    // The application session remains non-authorizing even if cookie I/O fails.
  }
}

async function bestEffortGlobalSignOut(
  client: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<void> {
  try {
    await client.auth.signOut({ scope: "global" })
  } catch {
    // Explicit cookie clearing and the application session control fail closed.
  }
  await clearSupabaseAuthenticationCookies()
}

async function bestEffortSecurityEvent(
  input: Parameters<typeof writeSecurityEvent>[0],
): Promise<void> {
  try {
    await writeSecurityEvent(input)
  } catch {
    // Authentication responses stay neutral if observability is unavailable.
  }
}

async function throwIfRateLimited(input: {
  decision: RateLimitDecision
  scope: "IP" | "ACCOUNT"
  eventType: "auth.login.rate_limited"
  emailHash: string
  ipHash: string
  correlationId: string
}): Promise<void> {
  if (input.decision.allowed) return

  await bestEffortSecurityEvent({
    eventType: input.eventType,
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
  throw new AuthenticationRateLimitError(input.decision.retryAfterSeconds)
}

async function tryFailClosedSession(input: {
  actorUserId: string
  sessionId: string
  reasonCode:
    | "AUTH_CONTEXT_RESOLUTION_FAILED"
    | "AUTH_AUDIT_ACTIVATION_FAILED"
    | "TEMPORARY_PASSWORD_EXPIRED"
  correlationId: string
}): Promise<boolean> {
  try {
    await bffDb.failClosedLoginSession(input)
    return true
  } catch {
    // A pending row cannot authorize; an active row is also checked against Auth.
    return false
  }
}

export async function login(
  input: LoginInput,
  request: Request,
  correlationId: string,
  dependencies: LoginDependencies = {},
): Promise<LoginResult> {
  const parsed = loginSchema.parse(input)
  const sleep = dependencies.sleep ?? defaultSleep
  const ip = getClientIp(request)
  const emailHash = hashSensitive(parsed.email)
  const ipHash = hashSensitive(ip)
  const rawUserAgent = request.headers.get("user-agent")
  const userAgentHash = rawUserAgent ? hashSensitive(rawUserAgent) : null

  const ipDecision = await consumeRateLimit("login-ip-volume", ip)
  await throwIfRateLimited({
    decision: ipDecision,
    scope: "IP",
    eventType: "auth.login.rate_limited",
    emailHash,
    ipHash,
    correlationId,
  })

  const accountDecision = await consumeRateLimit(
    "login-account-failure",
    parsed.email,
  )
  await throwIfRateLimited({
    decision: accountDecision,
    scope: "ACCOUNT",
    eventType: "auth.login.rate_limited",
    emailHash,
    ipHash,
    correlationId,
  })

  const client = await createServerSupabase()
  let signInResult: Awaited<ReturnType<typeof client.auth.signInWithPassword>>
  try {
    signInResult = await client.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password,
    })
  } catch {
    await bestEffortSecurityEvent({
      eventType: "auth.login.failed",
      emailHash,
      ipHash,
      outcome: "failure",
      reasonCode: "AUTH_PROVIDER_FAILURE",
      correlationId,
      metadata: { attempts: accountDecision.attempts },
    })
    await sleep(progressiveDelayMs(accountDecision.attempts))
    throw invalidCredentials()
  }

  if (signInResult.error !== null) {
    await bestEffortSecurityEvent({
      eventType: "auth.login.failed",
      emailHash,
      ipHash,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId,
      metadata: { attempts: accountDecision.attempts },
    })
    await sleep(progressiveDelayMs(accountDecision.attempts))
    throw invalidCredentials()
  }

  try {
    await clearAccountFailureRateLimit(
      "login-account-failure",
      parsed.email,
    )
    const claimsResult = await client.auth.getClaims()
    const parsedClaims = claimsSchema.safeParse(claimsResult.data?.claims)
    if (
      claimsResult.error !== null ||
      !parsedClaims.success ||
      parsedClaims.data.is_anonymous === true
    ) {
      throw loginUnavailable()
    }

    const { sub: actorUserId, session_id: sessionId } = parsedClaims.data
    await bffDb.registerAuthSession(sessionId, actorUserId, parsed.rememberMe)

    try {
      await writeAuditEvent({
        actorUserId,
        sessionId,
        action: "auth.login",
        resourceType: "session",
        resourceId: null,
        outcome: "success",
        reasonCode: null,
        correlationId,
        ipHash,
        userAgentHash,
        metadata: { rememberMe: parsed.rememberMe },
      })
    } catch {
      const classifiedAsExpired = await tryFailClosedSession({
        actorUserId,
        sessionId,
        reasonCode: "TEMPORARY_PASSWORD_EXPIRED",
        correlationId,
      })
      if (classifiedAsExpired) throw temporaryPasswordExpired()

      await tryFailClosedSession({
        actorUserId,
        sessionId,
        reasonCode: "AUTH_AUDIT_ACTIVATION_FAILED",
        correlationId,
      })
      throw loginUnavailable()
    }

    const resolution = await getAccessContext()
    if (resolution.status === "password_change") {
      if (resolution.userId !== actorUserId) {
        await tryFailClosedSession({
          actorUserId,
          sessionId,
          reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
          correlationId,
        })
        throw loginUnavailable()
      }
      if (!resolution.expired) return { redirectTo: "/change-password" }

      const classifiedAsExpired = await tryFailClosedSession({
        actorUserId,
        sessionId,
        reasonCode: "TEMPORARY_PASSWORD_EXPIRED",
        correlationId,
      })
      if (classifiedAsExpired) throw temporaryPasswordExpired()

      await tryFailClosedSession({
        actorUserId,
        sessionId,
        reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
        correlationId,
      })
      throw loginUnavailable()
    }
    if (resolution.status === "authenticated") {
      if (
        resolution.context.userId !== actorUserId ||
        resolution.context.sessionId !== sessionId
      ) {
        await tryFailClosedSession({
          actorUserId,
          sessionId,
          reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
          correlationId,
        })
        throw loginUnavailable()
      }
      return {
        redirectTo:
          resolution.context.kind === "platform"
            ? "/platform"
            : "/app/dashboard",
      }
    }

    await tryFailClosedSession({
      actorUserId,
      sessionId,
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
      correlationId,
    })
    throw loginUnavailable()
  } catch (error) {
    await bestEffortGlobalSignOut(client)
    throw error
  }
}
