import { cookies } from "next/headers"

import { getServerEnv } from "@/lib/env/server"
import {
  CSRF_COOKIE_NAME,
  CSRF_TOKEN_TTL_SECONDS,
  createCsrfToken,
  verifyCsrfToken,
} from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"

export async function GET(): Promise<Response> {
  const cookieStore = await cookies()
  const secret = getServerEnv().CSRF_SECRET
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null
  const token =
    existing !== null && verifyCsrfToken(existing, existing, secret)
      ? existing
      : createCsrfToken(secret)

  if (token !== existing) {
    cookieStore.set(CSRF_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: CSRF_TOKEN_TTL_SECONDS,
    })
  }

  return withNoStore(Response.json({ token }))
}
