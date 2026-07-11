import { Buffer } from "node:buffer"
import { createHash, randomBytes } from "node:crypto"

import { cookies } from "next/headers"

import { getPublicEnv } from "@/lib/env/public"
import { getServerEnv } from "@/lib/env/server"
import { withNoStore } from "@/lib/security/no-store"
import { createServerSupabase } from "@/lib/supabase/server"
import {
  parseRecoveryClaims,
  RECOVERY_GRANT_COOKIE_NAME,
  type RecoveryClaims,
} from "@/modules/auth/server/reset-recovered-password"

const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u
const AUTH_CODE = /^[A-Za-z0-9._~-]{1,512}$/u
const RECOVERY_DESTINATION = "/reset-password"
const MAX_GRANT_AGE_SECONDS = 600
const RESTORED_PKCE_MAX_AGE_SECONDS = 3_600
const PHYSICAL_PKCE_COOKIE = /^base64-[A-Za-z0-9_-]{16,1024}$/u
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u

type PkceVerifierSnapshot = Readonly<{ name: string; value: string }>

function trustedRedirect(path: string): Response {
  return withNoStore(
    new Response(null, {
      status: 303,
      headers: { Location: `${getServerEnv().APP_ORIGIN}${path}` },
    }),
  )
}

function invalidRedirect(): Response {
  return trustedRedirect("/login?recovery=invalid")
}

function hasExactRecoveryQuery(url: URL): boolean {
  const keys = [...url.searchParams.keys()]
  const codeValues = url.searchParams.getAll("code")
  const nextValues = url.searchParams.getAll("next")
  return (
    keys.length === 2 &&
    codeValues.length === 1 &&
    nextValues.length === 1 &&
    AUTH_CODE.test(codeValues[0] ?? "") &&
    nextValues[0] === RECOVERY_DESTINATION
  )
}

function isRecentRecovery(claims: RecoveryClaims): boolean {
  const recovery = claims.amr.filter(({ method }) => method === "recovery")
  if (recovery.length !== 1) return false
  const issuedAtMilliseconds = recovery[0]!.timestamp * 1_000
  const now = Date.now()
  return (
    Number.isSafeInteger(issuedAtMilliseconds) &&
    issuedAtMilliseconds <= now &&
    now < issuedAtMilliseconds + MAX_GRANT_AGE_SECONDS * 1_000
  )
}

function canonicalVerifierCookieName(): string | null {
  try {
    const hostname = new URL(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).hostname
    const projectReference = hostname.split(".")[0]
    if (!projectReference || !/^[A-Za-z0-9-]{1,63}$/u.test(projectReference)) {
      return null
    }
    return `sb-${projectReference}-auth-token-code-verifier`
  } catch {
    return null
  }
}

function isCanonicalRecoveryVerifierCookie(value: string): boolean {
  if (!PHYSICAL_PKCE_COOKIE.test(value)) return false
  const encoded = value.slice("base64-".length)
  try {
    const decoded = Buffer.from(encoded, "base64url")
    if (decoded.toString("base64url") !== encoded) return false
    const stored = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(decoded),
    ) as unknown
    if (typeof stored !== "string" || !stored.endsWith("/recovery")) {
      return false
    }
    return PKCE_VERIFIER.test(stored.slice(0, -"/recovery".length))
  } catch {
    return false
  }
}

async function snapshotRecoveryVerifier(): Promise<PkceVerifierSnapshot | null> {
  const name = canonicalVerifierCookieName()
  if (!name) return null
  try {
    const store = await cookies()
    const matches = store.getAll().filter((cookie) => cookie.name === name)
    if (
      matches.length !== 1 ||
      !isCanonicalRecoveryVerifierCookie(matches[0]!.value)
    ) {
      return null
    }
    return Object.freeze({ name, value: matches[0]!.value })
  } catch {
    return null
  }
}

async function restoreRecoveryVerifier(
  snapshot: PkceVerifierSnapshot | null,
): Promise<void> {
  if (!snapshot) return
  try {
    const store = await cookies()
    store.set(snapshot.name, snapshot.value, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: RESTORED_PKCE_MAX_AGE_SECONDS,
    })
  } catch {
    // A failed exchange created no session; the callback still fails closed.
  }
}

async function clearCallbackCookies(): Promise<void> {
  try {
    const store = await cookies()
    store.delete(RECOVERY_GRANT_COOKIE_NAME)
    for (const cookie of store.getAll()) {
      if (AUTH_COOKIE_NAME.test(cookie.name)) store.delete(cookie.name)
    }
  } catch {
    // The server-side one-time flow remains the source of truth.
  }
}

async function rejectCallback(
  client?: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<Response> {
  if (client) {
    try {
      await client.auth.signOut({ scope: "global" })
    } catch {
      // Cookie clearing still prevents this response from retaining the session.
    }
  }
  await clearCallbackCookies()
  return invalidRedirect()
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (!hasExactRecoveryQuery(url)) return invalidRedirect()

  const verifierSnapshot = await snapshotRecoveryVerifier()
  let client: Awaited<ReturnType<typeof createServerSupabase>> | undefined
  let sessionExchanged = false
  try {
    client = await createServerSupabase()
    const exchanged = await client.auth.exchangeCodeForSession(
      url.searchParams.get("code")!,
    )
    const accessToken = exchanged.data.session?.access_token
    if (exchanged.error !== null || !accessToken || !exchanged.data.user) {
      await restoreRecoveryVerifier(verifierSnapshot)
      return invalidRedirect()
    }
    sessionExchanged = true

    const claimResult = await client.auth.getClaims(accessToken)
    const claims = parseRecoveryClaims(claimResult.data?.claims)
    if (claimResult.error !== null || !claims || !isRecentRecovery(claims)) {
      return rejectCallback(client)
    }
    if (
      exchanged.data.user.id !== claims.sub ||
      exchanged.data.session?.user.id !== claims.sub
    ) {
      return rejectCallback(client)
    }

    const rawGrant = randomBytes(32).toString("base64url")
    const grantHash = createHash("sha256").update(rawGrant).digest("hex")
    const issued = await client.rpc("issue_password_recovery_grant", {
      p_grant_hash: grantHash,
    })
    if (issued.error !== null || typeof issued.data !== "string") {
      return rejectCallback(client)
    }

    const expiresAt = Date.parse(issued.data)
    const remainingMilliseconds = expiresAt - Date.now()
    if (!Number.isFinite(expiresAt) || remainingMilliseconds <= 0) {
      return rejectCallback(client)
    }
    const maxAge = Math.min(
      MAX_GRANT_AGE_SECONDS,
      Math.max(1, Math.floor(remainingMilliseconds / 1_000)),
    )

    const store = await cookies()
    store.set(RECOVERY_GRANT_COOKIE_NAME, rawGrant, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge,
    })
    return trustedRedirect(RECOVERY_DESTINATION)
  } catch {
    if (!sessionExchanged) {
      await restoreRecoveryVerifier(verifierSnapshot)
      return invalidRedirect()
    }
    return client ? rejectCallback(client) : invalidRedirect()
  }
}
