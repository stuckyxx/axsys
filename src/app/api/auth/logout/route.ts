import { cookies } from "next/headers"
import { z } from "zod"

import { bffDb } from "@/lib/db/bff"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf, CSRF_COOKIE_NAME } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { getClientIp } from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"
import { createServerSupabase } from "@/lib/supabase/server"

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
})

const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u

type LogoutCookieDeletion = Readonly<{
  name: string
  sameSite: "Lax" | "Strict"
}>

function cookieDeletionTargets(
  store: Awaited<ReturnType<typeof cookies>>,
): LogoutCookieDeletion[] {
  const targets = new Map<string, LogoutCookieDeletion>()
  for (const cookie of store.getAll()) {
    if (cookie.name === CSRF_COOKIE_NAME) {
      targets.set(cookie.name, { name: cookie.name, sameSite: "Strict" })
    } else if (AUTH_COOKIE_NAME.test(cookie.name)) {
      targets.set(cookie.name, { name: cookie.name, sameSite: "Lax" })
    }
  }
  return [...targets.values()]
}

function deletionHeader({ name, sameSite }: LogoutCookieDeletion): string {
  return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=${sameSite}`
}

function noContent(deletions: readonly LogoutCookieDeletion[] = []): Response {
  const headers = new Headers()
  for (const deletion of deletions) {
    headers.append("Set-Cookie", deletionHeader(deletion))
  }
  return withNoStore(new Response(null, { status: 204, headers }))
}

async function clearAuthenticationCookies(
  store: Awaited<ReturnType<typeof cookies>>,
  deletions: readonly LogoutCookieDeletion[],
): Promise<void> {
  for (const deletion of deletions) {
    try {
      store.delete(deletion.name)
    } catch {
      // The committed app-session revocation remains authoritative.
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const client = await createServerSupabase()
    const claimsResult = await client.auth.getClaims()
    if (claimsResult.error !== null) {
      throw new Error("Authentication verification unavailable")
    }

    const rawClaims = claimsResult.data?.claims
    if (rawClaims === null || rawClaims === undefined) {
      const store = await cookies()
      const deletions = cookieDeletionTargets(store)
      await clearAuthenticationCookies(store, deletions)
      return noContent(deletions)
    }
    const parsedClaims = claimsSchema.safeParse(rawClaims)
    if (!parsedClaims.success) {
      throw new Error("Authentication verification unavailable")
    }
    if (parsedClaims.data.is_anonymous === true) {
      const store = await cookies()
      const deletions = cookieDeletionTargets(store)
      await clearAuthenticationCookies(store, deletions)
      return noContent(deletions)
    }

    assertMutationOrigin(request.headers.get("origin"))
    const store = await cookies()
    const deletions = cookieDeletionTargets(store)
    assertCsrf(
      request.headers.get("x-csrf-token"),
      store.get(CSRF_COOKIE_NAME)?.value ?? null,
    )

    const ip = getClientIp(request)
    const rawUserAgent = request.headers.get("user-agent")
    await bffDb.revokeSessionsAndWriteLogout({
      actorUserId: parsedClaims.data.sub,
      sessionId: parsedClaims.data.session_id,
      correlationId,
      ipHash: hashSensitive(ip),
      userAgentHash: rawUserAgent ? hashSensitive(rawUserAgent) : null,
    })

    try {
      await client.auth.signOut({ scope: "global" })
    } catch {
      // App-session revocation committed before the provider call.
    }
    await clearAuthenticationCookies(store, deletions)
    return noContent(deletions)
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
