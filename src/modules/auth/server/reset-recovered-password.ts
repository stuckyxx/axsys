import "server-only"

import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"

import { cookies } from "next/headers"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import { changePasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { validatePassword } from "@/modules/auth/server/password-policy"

export const RECOVERY_GRANT_COOKIE_NAME = "__Host-axsys-recovery-grant"

const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u
const RAW_RECOVERY_GRANT = /^[A-Za-z0-9_-]{43}$/u

const recoveryClaimsSchema = z
  .object({
    sub: z.uuid(),
    session_id: z.uuid(),
    is_anonymous: z.literal(false),
    amr: z
      .array(
        z.object({
          method: z.string().min(1).max(64),
          timestamp: z.number().int().safe().positive(),
        }),
      )
      .min(1)
      .max(16),
  })
  .superRefine((claims, context) => {
    if (claims.amr.filter(({ method }) => method === "recovery").length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Invalid recovery authentication method",
        path: ["amr"],
      })
    }
  })

export type RecoveryClaims = z.infer<typeof recoveryClaimsSchema>
type ResetRecoveredPasswordInput = z.input<typeof changePasswordSchema>
type FailureReason =
  | "AUTH_CALL_NOT_ATTEMPTED"
  | "AUTH_PROVIDER_FAILURE"
  | "AUTH_COMPLETION_FAILURE"

export type PasswordRecoveryAuthAdapter = Readonly<{
  getClaims: () => Promise<unknown>
  updatePassword: (password: string) => Promise<void>
  globalSignOut: () => Promise<boolean>
}>

export type ResetRecoveredPasswordDependencies = Readonly<{
  auth?: PasswordRecoveryAuthAdapter
  beforeAuthUpdate?: () => Promise<void>
  afterAuthUpdate?: () => Promise<void>
}>

export class PasswordRecoveryRetryRequiredError extends ApiError {
  constructor() {
    super(
      "PASSWORD_RECOVERY_RETRY_REQUIRED",
      503,
      "Não foi possível concluir a troca. Solicite um novo link e tente novamente.",
    )
  }
}

function invalidRecovery(): ApiError {
  return new ApiError(
    "PASSWORD_RECOVERY_INVALID",
    401,
    "A recuperação expirou ou já foi utilizada.",
  )
}

function decodeRawGrant(value: string | undefined): Buffer | null {
  if (!value || !RAW_RECOVERY_GRANT.test(value)) return null
  try {
    const decoded = Buffer.from(value, "base64url")
    return decoded.byteLength === 32 && decoded.toString("base64url") === value
      ? decoded
      : null
  } catch {
    return null
  }
}

export function parseRecoveryClaims(value: unknown): RecoveryClaims | null {
  const parsed = recoveryClaimsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

async function clearRecoveryStateCookies(): Promise<void> {
  try {
    const store = await cookies()
    store.delete(RECOVERY_GRANT_COOKIE_NAME)
    store.delete(CSRF_COOKIE_NAME)
    for (const cookie of store.getAll()) {
      if (AUTH_COOKIE_NAME.test(cookie.name)) store.delete(cookie.name)
    }
  } catch {
    // Database revocation and the consumed one-time grant remain authoritative.
  }
}

async function createDefaultAuthAdapter(): Promise<PasswordRecoveryAuthAdapter> {
  const client = await createServerSupabase()
  return Object.freeze({
    getClaims: async () => {
      const result = await client.auth.getClaims()
      if (result.error !== null || !result.data?.claims) {
        throw new Error("Recovery claims unavailable")
      }
      return result.data.claims
    },
    updatePassword: async (password: string) => {
      const result = await client.auth.updateUser({ password })
      if (result.error !== null) throw new Error("Auth update unavailable")
    },
    globalSignOut: async () => {
      try {
        const result = await client.auth.signOut({ scope: "global" })
        return result.error === null
      } catch {
        return false
      }
    },
  })
}

async function signOutAndClear(auth: PasswordRecoveryAuthAdapter): Promise<boolean> {
  let signedOut = false
  try {
    signedOut = await auth.globalSignOut()
  } catch {
    signedOut = false
  }
  await clearRecoveryStateCookies()
  return signedOut
}

async function markFailure(input: {
  operationId: string
  reasonCode: FailureReason
  correlationId: string
}): Promise<void> {
  try {
    await bffDb.failPasswordRecovery(input)
  } catch {
    // begin_password_recovery already forced the profile closed.
  }
}

async function failAfterBegin(input: {
  auth: PasswordRecoveryAuthAdapter
  operationId: string
  reasonCode: FailureReason
  correlationId: string
}): Promise<never> {
  await markFailure(input)
  await signOutAndClear(input.auth)
  throw new PasswordRecoveryRetryRequiredError()
}

export async function resetRecoveredPassword(
  input: ResetRecoveredPasswordInput,
  correlationId: string,
  dependencies: ResetRecoveredPasswordDependencies = {},
): Promise<Readonly<{ redirectTo: "/login" }>> {
  const parsedInput = changePasswordSchema.parse(input)
  await validatePassword(parsedInput.password)

  const store = await cookies()
  const rawGrant = store.get(RECOVERY_GRANT_COOKIE_NAME)?.value
  const decodedGrant = decodeRawGrant(rawGrant)
  if (!decodedGrant || !rawGrant) {
    await clearRecoveryStateCookies()
    throw invalidRecovery()
  }

  const auth = dependencies.auth ?? (await createDefaultAuthAdapter())
  let claims: RecoveryClaims | null = null
  try {
    claims = parseRecoveryClaims(await auth.getClaims())
  } catch {
    claims = null
  }
  if (!claims) {
    await signOutAndClear(auth)
    throw invalidRecovery()
  }

  const grantHash = createHash("sha256").update(rawGrant, "utf8").digest("hex")
  let operation:
    | { operationId: string; userId: string; sessionId: string }
    | undefined
  try {
    operation = await bffDb.beginPasswordRecovery({ grantHash, correlationId })
  } catch {
    await signOutAndClear(auth)
    throw invalidRecovery()
  }

  let currentClaims: RecoveryClaims | null = null
  try {
    currentClaims = parseRecoveryClaims(await auth.getClaims())
  } catch {
    currentClaims = null
  }

  if (
    !operation ||
    !currentClaims ||
    operation.userId !== claims.sub ||
    operation.sessionId !== claims.session_id ||
    currentClaims.sub !== operation.userId ||
    currentClaims.session_id !== operation.sessionId
  ) {
    if (operation) {
      await failAfterBegin({
        auth,
        operationId: operation.operationId,
        reasonCode: "AUTH_CALL_NOT_ATTEMPTED",
        correlationId,
      })
    }
    await signOutAndClear(auth)
    throw invalidRecovery()
  }

  try {
    await dependencies.beforeAuthUpdate?.()
  } catch {
    await failAfterBegin({
      auth,
      operationId: operation.operationId,
      reasonCode: "AUTH_CALL_NOT_ATTEMPTED",
      correlationId,
    })
  }

  try {
    await auth.updatePassword(parsedInput.password)
  } catch {
    await failAfterBegin({
      auth,
      operationId: operation.operationId,
      reasonCode: "AUTH_PROVIDER_FAILURE",
      correlationId,
    })
  }

  try {
    await dependencies.afterAuthUpdate?.()
    await bffDb.completePasswordRecovery({
      operationId: operation.operationId,
      correlationId,
    })
  } catch {
    await failAfterBegin({
      auth,
      operationId: operation.operationId,
      reasonCode: "AUTH_COMPLETION_FAILURE",
      correlationId,
    })
  }

  if (!(await signOutAndClear(auth))) {
    throw new PasswordRecoveryRetryRequiredError()
  }
  return Object.freeze({ redirectTo: "/login" })
}
