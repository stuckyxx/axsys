import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getPublicEnv } from "@/lib/env/public"
import { getServerEnv } from "@/lib/env/server"
import type { Database } from "@/lib/supabase/database.types"

let adminClient: SupabaseClient<Database> | undefined

export function getAdminSupabase(): SupabaseClient<Database> {
  if (!adminClient) {
    const publicEnv = getPublicEnv()
    const serverEnv = getServerEnv()
    adminClient = createClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        },
      },
    )
  }
  return adminClient
}
