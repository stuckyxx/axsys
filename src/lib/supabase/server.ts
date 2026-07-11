import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

const SECURE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

export async function createServerSupabase() {
  const cookieStore = await cookies()
  const env = getPublicEnv()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SECURE_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (values) => {
          try {
            for (const { name, value, options } of values) {
              cookieStore.set(name, value, {
                ...options,
                ...SECURE_COOKIE_OPTIONS,
              })
            }
          } catch {
            // Server Components cannot write cookies; Proxy performs refresh writes.
          }
        },
      },
    },
  )
}
