"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

type BrowserRealtimeCapability = Readonly<{
  channel: SupabaseClient<Database>["channel"]
  removeChannel: SupabaseClient<Database>["removeChannel"]
}>

let realtimeClient: SupabaseClient<Database> | undefined
let realtimeCapability: BrowserRealtimeCapability | undefined

async function getRealtimeAccessToken(): Promise<string> {
  const response = await fetch("/api/auth/realtime-token", {
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Realtime authorization failed")

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error("Realtime authorization failed")
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("accessToken" in body) ||
    typeof body.accessToken !== "string" ||
    body.accessToken.length === 0 ||
    body.accessToken !== body.accessToken.trim()
  ) {
    throw new Error("Realtime authorization failed")
  }
  return body.accessToken
}

export function getBrowserRealtime(): BrowserRealtimeCapability {
  if (!realtimeClient) {
    const env = getPublicEnv()
    realtimeClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        accessToken: getRealtimeAccessToken,
      },
    )
  }
  realtimeCapability ??= Object.freeze({
    channel: realtimeClient.channel.bind(realtimeClient),
    removeChannel: realtimeClient.removeChannel.bind(realtimeClient),
  })
  return realtimeCapability
}
