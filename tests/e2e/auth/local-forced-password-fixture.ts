import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test as base } from "@playwright/test"
import postgres from "postgres"

import type { Database } from "@/lib/supabase/database.types"
import {
  createUniqueLocalFixtureClientIp,
  hashLocalFixtureClientIp,
} from "./local-platform-ip"
import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "../../helpers/local-destructive-urls"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local E2E environment directly.
  }
}

const FIXTURE_NAME = "Task 12 forced-password E2E fixture"

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
  return `axsys-task12-e2e-${project}-${workerIndex}`
}

export type ForcedPasswordIdentity = Readonly<{
  clientIp: string
  email: string
  permanentPassword: string
  temporaryPassword: string
}>

class ForcedPasswordIdentityFixture {
  readonly clientIp = createUniqueLocalFixtureClientIp()
  readonly email = `task12-forced-${randomUUID()}@example.test`
  readonly temporaryPassword = `Axsys-${randomBytes(24).toString("base64url")}!4t`
  readonly permanentPassword = `Axsys-${randomBytes(24).toString("base64url")}!8p`

  private readonly admin: SupabaseClient<Database>
  private readonly databaseUrl: string
  private readonly ownerApplicationName: string
  private readonly ownerSql: ReturnType<typeof postgres>
  private readonly pepper: string
  private companyId = ""
  private membershipId = ""
  private userId = ""

  constructor(projectName: string, workerIndex: number) {
    this.databaseUrl = requireLocalOwnerDatabaseUrl(
      process.env.DATABASE_URL,
      FIXTURE_NAME,
    )
    this.pepper = requireSecret(process.env.SECURITY_HASH_PEPPER)
    this.ownerApplicationName = applicationName(projectName, workerIndex)
    this.admin = createClient<Database>(
      requireLocalHttpUrl(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        "54321",
        FIXTURE_NAME,
      ),
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
      password: this.temporaryPassword,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 12 E2E identity creation failed")
    }
    this.userId = created.data.user.id
    this.companyId = randomUUID()
    this.membershipId = randomUUID()
    const cnpj = `81${randomInt(0, 1_000_000_000_000)
      .toString()
      .padStart(12, "0")}`

    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.profiles (
          user_id, email, display_name, must_change_password,
          temporary_password_expires_at
        ) values (
          ${this.userId}::uuid, ${this.email}, 'Task 12 Forced Password',
          true, clock_timestamp() + interval '24 hours'
        )
      `
      await transaction`
        insert into public.companies (
          id, legal_name, trade_name, cnpj_normalized, contact_email
        ) values (
          ${this.companyId}::uuid, 'Task 12 E2E Company', 'Task 12',
          ${cnpj}, ${this.email}
        )
      `
      await transaction`
        insert into public.company_memberships (
          id, company_id, user_id, role
        ) values (
          ${this.membershipId}::uuid, ${this.companyId}::uuid,
          ${this.userId}::uuid, 'member'
        )
      `
      await transaction`
        insert into public.member_modules (company_id, membership_id, module)
        values (${this.companyId}::uuid, ${this.membershipId}::uuid, 'administrative')
      `
    })
  }

  private rateHashes(): string[] {
    return [
      hashSensitive(this.email, this.pepper),
      hashLocalFixtureClientIp(this.clientIp, this.pepper),
    ]
  }

  async cleanup(): Promise<void> {
    let cleanupFailure = false
    const sessionIds: string[] = []
    const rateHashes = this.rateHashes()

    if (this.userId !== "") {
      try {
        const sessions = await this.ownerSql<{ id: string }[]>`
          select id from auth.sessions
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
               or email_hash = ${hashSensitive(this.email, this.pepper)}
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
            delete from auth.sessions where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from public.member_modules
            where membership_id = ${this.membershipId}::uuid
          `
          await transaction.unsafe(
            "lock table public.company_memberships in access exclusive mode",
          )
          const [membershipTrigger] = await transaction<[{ enabled: string }]>`
            select tgenabled as enabled
            from pg_trigger
            where tgrelid = 'public.company_memberships'::regclass
              and tgname = 'protect_last_company_admin'
              and not tgisinternal
          `
          if (membershipTrigger?.enabled !== "O") {
            throw new Error(
              "Membership protection trigger must be enabled before cleanup",
            )
          }
          await transaction.unsafe(
            "alter table public.company_memberships disable trigger protect_last_company_admin",
          )
          await transaction`
            delete from public.company_memberships
            where id = ${this.membershipId}::uuid
          `
          await transaction.unsafe(
            "alter table public.company_memberships enable trigger protect_last_company_admin",
          )
          const [restoredMembershipTrigger] = await transaction<
            [{ enabled: string }]
          >`
            select tgenabled as enabled
            from pg_trigger
            where tgrelid = 'public.company_memberships'::regclass
              and tgname = 'protect_last_company_admin'
              and not tgisinternal
          `
          if (restoredMembershipTrigger?.enabled !== "O") {
            throw new Error("Membership protection trigger was not restored")
          }
          await transaction`
            delete from private.company_storage_usage
            where company_id = ${this.companyId}::uuid
          `
          await transaction`
            delete from public.companies where id = ${this.companyId}::uuid
          `
          await transaction`
            delete from public.profiles where user_id = ${this.userId}::uuid
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
            delete from auth.sessions where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from auth.identities where user_id = ${this.userId}::uuid
          `
          await transaction`
            delete from auth.users where id = ${this.userId}::uuid
          `
        })
      } catch {
        cleanupFailure = true
      }

      try {
        const [residue] = await this.ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users where id = ${this.userId}::uuid)
            + (select count(*) from auth.identities where user_id = ${this.userId}::uuid)
            + (select count(*) from auth.sessions where user_id = ${this.userId}::uuid)
            + (select count(*) from auth.refresh_tokens
               where user_id = ${this.userId}
                  or session_id = any(${sessionIds}::uuid[]))
            + (select count(*) from public.profiles where user_id = ${this.userId}::uuid)
            + (select count(*) from public.company_memberships where user_id = ${this.userId}::uuid)
            + (select count(*) from public.companies where id = ${this.companyId}::uuid)
            + (select count(*) from private.auth_session_controls where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_user_session_cutoffs where user_id = ${this.userId}::uuid)
            + (select count(*) from private.auth_password_operations
               where actor_user_id = ${this.userId}::uuid
                  or target_user_id = ${this.userId}::uuid)
            + (select count(*) from public.audit_events
               where actor_user_id = ${this.userId}::uuid
                  or resource_id = ${this.userId}::uuid)
            + (select count(*) from public.security_events
               where user_id = ${this.userId}::uuid
                  or email_hash = ${hashSensitive(this.email, this.pepper)})
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
      throw new Error("Task 12 E2E cleanup left residue or connections")
    }
  }
}

type WorkerFixtures = { forcedPasswordIdentity: ForcedPasswordIdentity }

export const test = base.extend<object, WorkerFixtures>({
  forcedPasswordIdentity: [
    async ({}, provide, workerInfo) => {
      const fixture = new ForcedPasswordIdentityFixture(
        workerInfo.project.name,
        workerInfo.workerIndex,
      )
      try {
        await fixture.provision()
        await provide(
          Object.freeze({
            clientIp: fixture.clientIp,
            email: fixture.email,
            permanentPassword: fixture.permanentPassword,
            temporaryPassword: fixture.temporaryPassword,
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
