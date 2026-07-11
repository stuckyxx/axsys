import { randomUUID } from "node:crypto"

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/supabase/database.types"
import {
  Task11LocalFixture,
  cookieStoreFor,
  type Task11CookieJar,
} from "../auth/task11-local-fixture"
import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "../../helpers/local-destructive-urls"

const requestCookies = vi.hoisted(() => ({
  current: undefined as Task11CookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current) throw new Error("Realtime cookie jar unavailable")
    return cookieStoreFor(requestCookies.current)
  },
}))

const FIXTURE_NAME = "Task 16 cross-tenant Realtime integration"
const fixtureA = new Task11LocalFixture()
const fixtureB = new Task11LocalFixture()
const supabaseUrl = requireLocalHttpUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "54321",
  FIXTURE_NAME,
).replace(/\/$/u, "")
function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error(`${FIXTURE_NAME} unavailable`)
  }
  return value
}
const publishableKey = requireSecret(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
)

const ownerSql = postgres(
  requireLocalOwnerDatabaseUrl(process.env.DATABASE_URL, FIXTURE_NAME),
  {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: `axsys-task16-realtime-${randomUUID()}`,
      lock_timeout: 6_000,
      statement_timeout: 12_000,
      idle_in_transaction_session_timeout: 12_000,
    },
  },
)

type RealtimeClient = SupabaseClient<Database>

let clientA: RealtimeClient | undefined
let clientB: RealtimeClient | undefined
let channelA: RealtimeChannel | undefined
let channelB: RealtimeChannel | undefined
const eventsA: string[] = []
const eventsB: string[] = []

function clientFor(accessToken: string): RealtimeClient {
  return createClient<Database>(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    accessToken: async () => accessToken,
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  })
}

function subscribeToCompanies(
  client: RealtimeClient,
  label: string,
  events: string[],
): Promise<RealtimeChannel> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void client.removeChannel(channel)
      reject(new Error(`${FIXTURE_NAME} subscription timed out`))
    }, 15_000)
    const channel = client
      .channel(`axsys:test:${label}:${randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "companies" },
        (payload) => {
          const id = (payload.new as { id?: unknown }).id
          if (typeof id === "string") events.push(id)
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout)
          resolve(channel)
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          clearTimeout(timeout)
          reject(new Error(`${FIXTURE_NAME} subscription failed: ${status}`))
        }
      })
  })
}

async function waitForEvent(
  events: readonly string[],
  expectedId: string,
  expectedCount = 1,
): Promise<void> {
  const deadline = Date.now() + 10_000
  const countMatches = () => events.filter((id) => id === expectedId).length
  while (countMatches() < expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (countMatches() < expectedCount) {
    throw new Error(`${FIXTURE_NAME} expected signal did not arrive`)
  }
}

beforeAll(async () => {
  requestCookies.current = fixtureA.jar
  await fixtureA.createCompanyIdentity()
  const sessionA = await fixtureA.signInAndActivate()

  requestCookies.current = fixtureB.jar
  await fixtureB.createCompanyIdentity()
  const sessionB = await fixtureB.signInAndActivate()

  clientA = clientFor(sessionA.accessToken)
  clientB = clientFor(sessionB.accessToken)
  await Promise.all([clientA.realtime.setAuth(), clientB.realtime.setAuth()])
  ;[channelA, channelB] = await Promise.all([
    subscribeToCompanies(clientA, "company-a", eventsA),
    subscribeToCompanies(clientB, "company-b", eventsB),
  ])
}, 45_000)

afterAll(async () => {
  const cleanupErrors: unknown[] = []
  for (const [client, channel] of [
    [clientA, channelA],
    [clientB, channelB],
  ] as const) {
    if (!client) continue
    try {
      if (channel) await client.removeChannel(channel)
      await client.removeAllChannels()
      client.realtime.disconnect()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  try {
    await ownerSql.end({ timeout: 2 })
  } catch (error) {
    cleanupErrors.push(error)
  }
  requestCookies.current = fixtureB.jar
  try {
    await fixtureB.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }
  requestCookies.current = fixtureA.jar
  try {
    await fixtureA.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  } finally {
    requestCookies.current = undefined
  }

  if (cleanupErrors.length > 0) throw cleanupErrors[0]
}, 45_000)

describe.sequential("Task 16 authorized Realtime signals", () => {
  it("does not wake company A for a mutation visible only to company B", async () => {
    await ownerSql`
      update public.companies
      set trade_name = ${`Realtime B ${randomUUID()}`}
      where id = ${fixtureB.companyId}::uuid
    `
    await waitForEvent(eventsB, fixtureB.companyId)

    expect(eventsB).toEqual([fixtureB.companyId])
    expect(eventsA).toEqual([])

    await ownerSql`
      update public.companies
      set trade_name = ${`Realtime A ${randomUUID()}`}
      where id = ${fixtureA.companyId}::uuid
    `
    await waitForEvent(eventsA, fixtureA.companyId)

    expect(eventsA).toEqual([fixtureA.companyId])
    expect(eventsB).toEqual([fixtureB.companyId])

    await ownerSql`
      update public.companies
      set trade_name = ${`Realtime B barrier ${randomUUID()}`}
      where id = ${fixtureB.companyId}::uuid
    `
    await waitForEvent(eventsB, fixtureB.companyId, 2)

    expect(eventsA).toEqual([fixtureA.companyId])
    expect(eventsB).toEqual([fixtureB.companyId, fixtureB.companyId])
  })
})
