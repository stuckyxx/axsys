import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

const SECURE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

export async function updateSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  const env = getPublicEnv()
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SECURE_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values, responseHeaders) => {
          for (const { name, value } of values) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request: { headers: requestHeaders } })
          for (const { name, value, options } of values) {
            response.cookies.set(name, value, {
              ...options,
              ...SECURE_COOKIE_OPTIONS,
            })
          }
          for (const [name, value] of Object.entries(responseHeaders)) {
            response.headers.set(name, value)
          }
        },
      },
    },
  )

  await supabase.auth.getClaims()
  return response
}
