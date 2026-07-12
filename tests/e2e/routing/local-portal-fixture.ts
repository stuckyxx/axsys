import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import { expect, test as base, type Page } from "@playwright/test"
import postgres from "postgres"

import type { Database } from "@/lib/supabase/database.types"
import { createUniqueLocalFixtureClientIp } from "../auth/local-platform-ip"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local E2E environment directly.
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const FIXTURE_ERROR = "Task 15 local portal fixture is unavailable"

function parsedLocalUrl(value: string | undefined): URL {
  if (!value) throw new Error(FIXTURE_ERROR)
  try {
    const url = new URL(value)
    if (
      !LOCAL_HOSTS.has(url.hostname) ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(FIXTURE_ERROR)
    }
    return url
  } catch {
    throw new Error(FIXTURE_ERROR)
  }
}

function localSupabaseUrl(value: string | undefined): string {
  const url = parsedLocalUrl(value)
  if (
    url.protocol !== "http:" ||
    url.port !== "54321" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/"
  ) {
    throw new Error(FIXTURE_ERROR)
  }
  return url.toString()
}

function localDatabaseUrl(value: string | undefined): string {
  const url = parsedLocalUrl(value)
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.port !== "54322" ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    url.pathname !== "/postgres"
  ) {
    throw new Error(FIXTURE_ERROR)
  }
  return url.toString()
}

function secret(value: string | undefined): string {
  if (!value || value.length < 20) throw new Error(FIXTURE_ERROR)
  return value
}

function hashSensitive(value: string, pepper: string): string {
  return createHmac("sha256", pepper)
    .update(value.trim().toLowerCase())
    .digest("hex")
}

export type PortalIdentity = Readonly<{
  clientIp: string
  email: string
  password: string
  userId: string
}>

export type PortalIdentities = Readonly<{
  company: PortalIdentity
  forcedPassword: PortalIdentity
  platform: PortalIdentity
}>

export function monitorPageConsole(page: Page, problems: string[]): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
}

type MutableIdentity = {
  clientIp: string
  email: string
  password: string
  userId: string
}

class LocalPortalFixture {
  private readonly admin
  private readonly applicationName: string
  private readonly databaseUrl: string
  private readonly ownerSql: ReturnType<typeof postgres>
  private readonly pepper: string
  private readonly users: MutableIdentity[] = []
  private companyId = ""
  private membershipId = ""

  constructor(projectName: string, workerIndex: number) {
    const supabaseUrl = localSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
    this.databaseUrl = localDatabaseUrl(process.env.DATABASE_URL)
    this.pepper = secret(process.env.SECURITY_HASH_PEPPER)
    this.applicationName = `axsys-task15-${projectName}-${workerIndex}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/gu, "-")
      .slice(0, 56)
    this.admin = createClient<Database>(
      supabaseUrl,
      secret(process.env.SUPABASE_SECRET_KEY),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
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
        application_name: this.applicationName,
        idle_in_transaction_session_timeout: 10_000,
        lock_timeout: 6_000,
        statement_timeout: 10_000,
      },
    })
  }

  private async createIdentity(label: string): Promise<MutableIdentity> {
    const identity: MutableIdentity = {
      clientIp: createUniqueLocalFixtureClientIp(),
      email: `task15-${randomUUID()}@example.test`,
      password: `Axsys-${randomBytes(28).toString("base64url")}!7a`,
      userId: "",
    }
    const created = await this.admin.auth.admin.createUser({
      email: identity.email,
      password: identity.password,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error("Task 15 identity creation failed")
    }
    identity.userId = created.data.user.id
    this.users.push(identity)
    await this.ownerSql`
      insert into public.profiles (user_id, email, display_name)
      values (${identity.userId}::uuid, ${identity.email}, ${label})
    `
    return identity
  }

  async provision(): Promise<PortalIdentities> {
    const platform = await this.createIdentity("Task 15 Plataforma")
    await this.ownerSql`
      insert into public.platform_roles (user_id)
      values (${platform.userId}::uuid)
    `

    const forcedPassword = await this.createIdentity("Task 15 Senha Provisória")
    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.platform_roles (user_id)
        values (${forcedPassword.userId}::uuid)
      `
      await transaction`
        update public.profiles
        set must_change_password = true,
            temporary_password_expires_at = clock_timestamp() + interval '1 hour'
        where user_id = ${forcedPassword.userId}::uuid
      `
    })

    const company = await this.createIdentity("Task 15 Empresa")
    this.companyId = randomUUID()
    this.membershipId = randomUUID()
    const cnpj = `71${randomInt(0, 1_000_000_000_000)
      .toString()
      .padStart(12, "0")}`
    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.companies (
          id, legal_name, trade_name, cnpj_normalized, contact_email
        ) values (
          ${this.companyId}::uuid,
          'Fornecedor Público Task 15',
          'Fornecedor Task 15',
          ${cnpj},
          ${company.email}
        )
      `
      await transaction`
        insert into public.company_memberships (
          id, company_id, user_id, role
        ) values (
          ${this.membershipId}::uuid,
          ${this.companyId}::uuid,
          ${company.userId}::uuid,
          'company_admin'
        )
      `
      await transaction`
        insert into public.member_modules (company_id, membership_id, module)
        values
          (${this.companyId}::uuid, ${this.membershipId}::uuid, 'administrative'),
          (${this.companyId}::uuid, ${this.membershipId}::uuid, 'financial'),
          (${this.companyId}::uuid, ${this.membershipId}::uuid, 'certificates')
      `
    })

    return Object.freeze({
      company: Object.freeze({ ...company }),
      forcedPassword: Object.freeze({ ...forcedPassword }),
      platform: Object.freeze({ ...platform }),
    })
  }

  async cleanup(): Promise<void> {
    let failed = false
    const userIds = this.users.map(({ userId }) => userId).filter(Boolean)
    const emailHashes = this.users.map(({ email }) =>
      hashSensitive(email, this.pepper),
    )
    const ipHashes = this.users.map(({ clientIp }) =>
      hashSensitive(clientIp, this.pepper),
    )
    const rateHashes = [...emailHashes, ...ipHashes]
    let sessionIds: string[] = []

    if (userIds.length > 0) {
      try {
        const sessions = await this.ownerSql<{ id: string }[]>`
          select id from auth.sessions
          where user_id = any(${userIds}::uuid[])
        `
        sessionIds = sessions.map(({ id }) => id)
        await this.ownerSql.begin(async (transaction) => {
          await transaction`
            delete from private.auth_session_controls
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from auth.refresh_tokens
            where user_id = any(${userIds}::text[])
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from auth.sessions
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`alter table public.audit_events disable trigger audit_events_append_only`
          await transaction`alter table public.security_events disable trigger security_events_append_only`
          await transaction`
            delete from public.audit_events
            where actor_user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from public.security_events
            where user_id = any(${userIds}::uuid[])
               or email_hash = any(${emailHashes}::text[])
               or ip_hash = any(${ipHashes}::text[])
          `
          await transaction`alter table public.audit_events enable trigger audit_events_append_only`
          await transaction`alter table public.security_events enable trigger security_events_append_only`
          await transaction`
            delete from private.rate_limit_buckets
            where key_hash = any(${rateHashes}::text[])
          `
          if (this.membershipId !== "") {
            await transaction`
              alter table public.company_memberships
              disable trigger protect_last_company_admin
            `
            await transaction`
              delete from public.member_modules
              where membership_id = ${this.membershipId}::uuid
            `
            await transaction`
              delete from public.company_memberships
              where id = ${this.membershipId}::uuid
            `
            await transaction`
              alter table public.company_memberships
              enable trigger protect_last_company_admin
            `
          }
          await transaction`
            delete from public.platform_roles
            where user_id = any(${userIds}::uuid[])
          `
          if (this.companyId !== "") {
            await transaction`
              delete from private.company_storage_usage
              where company_id = ${this.companyId}::uuid
            `
            await transaction`
              delete from public.companies where id = ${this.companyId}::uuid
            `
          }
          await transaction`
            delete from public.profiles
            where user_id = any(${userIds}::uuid[])
          `
        })
      } catch {
        failed = true
      }

      for (const userId of userIds) {
        try {
          const deleted = await this.admin.auth.admin.deleteUser(userId, false)
          if (deleted.error) throw deleted.error
        } catch {
          failed = true
          try {
            await this.ownerSql`delete from auth.users where id = ${userId}::uuid`
          } catch {
            failed = true
          }
        }
      }

      try {
        const [residue] = await this.ownerSql<[{ count: number }]>`
          select (
            (select count(*) from auth.users where id = any(${userIds}::uuid[]))
            + (select count(*) from auth.identities where user_id = any(${userIds}::uuid[]))
            + (select count(*) from auth.sessions where user_id = any(${userIds}::uuid[]))
            + (select count(*) from auth.refresh_tokens
               where user_id = any(${userIds}::text[])
                  or session_id = any(${sessionIds}::uuid[]))
            + (select count(*) from public.profiles where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.platform_roles where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.company_memberships where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.auth_session_controls where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.auth_user_session_cutoffs where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.audit_events where actor_user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.security_events
               where user_id = any(${userIds}::uuid[])
                  or email_hash = any(${emailHashes}::text[])
                  or ip_hash = any(${ipHashes}::text[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) failed = true
      } catch {
        failed = true
      }
    }

    try {
      await this.ownerSql.end({ timeout: 2 })
    } catch {
      failed = true
    }
    const verifier = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { application_name: `${this.applicationName}-verify` },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = ${this.applicationName}
      `
      if (connections.count !== 0) failed = true
    } catch {
      failed = true
    } finally {
      await verifier.end({ timeout: 2 })
    }
    if (failed) throw new Error("Task 15 portal fixture cleanup failed")
  }
}

type WorkerFixtures = { portalIdentities: PortalIdentities }
type TestFixtures = { consoleGuard: void }

export const test = base.extend<TestFixtures, WorkerFixtures>({
  consoleGuard: [
    async ({ context, page }, provide) => {
      const problems: string[] = []
      monitorPageConsole(page, problems)
      context.on("page", (openedPage) => monitorPageConsole(openedPage, problems))
      await provide()
      expect(problems).toEqual([])
    },
    { auto: true },
  ],
  portalIdentities: [
    async ({}, provide, workerInfo) => {
      const fixture = new LocalPortalFixture(
        workerInfo.project.name,
        workerInfo.workerIndex,
      )
      try {
        await provide(await fixture.provision())
      } finally {
        await fixture.cleanup()
      }
    },
    { scope: "worker" },
  ],
})

export { expect }
