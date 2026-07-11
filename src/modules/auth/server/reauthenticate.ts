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
import { writeSecurityEvent } from "@/modules/audit/server/write-security-event"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { getAccessContext } from "@/modules/auth/server/get-access-context"
import { AuthenticationRateLimitError } from "@/modules/auth/server/login"

const CURRENT_PASSWORD_AMR_TOLERANCE_SECONDS = 60
const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u

export const reauthenticationSchema = z
  .object({ password: z.string().min(1).max(128) })
  .strict()

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
  amr: z.unknown().optional(),
})

type ReauthenticationInput = z.input<typeof reauthenticationSchema>
type SafeAccessContext =
  | Readonly<{
      kind: "platform"
      userId: string
      modules: readonly []
      profile: AccessContext["profile"]
    }>
  | Readonly<{
      kind: "company"
      userId: string
      companyId: string
      role: "company_admin" | "member"
      modules: readonly ("administrative" | "financial" | "certificates")[]
      profile: AccessContext["profile"]
    }>

export type ReauthenticationDependencies = Readonly<{
  sleep?: (milliseconds: number) => Promise<void>
}>

function authenticationRequired(): ApiError {
  return new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
}

function invalidCurrentPassword(): ApiError {
  return new ApiError(
    "AUTH_INVALID_CREDENTIALS",
    401,
    "Senha atual inválida.",
  )
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function safeContext(context: AccessContext): SafeAccessContext {
  if (context.kind === "platform") {
    return {
      kind: context.kind,
      userId: context.userId,
      modules: [],
      profile: context.profile,
    }
  }
  return {
    kind: context.kind,
    userId: context.userId,
    companyId: context.companyId,
    role: context.role,
    modules: context.modules,
    profile: context.profile,
  }
}

function hasCurrentPasswordAmr(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false
  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false
    }
    const { method, timestamp } = entry as Record<string, unknown>
    return (
      method === "password" &&
      Number.isSafeInteger(timestamp) &&
      (timestamp as number) >=
        nowSeconds - CURRENT_PASSWORD_AMR_TOLERANCE_SECONDS &&
      (timestamp as number) <=
        nowSeconds + CURRENT_PASSWORD_AMR_TOLERANCE_SECONDS
    )
  })
}

async function clearSupabaseAuthenticationCookies(): Promise<void> {
  try {
    const store = await cookies()
    for (const cookie of store.getAll()) {
      if (AUTH_COOKIE_NAME.test(cookie.name)) store.delete(cookie.name)
    }
  } catch {
    // The Auth/session database checks remain authoritative.
  }
}

async function bestEffortGlobalSignOut(
  client: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<void> {
  try {
    const result = await client.auth.signOut({ scope: "global" })
    if (result.error !== null) {
      throw new Error("Auth sign-out unavailable")
    }
  } catch {
    // Explicit cookie clearing and Auth-session authority fail closed.
  }
  await clearSupabaseAuthenticationCookies()
}

async function bestEffortRevokeFreshAppSession(input: {
  actorUserId: string
  sessionId: string
  correlationId: string
}): Promise<void> {
  try {
    await bffDb.failClosedLoginSession({
      ...input,
      reasonCode: "AUTH_CONTEXT_RESOLUTION_FAILED",
    })
  } catch {
    // Global Auth sign-out remains the secondary containment boundary.
  }
}

async function containFailedFreshContext(
  client: Awaited<ReturnType<typeof createServerSupabase>>,
  input: {
    actorUserId: string
    sessionId: string
    correlationId: string
  },
): Promise<never> {
  await bestEffortRevokeFreshAppSession(input)
  await bestEffortGlobalSignOut(client)
  throw new Error("Reauthentication unavailable")
}

async function bestEffortSecurityEvent(
  input: Parameters<typeof writeSecurityEvent>[0],
): Promise<void> {
  try {
    await writeSecurityEvent(input)
  } catch {
    // The outward authentication contract remains neutral.
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
    eventType: "auth.reauthentication.rate_limited",
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

export async function reauthenticate(
  input: ReauthenticationInput,
  request: Request,
  correlationId: string,
  dependencies: ReauthenticationDependencies = {},
): Promise<SafeAccessContext> {
  const parsedInput = reauthenticationSchema.parse(input)
  const sleep = dependencies.sleep ?? defaultSleep
  const client = await createServerSupabase()

  const initialClaimsResult = await client.auth.getClaims()
  if (initialClaimsResult.error !== null) {
    throw new Error("Authentication verification unavailable")
  }
  const initialClaims = claimsSchema.safeParse(initialClaimsResult.data?.claims)
  if (!initialClaims.success || initialClaims.data.is_anonymous === true) {
    throw authenticationRequired()
  }

  const initialResolution = await getAccessContext()
  if (initialResolution.status === "anonymous") throw authenticationRequired()
  if (initialResolution.status === "password_change") {
    throw new ApiError(
      "PASSWORD_CHANGE_REQUIRED",
      403,
      "Altere sua senha provisória para continuar.",
    )
  }
  const initialContext = initialResolution.context
  if (
    initialContext.userId !== initialClaims.data.sub ||
    initialContext.sessionId !== initialClaims.data.session_id
  ) {
    throw authenticationRequired()
  }

  const email = initialContext.profile.email
  const ip = getClientIp(request)
  const emailHash = hashSensitive(email)
  const ipHash = hashSensitive(ip)
  const ipDecision = await consumeRateLimit("reauth-ip-volume", ip)
  await throwIfRateLimited({
    decision: ipDecision,
    scope: "IP",
    emailHash,
    ipHash,
    correlationId,
  })
  const accountDecision = await consumeRateLimit(
    "reauth-account-failure",
    email,
  )
  await throwIfRateLimited({
    decision: accountDecision,
    scope: "ACCOUNT",
    emailHash,
    ipHash,
    correlationId,
  })

  let signInResult: Awaited<ReturnType<typeof client.auth.signInWithPassword>>
  try {
    signInResult = await client.auth.signInWithPassword({
      email,
      password: parsedInput.password,
    })
  } catch {
    await bestEffortSecurityEvent({
      eventType: "auth.reauthentication.failed",
      emailHash,
      ipHash,
      outcome: "failure",
      reasonCode: "AUTH_PROVIDER_FAILURE",
      correlationId,
      metadata: { attempts: accountDecision.attempts },
    })
    await sleep(progressiveDelayMs(accountDecision.attempts))
    throw invalidCurrentPassword()
  }
  if (signInResult.error !== null) {
    await bestEffortSecurityEvent({
      eventType: "auth.reauthentication.failed",
      emailHash,
      ipHash,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId,
      metadata: { attempts: accountDecision.attempts },
    })
    await sleep(progressiveDelayMs(accountDecision.attempts))
    throw invalidCurrentPassword()
  }

  const freshClaimsResult = await client.auth.getClaims()
  const freshClaims = claimsSchema.safeParse(freshClaimsResult.data?.claims)
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (
    freshClaimsResult.error !== null ||
    !freshClaims.success ||
    freshClaims.data.is_anonymous === true ||
    freshClaims.data.sub !== initialContext.userId ||
    freshClaims.data.session_id === initialContext.sessionId ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds <= 0 ||
    !hasCurrentPasswordAmr(freshClaims.data.amr, nowSeconds)
  ) {
    await bestEffortSecurityEvent({
      eventType: "auth.reauthentication.failed",
      emailHash,
      ipHash,
      outcome: "failure",
      reasonCode: "AUTH_PROVIDER_FAILURE",
      correlationId,
      metadata: { attempts: accountDecision.attempts },
    })
    await bestEffortGlobalSignOut(client)
    throw invalidCurrentPassword()
  }

  try {
    await clearAccountFailureRateLimit("reauth-account-failure", email)
    await bffDb.rotateAppSessionAfterReauthentication({
      actorUserId: initialContext.userId,
      oldSessionId: initialContext.sessionId,
      newSessionId: freshClaims.data.session_id,
      correlationId,
    })
  } catch {
    await bestEffortGlobalSignOut(client)
    throw new Error("Reauthentication unavailable")
  }

  let freshResolution: Awaited<ReturnType<typeof getAccessContext>>
  try {
    freshResolution = await getAccessContext()
  } catch {
    return containFailedFreshContext(client, {
      actorUserId: initialContext.userId,
      sessionId: freshClaims.data.session_id,
      correlationId,
    })
  }
  if (
    freshResolution.status !== "authenticated" ||
    freshResolution.context.userId !== initialContext.userId ||
    freshResolution.context.sessionId !== freshClaims.data.session_id
  ) {
    return containFailedFreshContext(client, {
      actorUserId: initialContext.userId,
      sessionId: freshClaims.data.session_id,
      correlationId,
    })
  }

  return safeContext(freshResolution.context)
}
