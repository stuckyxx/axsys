import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test as base } from "@playwright/test"
import postgres from "postgres"

import type { Database } from "@/lib/supabase/database.types"
import {
  createUniqueLocalFixtureClientIp,
  hashLocalFixtureClientIp,
} from "./local-platform-ip"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local E2E environment directly.
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const LOCAL_SUPABASE_PORT = "54321"
const LOCAL_DATABASE_PORT = "54322"
const FIXTURE_NAME = "Task 14 local E2E fixture"

function parseUrl(value: string | undefined): URL {
  if (!value) throw new Error(`${FIXTURE_NAME} is unavailable`)

  try {
    return new URL(value)
  } catch {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  const url = parseUrl(value)
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== LOCAL_SUPABASE_PORT ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
  return url.toString()
}

function requireLocalDatabaseUrl(value: string | undefined): string {
  const url = parseUrl(value)
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== LOCAL_DATABASE_PORT ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
  return url.toString()
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
  return value
}

function hashSensitive(value: string, pepper: string): string {
  return createHmac("sha256", pepper)
    .update(value.trim().toLowerCase())
    .digest("hex")
}

function applicationName(projectName: string, workerIndex: number): string {
  const safeProject = projectName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/gu, "-")
    .slice(0, 24)
  return `axsys-task14-e2e-${safeProject}-${workerIndex}`
}

export type LocalPlatformIdentity = Readonly<{
  clientIp: string
  email: string
  password: string
  trackRejectedAccount: (email: string) => void
}>

class LocalPlatformIdentityFixture {
  readonly clientIp = createUniqueLocalFixtureClientIp()
  readonly email = `task14-e2e-${randomUUID()}@example.test`
  readonly password = `Axsys-${randomBytes(32).toString("base64url")}!9a`

  private readonly accountRateKeys = new Set<string>([this.email])
  private readonly admin: SupabaseClient<Database>
  private readonly databaseUrl: string
  private readonly ownerApplicationName: string
  private readonly ownerSql: ReturnType<typeof postgres>
  private readonly pepper: string
  private userId = ""

  constructor(projectName: string, workerIndex: number) {
    const supabaseUrl = requireLocalSupabaseUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    )
    this.databaseUrl = requireLocalDatabaseUrl(process.env.DATABASE_URL)
    this.pepper = requireSecret(process.env.SECURITY_HASH_PEPPER)
    this.ownerApplicationName = applicationName(projectName, workerIndex)
    this.admin = createClient<Database>(
      supabaseUrl,
      requireSecret(process.env.SUPABASE_SECRET_KEY),
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
    this.ownerSql = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 20,
      connection: {
        application_name: this.ownerApplicationName,
        lock_timeout: 6_000,
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 10_000,
      },
    })
  }

  trackRejectedAccount(email: string): void {
    const normalized = email.trim().toLowerCase()
    if (normalized.length === 0 || normalized.length > 254) {
      throw new Error("Task 14 rejected account fixture is invalid")
    }
    this.accountRateKeys.add(normalized)
  }

  async provision(): Promise<void> {
    const created = await this.admin.auth.admin.createUser({
      email: this.email,
      password: this.password,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 14 E2E identity creation failed")
    }

    this.userId = created.data.user.id
    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.profiles (user_id, email, display_name)
        values (${this.userId}::uuid, ${this.email}, 'Task 14 E2E Platform')
      `
      await transaction`
        insert into public.platform_roles (user_id)
        values (${this.userId}::uuid)
      `
    })
  }

  private accountHashes(): string[] {
    return [...this.accountRateKeys].map((value) =>
      hashSensitive(value, this.pepper),
    )
  }

  private rateHashes(): string[] {
    return [
      ...this.accountHashes(),
      hashLocalFixtureClientIp(this.clientIp, this.pepper),
    ]
  }

  async cleanup(): Promise<void> {
    let cleanupFailure = false
    const sessionIds: string[] = []
    const accountHashes = this.accountHashes()
    const rateHashes = this.rateHashes()

    if (this.userId !== "") {
      try {
        const sessions = await this.ownerSql<{ id: string }[]>`
          select id
          from auth.sessions
          where user_id = ${this.userId}::uuid
          order by id
        `
        sessionIds.push(...sessions.map(({ id }) => id))

        await this.ownerSql.begin(async (transaction) => {
          await transaction`
            delete from private.auth_session_controls
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from auth.refresh_tokens
            where user_id = ${this.userId}
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from auth.sessions
            where user_id = ${this.userId}::uuid
          `

          await transaction`
            alter table public.audit_events
            disable trigger audit_events_append_only
          `
          await transaction`
            alter table public.security_events
            disable trigger security_events_append_only
          `
          await transaction`
            delete from public.audit_events
            where actor_user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.security_events
            where user_id = ${this.userId}::uuid
               or email_hash = any(${accountHashes}::text[])
          `
          await transaction`
            alter table public.audit_events
            enable trigger audit_events_append_only
          `
          await transaction`
            alter table public.security_events
            enable trigger security_events_append_only
          `

          await transaction`
            delete from private.rate_limit_buckets
            where key_hash = any(${rateHashes}::text[])
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.platform_roles
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.profiles
            where user_id = ${this.userId}::uuid
          `
        })
      } catch {
        cleanupFailure = true
      }

      let providerDeleteFailed = false
      try {
        const deleted = await this.admin.auth.admin.deleteUser(this.userId, false)
        providerDeleteFailed = deleted.error !== null
      } catch {
        providerDeleteFailed = true
      }

      if (providerDeleteFailed) {
        cleanupFailure = true
        try {
          await this.ownerSql`
            delete from auth.users
            where id = ${this.userId}::uuid
          `
        } catch {
          cleanupFailure = true
        }
      }

      try {
        const [residue] = await this.ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users
             where id = ${this.userId}::uuid)
            + (select count(*) from auth.identities
               where user_id = ${this.userId}::uuid)
            + (select count(*) from auth.sessions
               where user_id = ${this.userId}::uuid)
            + (select count(*) from auth.refresh_tokens
               where user_id = ${this.userId}
                  or session_id = any(${sessionIds}::uuid[]))
            + (select count(*) from public.profiles
               where user_id = ${this.userId}::uuid)
            + (select count(*) from public.platform_roles
               where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_session_controls
               where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_user_session_cutoffs
               where user_id = ${this.userId}::uuid)
            + (select count(*) from public.audit_events
               where actor_user_id = ${this.userId}::uuid)
            + (select count(*) from public.security_events
               where user_id = ${this.userId}::uuid
                  or email_hash = any(${accountHashes}::text[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) cleanupFailure = true
      } catch {
        cleanupFailure = true
      }
    }

    try {
      await this.ownerSql.end({ timeout: 2 })
    } catch {
      cleanupFailure = true
    }

    const verifier = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 10,
      connection: {
        application_name: `${this.ownerApplicationName}-verify`.slice(0, 63),
        statement_timeout: 5_000,
      },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = ${this.ownerApplicationName}
      `
      if (connections.count !== 0) cleanupFailure = true
    } catch {
      cleanupFailure = true
    } finally {
      await verifier.end({ timeout: 2 })
    }

    if (cleanupFailure) {
      throw new Error("Task 14 E2E cleanup left residue or connections")
    }
  }
}

type WorkerFixtures = {
  platformIdentity: LocalPlatformIdentity
}

export const test = base.extend<object, WorkerFixtures>({
  platformIdentity: [
    async ({}, provide, workerInfo) => {
      const fixture = new LocalPlatformIdentityFixture(
        workerInfo.project.name,
        workerInfo.workerIndex,
      )
      try {
        await fixture.provision()
        await provide(
          Object.freeze({
            clientIp: fixture.clientIp,
            email: fixture.email,
            password: fixture.password,
            trackRejectedAccount: (email: string) =>
              fixture.trackRejectedAccount(email),
          }),
        )
      } finally {
        await fixture.cleanup()
      }
    },
    { scope: "worker" },
  ],
})

export { expect }
