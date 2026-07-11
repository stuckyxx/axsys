import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test as base } from "@playwright/test"
import postgres from "postgres"

import type { Database } from "@/lib/supabase/database.types"
import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "../../helpers/local-destructive-urls"
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

const FIXTURE_NAME = "Task 13 password-recovery E2E fixture"

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
  const project = projectName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/gu, "-")
    .slice(0, 20)
  return `axsys-task13-e2e-${project}-${workerIndex}`
}

type MailpitSummary = Readonly<{
  ID: string
  To?: ReadonlyArray<Readonly<{ Address?: string }>>
}>

export type PasswordRecoveryIdentity = Readonly<{
  clientIp: string
  email: string
  newPassword: string
  oldPassword: string
  latestRecoveryLink: () => Promise<string | null>
  recoveryState: () => Promise<
    Readonly<{
      auditCount: number
      grantUnusable: boolean
      operationStatus: string
    }> | null
  >
}>

class PasswordRecoveryIdentityFixture {
  readonly clientIp = createUniqueLocalFixtureClientIp()
  readonly email = `task13-recovery-${randomUUID()}@example.test`
  readonly oldPassword = `Axsys-${randomBytes(24).toString("base64url")}!5o`
  readonly newPassword = `Axsys-${randomBytes(24).toString("base64url")}!8n`

  private readonly admin: SupabaseClient<Database>
  private readonly databaseUrl: string
  private readonly mailpitUrl: string
  private readonly ownerApplicationName: string
  private readonly ownerSql: ReturnType<typeof postgres>
  private readonly pepper: string
  private readonly supabaseUrl: string
  private userId = ""

  constructor(projectName: string, workerIndex: number) {
    this.databaseUrl = requireLocalOwnerDatabaseUrl(
      process.env.DATABASE_URL,
      FIXTURE_NAME,
    )
    this.supabaseUrl = requireLocalHttpUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "54321",
      FIXTURE_NAME,
    ).replace(/\/$/u, "")
    this.mailpitUrl = requireLocalHttpUrl(
      "http://127.0.0.1:54324",
      "54324",
      FIXTURE_NAME,
    ).replace(/\/$/u, "")
    this.pepper = requireSecret(process.env.SECURITY_HASH_PEPPER)
    this.ownerApplicationName = applicationName(projectName, workerIndex)
    this.admin = createClient<Database>(
      this.supabaseUrl,
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

  async provision(): Promise<void> {
    const created = await this.admin.auth.admin.createUser({
      email: this.email,
      password: this.oldPassword,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 13 E2E identity creation failed")
    }

    this.userId = created.data.user.id
    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.profiles (
          user_id, email, display_name, password_changed_at
        ) values (
          ${this.userId}::uuid,
          ${this.email},
          'Task 13 E2E Password Recovery',
          clock_timestamp()
        )
      `
      await transaction`
        insert into public.platform_roles (user_id)
        values (${this.userId}::uuid)
      `
    })
  }

  private async messages(): Promise<MailpitSummary[]> {
    const search = new URLSearchParams({
      query: `to:${this.email}`,
      limit: "100",
    })
    const response = await fetch(`${this.mailpitUrl}/api/v1/search?${search}`, {
      cache: "no-store",
    })
    if (!response.ok) throw new Error("Task 13 Mailpit list failed")
    const body = (await response.json()) as { messages?: MailpitSummary[] }
    return (body.messages ?? []).filter((message) =>
      message.To?.some(
        ({ Address }) => Address?.trim().toLowerCase() === this.email,
      ),
    )
  }

  async latestRecoveryLink(): Promise<string | null> {
    const [message] = await this.messages()
    if (!message) return null

    const response = await fetch(
      `${this.mailpitUrl}/api/v1/message/${encodeURIComponent(message.ID)}`,
      { cache: "no-store" },
    )
    if (!response.ok) throw new Error("Task 13 Mailpit message failed")
    const body = (await response.json()) as { HTML?: string; Text?: string }
    const contents = `${body.Text ?? ""}\n${body.HTML ?? ""}`.replaceAll(
      "&amp;",
      "&",
    )
    const links = contents.match(/https?:\/\/[^\s"'<>]+/gu) ?? []
    const candidate = links.find((link) => link.includes("/auth/v1/verify"))
    if (!candidate) throw new Error("Task 13 recovery link missing")

    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      throw new Error("Task 13 recovery link invalid")
    }
    if (
      parsed.origin !== this.supabaseUrl ||
      parsed.pathname !== "/auth/v1/verify" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error("Task 13 recovery link is not local")
    }
    return parsed.toString()
  }

  async recoveryState(): Promise<
    Readonly<{
      auditCount: number
      grantUnusable: boolean
      operationStatus: string
    }> | null
  > {
    if (!this.userId) return null
    const [state] = await this.ownerSql<
      Array<{
        auditCount: number
        grantUnusable: boolean
        operationStatus: string
      }>
    >`
      select operation.status::text as "operationStatus",
             not exists (
               select 1
               from private.password_recovery_grants grant_row
               where grant_row.user_id = operation.target_user_id
                 and grant_row.consumed_at is null
             ) as "grantUnusable",
             (
               select count(*)::integer
               from public.audit_events audit
               where audit.correlation_id = operation.correlation_id
             ) as "auditCount"
      from private.auth_password_operations operation
      where operation.target_user_id = ${this.userId}::uuid
        and operation.kind = 'password_recovery'
      order by operation.reserved_at desc
      limit 1
    `
    return state ?? null
  }

  private rateHashes(): string[] {
    return [
      hashSensitive(this.email, this.pepper),
      hashLocalFixtureClientIp(this.clientIp, this.pepper),
    ]
  }

  private async deleteMail(): Promise<boolean> {
    try {
      const messages = await this.messages()
      if (messages.length > 0) {
        const response = await fetch(`${this.mailpitUrl}/api/v1/messages`, {
          method: "DELETE",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ IDs: messages.map(({ ID }) => ID) }),
        })
        if (!response.ok) return false
      }
      return (await this.messages()).length === 0
    } catch {
      return false
    }
  }

  async cleanup(): Promise<void> {
    let cleanupFailure = false
    const sessionIds: string[] = []
    const rateHashes = this.rateHashes()
    const emailHash = rateHashes[0]!
    const ipHash = rateHashes[1]!

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
            alter table public.audit_events disable trigger audit_events_append_only
          `
          await transaction`
            alter table public.security_events disable trigger security_events_append_only
          `
          await transaction`
            delete from public.audit_events
            where actor_user_id = ${this.userId}::uuid
               or resource_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.security_events
            where user_id = ${this.userId}::uuid
               or email_hash = ${emailHash}
               or ip_hash = ${ipHash}
          `
          await transaction`
            alter table public.audit_events enable trigger audit_events_append_only
          `
          await transaction`
            alter table public.security_events enable trigger security_events_append_only
          `
          await transaction`
            delete from private.auth_password_operations
            where actor_user_id = ${this.userId}::uuid
               or target_user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from private.password_recovery_grants
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from private.rate_limit_buckets
            where key_hash = any(${rateHashes}::text[])
          `
          await transaction`
            delete from private.auth_session_controls
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
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

      try {
        const deleted = await this.admin.auth.admin.deleteUser(this.userId, false)
        if (deleted.error) cleanupFailure = true
      } catch {
        cleanupFailure = true
      }

      try {
        await this.ownerSql.begin(async (transaction) => {
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
            delete from auth.identities
            where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from auth.users
            where id = ${this.userId}::uuid
          `
        })
      } catch {
        cleanupFailure = true
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
            + (select count(*) from private.auth_password_operations
               where actor_user_id = ${this.userId}::uuid
                  or target_user_id = ${this.userId}::uuid)
            + (select count(*) from private.password_recovery_grants
               where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_session_controls
               where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_user_session_cutoffs
               where user_id = ${this.userId}::uuid)
            + (select count(*) from public.audit_events
               where actor_user_id = ${this.userId}::uuid
                  or resource_id = ${this.userId}::uuid)
            + (select count(*) from public.security_events
               where user_id = ${this.userId}::uuid
                  or email_hash = ${emailHash}
                  or ip_hash = ${ipHash})
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) cleanupFailure = true
      } catch {
        cleanupFailure = true
      }
    }

    if (!(await this.deleteMail())) cleanupFailure = true

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
      throw new Error("Task 13 E2E cleanup left residue or connections")
    }
  }
}

type WorkerFixtures = {
  passwordRecoveryIdentity: PasswordRecoveryIdentity
}

export const test = base.extend<object, WorkerFixtures>({
  passwordRecoveryIdentity: [
    async ({}, provide, workerInfo) => {
      const fixture = new PasswordRecoveryIdentityFixture(
        workerInfo.project.name,
        workerInfo.workerIndex,
      )
      try {
        await fixture.provision()
        await provide(
          Object.freeze({
            clientIp: fixture.clientIp,
            email: fixture.email,
            newPassword: fixture.newPassword,
            oldPassword: fixture.oldPassword,
            latestRecoveryLink: () => fixture.latestRecoveryLink(),
            recoveryState: () => fixture.recoveryState(),
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
