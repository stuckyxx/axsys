import type { NextRequest } from "next/server"

import { getPublicEnv } from "@/lib/env/public"
import { buildContentSecurityPolicy } from "@/lib/security/csp"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { updateSupabaseSession } from "@/lib/supabase/proxy"

const NO_STORE_PATH =
  /^\/(?:app|platform|api\/auth|api\/profile|auth\/callback|login|forgot-password|reset-password|change-password)(?:\/|$)/u

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  const response = await updateSupabaseSession(request, requestHeaders)
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  )

  if (NO_STORE_PATH.test(request.nextUrl.pathname)) {
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      response.headers.set(name, value)
    }
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
