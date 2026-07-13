import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto"
import { loadEnvFile } from "node:process"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import type { Database } from "@/lib/supabase/database.types"
import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "./local-destructive-urls"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete local test environment directly.
  }
}

const FIXTURE_NAME = "Task 17 adversarial local fixture"
const CSRF_COOKIE_NAME = "__Host-axsys-csrf"

function requireSecret(value: string | undefined): string {
  if (!value || value.length < 20) {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
  return value
}

function uniqueDocumentationIp(): string {
  const bytes = randomBytes(12)
    .toString("hex")
    .match(/.{1,4}/gu)
  if (!bytes || bytes.length !== 6) {
    throw new Error(`${FIXTURE_NAME} is unavailable`)
  }
  const canonicalGroups = bytes.map((group) => {
    const value = Number.parseInt(group, 16)
    return value === 0 ? "1" : value.toString(16)
  })
  return `2001:db8:${canonicalGroups.join(":")}`
}

function uniqueCnpj(): string {
  return `63${randomInt(0, 1_000_000_000_000).toString().padStart(12, "0")}`
}

function hashSensitive(value: string, pepper: string): string {
  return createHmac("sha256", pepper)
    .update(value.trim().toLowerCase())
    .digest("hex")
}

function createFixtureCsrfToken(secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1_000)
  const nonce = randomBytes(32).toString("base64url")
  const payload = `${issuedAt}.${nonce}`
  const signature = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url")
  return `${payload}.${signature}`
}

export type AdversarialCookieJar = Map<string, string>

export function cookieStoreForAdversarialJar(jar: AdversarialCookieJar) {
  return {
    delete: (name: string | { name: string }) =>
      jar.delete(typeof name === "string" ? name : name.name),
    get: (name: string) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string | { name: string; value: string }, value?: string) => {
      const cookieName = typeof name === "string" ? name : name.name
      const cookieValue = typeof name === "string" ? (value ?? "") : name.value
      if (cookieValue === "") jar.delete(cookieName)
      else jar.set(cookieName, cookieValue)
    },
  }
}

export type AdversarialIdentity = Readonly<{
  clientIp: string
  companyId: string | null
  displayName: string
  email: string
  jar: AdversarialCookieJar
  membershipId: string | null
  password: string
  userId: string
}>

type MutableIdentity = {
  clientIp: string
  companyId: string | null
  displayName: string
  email: string
  jar: AdversarialCookieJar
  membershipId: string | null
  password: string
  userId: string
}

export type PasswordSecurityState = Readonly<{
  activeSessionCount: number
  encryptedPasswordFingerprint: string
  operationCount: number
  revokedSessionCount: number
  sessionCutoff: string | null
  temporaryPasswordExpiresAt: string | null
  mustChangePassword: boolean
}>

export class AdversarialLocalFixture {
  readonly adminA: MutableIdentity
  readonly memberA: MutableIdentity
  readonly adminB: MutableIdentity
  readonly platform: MutableIdentity
  readonly companyAId = randomUUID()
  readonly companyBId = randomUUID()
  readonly companyAName = `Task 17 Empresa A ${randomUUID()}`
  readonly companyBName = `Task 17 Empresa B ${randomUUID()}`
  readonly supabaseUrl: string

  private readonly admin
  private readonly applicationName: string
  private readonly csrfSecret: string
  private readonly databaseUrl: string
  private readonly identities: MutableIdentity[]
  private readonly ownerSql: ReturnType<typeof postgres>
  private readonly pepper: string
  private readonly rawRateKeys = new Set<string>()
  private readonly correlationIds = new Set<string>()
  private created = false

  constructor(scope: string = randomUUID()) {
    this.supabaseUrl = requireLocalHttpUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "54321",
      FIXTURE_NAME,
    )
    this.databaseUrl = requireLocalOwnerDatabaseUrl(
      process.env.DATABASE_URL,
      FIXTURE_NAME,
    )
    this.csrfSecret = requireSecret(process.env.CSRF_SECRET)
    this.pepper = requireSecret(process.env.SECURITY_HASH_PEPPER)
    this.applicationName = `axsys-task17-${scope}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/gu, "-")
      .slice(0, 63)

    this.adminA = this.identity("Administrador A", this.companyAId)
    this.memberA = this.identity("Membro A", this.companyAId)
    this.adminB = this.identity("Administrador B", this.companyBId)
    this.platform = this.identity("Super Admin", null)
    this.identities = [this.adminA, this.memberA, this.adminB, this.platform]

    this.admin = createClient<Database>(
      this.supabaseUrl,
      requireSecret(process.env.SUPABASE_SECRET_KEY),
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
      max: 2,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 20,
      connection: {
        application_name: this.applicationName,
        idle_in_transaction_session_timeout: 12_000,
        lock_timeout: 8_000,
        statement_timeout: 15_000,
      },
    })
  }

  private identity(label: string, companyId: string | null): MutableIdentity {
    const token = randomUUID()
    return {
      clientIp: uniqueDocumentationIp(),
      companyId,
      displayName: `Task 17 ${label} ${token}`,
      email: `task17-${label.toLowerCase().replaceAll(" ", "-")}-${token}@example.test`,
      jar: new Map(),
      membershipId: companyId === null ? null : randomUUID(),
      password: `Axsys-${randomBytes(28).toString("base64url")}!7a`,
      userId: "",
    }
  }

  async create(): Promise<void> {
    if (this.created)
      throw new Error("Task 17 adversarial fixture already exists")
    this.created = true

    for (const identity of this.identities) {
      this.trackRateKey(identity.clientIp)
      this.trackRateKey(identity.email)
      const result = await this.admin.auth.admin.createUser({
        email: identity.email,
        email_confirm: true,
        password: identity.password,
      })
      if (result.error || !result.data.user) {
        throw new Error("Task 17 adversarial identity creation failed")
      }
      identity.userId = result.data.user.id
    }

    this.trackRateKey(`${this.adminA.userId}:${this.companyAId}`)
    for (const membershipId of [
      this.adminA.membershipId,
      this.memberA.membershipId,
      this.adminB.membershipId,
    ]) {
      if (membershipId !== null) {
        this.trackRateKey(`${this.adminA.userId}:${membershipId}`)
        this.trackRateKey(`${this.platform.userId}:${membershipId}`)
      }
    }

    await this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.profiles (user_id, email, display_name)
        values
          (${this.adminA.userId}::uuid, ${this.adminA.email}, ${this.adminA.displayName}),
          (${this.memberA.userId}::uuid, ${this.memberA.email}, ${this.memberA.displayName}),
          (${this.adminB.userId}::uuid, ${this.adminB.email}, ${this.adminB.displayName}),
          (${this.platform.userId}::uuid, ${this.platform.email}, ${this.platform.displayName})
      `
      await transaction`
        insert into public.companies (
          id, legal_name, trade_name, cnpj_normalized, contact_email
        ) values
          (${this.companyAId}::uuid, ${this.companyAName}, ${this.companyAName},
           ${uniqueCnpj()}, ${this.adminA.email}),
          (${this.companyBId}::uuid, ${this.companyBName}, ${this.companyBName},
           ${uniqueCnpj()}, ${this.adminB.email})
      `
      await transaction`
        insert into public.company_memberships (
          id, company_id, user_id, role
        ) values
          (${this.adminA.membershipId}::uuid, ${this.companyAId}::uuid,
           ${this.adminA.userId}::uuid, 'company_admin'),
          (${this.memberA.membershipId}::uuid, ${this.companyAId}::uuid,
           ${this.memberA.userId}::uuid, 'member'),
          (${this.adminB.membershipId}::uuid, ${this.companyBId}::uuid,
           ${this.adminB.userId}::uuid, 'company_admin')
      `
      await transaction`
        insert into public.company_settings(company_id,updated_by)
        values
          (${this.companyAId}::uuid,${this.adminA.userId}::uuid),
          (${this.companyBId}::uuid,${this.adminB.userId}::uuid)
      `
      await transaction`
        insert into public.member_modules (company_id, membership_id, module)
        values
          (${this.companyAId}::uuid, ${this.adminA.membershipId}::uuid, 'administrative'),
          (${this.companyAId}::uuid, ${this.memberA.membershipId}::uuid, 'administrative'),
          (${this.companyAId}::uuid, ${this.memberA.membershipId}::uuid, 'financial'),
          (${this.companyAId}::uuid, ${this.memberA.membershipId}::uuid, 'certificates'),
          (${this.companyBId}::uuid, ${this.adminB.membershipId}::uuid, 'administrative'),
          (${this.companyBId}::uuid, ${this.adminB.membershipId}::uuid, 'financial'),
          (${this.companyBId}::uuid, ${this.adminB.membershipId}::uuid, 'certificates')
      `
      await transaction`
        insert into public.platform_roles (user_id)
        values (${this.platform.userId}::uuid)
      `
    })
  }

  issueCsrf(jar: AdversarialCookieJar): string {
    const token = createFixtureCsrfToken(this.csrfSecret)
    jar.set(CSRF_COOKIE_NAME, token)
    return token
  }

  async adoptProvisionedCompanyIdentity(input: {
    clientIp: string
    email: string
    password: string
  }): Promise<AdversarialIdentity> {
    const rows = await this.ownerSql<
      { displayName: string; membershipId: string; userId: string }[]
    >`
      select profile.display_name as "displayName",
             membership.id as "membershipId",
             profile.user_id as "userId"
      from public.profiles profile
      join public.company_memberships membership
        on membership.user_id = profile.user_id
       and membership.company_id = ${this.companyAId}::uuid
      where profile.email = ${input.email.trim().toLowerCase()}
    `
    if (
      rows.length !== 1 ||
      this.identities.some(({ userId }) => userId === rows[0]?.userId)
    ) {
      throw new Error("Task 10 provisioned identity adoption failed")
    }
    const row = rows[0]
    const identity: MutableIdentity = {
      clientIp: input.clientIp,
      companyId: this.companyAId,
      displayName: row.displayName,
      email: input.email.trim().toLowerCase(),
      jar: new Map(),
      membershipId: row.membershipId,
      password: input.password,
      userId: row.userId,
    }
    this.identities.push(identity)
    this.trackRateKey(identity.clientIp)
    this.trackRateKey(identity.email)
    this.trackRateKey(`${this.adminA.userId}:${identity.membershipId}`)
    this.trackRateKey(`${this.platform.userId}:${identity.membershipId}`)
    return Object.freeze({ ...identity })
  }

  nextCorrelationId(): string {
    const id = randomUUID()
    this.correlationIds.add(id)
    return id
  }

  trackRateKey(rawKey: string): void {
    if (rawKey.length > 0) this.rawRateKeys.add(rawKey)
  }

  async passwordSecurityState(userId: string): Promise<PasswordSecurityState> {
    const [row] = await this.ownerSql<
      [
        {
          activeSessionCount: number
          encryptedPassword: string
          mustChangePassword: boolean
          operationCount: number
          revokedSessionCount: number
          sessionCutoff: Date | null
          temporaryPasswordExpiresAt: Date | null
        },
      ]
    >`
      select auth_user.encrypted_password as "encryptedPassword",
             profile.must_change_password as "mustChangePassword",
             profile.temporary_password_expires_at as "temporaryPasswordExpiresAt",
             (select count(*)::integer
              from private.auth_session_controls control
              where control.user_id = profile.user_id
                and control.state = 'active') as "activeSessionCount",
             (select count(*)::integer
              from private.auth_session_controls control
              where control.user_id = profile.user_id
                and control.state = 'revoked') as "revokedSessionCount",
             (select cutoff.revoked_before
              from private.auth_user_session_cutoffs cutoff
              where cutoff.user_id = profile.user_id) as "sessionCutoff",
             (select count(*)::integer
              from private.auth_password_operations operation
              where operation.target_user_id = profile.user_id) as "operationCount"
      from public.profiles profile
      join auth.users auth_user on auth_user.id = profile.user_id
      where profile.user_id = ${userId}::uuid
    `
    if (!row) throw new Error("Task 17 password state is unavailable")
    return Object.freeze({
      activeSessionCount: row.activeSessionCount,
      encryptedPasswordFingerprint: createHmac("sha256", this.pepper)
        .update("axsys-test-password-hash\0", "utf8")
        .update(row.encryptedPassword, "utf8")
        .digest("hex"),
      mustChangePassword: row.mustChangePassword,
      operationCount: row.operationCount,
      revokedSessionCount: row.revokedSessionCount,
      sessionCutoff: row.sessionCutoff?.toISOString() ?? null,
      temporaryPasswordExpiresAt:
        row.temporaryPasswordExpiresAt?.toISOString() ?? null,
    })
  }

  async contractClosureEvidence(contractId: string): Promise<
    Readonly<{
      actorUserId: string
      auditCount: number
      closeReason: string
      closed: boolean
    }>
  > {
    const [row] = await this.ownerSql<
      [
        {
          actorUserId: string
          auditCount: number
          closeReason: string
          closed: boolean
        },
      ]
    >`
      select contract.closed_by as "actorUserId",
             contract.close_reason as "closeReason",
             (contract.closed_at is not null) as closed,
             (select count(*)::integer
                from public.audit_events event
               where event.company_id = contract.company_id
                 and event.action = 'contract.closed'
                 and event.resource_id = contract.id) as "auditCount"
        from public.contracts contract
       where contract.company_id = ${this.companyAId}::uuid
         and contract.id = ${contractId}::uuid
    `
    if (!row || !row.actorUserId || !row.closeReason) {
      throw new Error("Contract closure evidence is unavailable")
    }
    return Object.freeze(row)
  }

  async seedSyntheticContractAttachment(contractId: string): Promise<void> {
    await this.ownerSql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`
      await transaction`
        insert into public.contract_attachments (
          company_id,
          contract_id,
          file_object_id,
          attachment_group_id,
          version,
          created_by
        ) values (
          ${this.companyAId}::uuid,
          ${contractId}::uuid,
          ${randomUUID()}::uuid,
          ${randomUUID()}::uuid,
          1,
          ${this.adminA.userId}::uuid
        )
      `
    })
  }

  async seedContractsForPagination(
    clientId: string,
    count: number,
    numberPrefix: string,
  ): Promise<string[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new Error("Contract pagination seed count is invalid")
    }
    const rows = await this.ownerSql<{ id: string }[]>`
      insert into public.contracts (
        company_id, client_id, number, object, starts_on, ends_on,
        amount, created_by, updated_by
      )
      select
        ${this.companyAId}::uuid,
        ${clientId}::uuid,
        ${numberPrefix} || lpad((series.value - 1)::text, 3, '0'),
        'Pagination seed contract ' || series.value,
        '2026-01-01'::date,
        '2027-01-01'::date + ((series.value - 1) / 3)::integer,
        12500,
        ${this.adminA.userId}::uuid,
        ${this.adminA.userId}::uuid
      from generate_series(1, ${count}) series(value)
      returning id
    `
    if (rows.length !== count) {
      throw new Error("Contract pagination seed failed")
    }
    return rows.map(({ id }) => id)
  }

  async contractPrefixSearchPlan(): Promise<string> {
    const token = randomUUID().replaceAll("-", "")
    const targetPrefix = `plan-target-${token}-`
    const bulkPrefix = `plan-bulk-${token}-`
    const targetObjectPrefix = `object-target-${token}-`
    const bulkObjectPrefix = `object-bulk-${token}-`
    return this.ownerSql.begin(async (transaction) => {
      await transaction`
        insert into public.contracts (
          company_id, client_id, number, object, starts_on, ends_on,
          amount, created_by, updated_by
        )
        select
          ${this.companyAId}::uuid,
          client.id,
          case
            when series.value <= 20
              then ${targetPrefix} || lpad(series.value::text, 5, '0')
            else ${bulkPrefix} || lpad(series.value::text, 5, '0')
          end,
          case
            when series.value <= 20
              then ${targetObjectPrefix} || lpad(series.value::text, 5, '0')
            else ${bulkObjectPrefix} || lpad(series.value::text, 5, '0')
          end,
          '2026-01-01'::date,
          '2027-01-01'::date + (series.value % 300),
          100,
          ${this.adminA.userId}::uuid,
          ${this.adminA.userId}::uuid
        from public.clients client
        cross join generate_series(1, 20000) series(value)
        where client.company_id = ${this.companyAId}::uuid
        limit 20000
      `
      await transaction`analyze public.contracts`
      const numberPlan = await transaction<Record<string, unknown>[]>`
        explain (analyze, buffers, format json)
        select id
        from public.contract_search_rows
        where company_id = ${this.companyAId}::uuid
          and number_prefix like ${`${targetPrefix.toLocaleLowerCase("pt-BR")}%`}
        order by ends_on, id
        limit 25
      `
      const objectPlan = await transaction<Record<string, unknown>[]>`
        explain (analyze, buffers, format json)
        select id
        from public.contract_search_rows
        where company_id = ${this.companyAId}::uuid
          and object_prefix like ${`${targetObjectPrefix.toLocaleLowerCase("pt-BR")}%`}
        order by ends_on, id
        limit 25
      `
      await transaction`
        delete from public.contracts
        where company_id = ${this.companyAId}::uuid
          and (number like ${`${targetPrefix}%`} or number like ${`${bulkPrefix}%`})
      `
      await transaction`analyze public.contracts`
      return JSON.stringify({ numberPlan, objectPlan })
    })
  }

  async suspendMembership(identity: AdversarialIdentity): Promise<void> {
    if (!identity.membershipId || !identity.companyId) {
      throw new Error("Task 17 membership suspension target is invalid")
    }
    const rows = await this.ownerSql<{ id: string }[]>`
      update public.company_memberships
      set status = 'suspended',
          suspended_at = clock_timestamp(),
          suspended_by = ${this.adminA.userId}::uuid,
          suspension_reason = 'Adversarial session revocation test'
      where id = ${identity.membershipId}::uuid
        and company_id = ${identity.companyId}::uuid
        and user_id = ${identity.userId}::uuid
        and status = 'active'
      returning id
    `
    if (rows.length !== 1 || rows[0]?.id !== identity.membershipId) {
      throw new Error("Task 17 membership suspension failed")
    }
  }

  async cleanup(): Promise<void> {
    const userIds = this.identities.map(({ userId }) => userId).filter(Boolean)
    const membershipIds = this.identities
      .map(({ membershipId }) => membershipId)
      .filter((value): value is string => value !== null)
    const companyIds = [this.companyAId, this.companyBId]
    const emailHashes = this.identities.map(({ email }) =>
      hashSensitive(email, this.pepper),
    )
    const ipHashes = this.identities.map(({ clientIp }) =>
      hashSensitive(clientIp, this.pepper),
    )
    const rateHashes = [...this.rawRateKeys].map((value) =>
      hashSensitive(value, this.pepper),
    )
    const correlationIds = [...this.correlationIds]
    const sessionIds: string[] = []
    let failure: unknown

    if (userIds.length > 0) {
      try {
        const sessions = await this.ownerSql<{ id: string }[]>`
          select id from auth.sessions where user_id = any(${userIds}::uuid[])
        `
        sessionIds.push(...sessions.map(({ id }) => id))
      } catch (error) {
        failure ??= error
      }

      try {
        await this.ownerSql.begin(async (transaction) => {
          await transaction`select pg_advisory_xact_lock(hashtext('axsys-task17-cleanup'))`
          await transaction`set local session_replication_role = replica`
          await transaction`
            delete from public.idempotency_keys
            where actor_user_id = any(${userIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.audit_events
            where actor_user_id = any(${userIds}::uuid[])
               or resource_id = any(${userIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
               or correlation_id = any(${correlationIds}::uuid[])
          `
          await transaction`
            delete from public.security_events
            where user_id = any(${userIds}::uuid[])
               or email_hash = any(${emailHashes}::text[])
               or ip_hash = any(${ipHashes}::text[])
               or correlation_id = any(${correlationIds}::uuid[])
          `
          await transaction`
            delete from private.password_recovery_grants
            where user_id = any(${userIds}::uuid[])
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from private.auth_password_operations
            where actor_user_id = any(${userIds}::uuid[])
               or target_user_id = any(${userIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from private.rate_limit_buckets
            where key_hash = any(${rateHashes}::text[])
          `
          await transaction`
            delete from private.auth_session_controls
            where user_id = any(${userIds}::uuid[])
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from private.auth_user_session_cutoffs
            where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from private.member_auth_access_reconciliations
            where target_user_id = any(${userIds}::uuid[])
               or membership_id = any(${membershipIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.provisioning_operations
            where actor_user_id = any(${userIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
               or auth_user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from public.generated_documents
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from private.generated_document_orphan_cleanup
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.contract_attachments
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.proposal_items
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.proposals
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.contracts
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.company_settings_drafts
            where company_id = any(${companyIds}::uuid[])
               or user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from public.company_settings
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.company_bank_accounts
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.file_upload_intents
            where company_id = any(${companyIds}::uuid[])
               or actor_user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from public.file_objects
            where company_id = any(${companyIds}::uuid[])
               or created_by = any(${userIds}::uuid[])
               or owner_user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from public.clients
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.catalog_items
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from private.proposal_number_counters
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.member_modules
            where membership_id = any(${membershipIds}::uuid[])
          `
          await transaction`
            delete from public.company_memberships
            where user_id = any(${userIds}::uuid[])
               or company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.platform_roles where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from private.company_storage_usage
            where company_id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.companies where id = any(${companyIds}::uuid[])
          `
          await transaction`
            delete from public.profiles where user_id = any(${userIds}::uuid[])
          `
        })
      } catch (error) {
        failure ??= error
      }

      for (const userId of userIds) {
        try {
          const deleted = await this.admin.auth.admin.deleteUser(userId, false)
          if (deleted.error) throw new Error("Task 17 Auth cleanup failed")
        } catch (error) {
          failure ??= error
        }
      }

      try {
        await this.ownerSql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`
          await transaction`
            delete from auth.refresh_tokens
            where user_id = any(${userIds}::text[])
               or session_id = any(${sessionIds}::uuid[])
          `
          await transaction`
            delete from auth.sessions where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from auth.identities where user_id = any(${userIds}::uuid[])
          `
          await transaction`
            delete from auth.users where id = any(${userIds}::uuid[])
          `
        })
      } catch (error) {
        failure ??= error
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
            + (select count(*) from public.member_modules where membership_id = any(${membershipIds}::uuid[]))
            + (select count(*) from public.companies where id = any(${companyIds}::uuid[]))
            + (select count(*) from private.company_storage_usage
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from private.auth_session_controls where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.auth_user_session_cutoffs where user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.member_auth_access_reconciliations
               where target_user_id = any(${userIds}::uuid[])
                  or membership_id = any(${membershipIds}::uuid[])
                  or company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.provisioning_operations
               where actor_user_id = any(${userIds}::uuid[])
                  or company_id = any(${companyIds}::uuid[])
                  or auth_user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.generated_documents
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from private.generated_document_orphan_cleanup
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.contract_attachments
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.proposal_items
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.proposals
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.contracts
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.company_settings_drafts
               where company_id = any(${companyIds}::uuid[])
                  or user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.company_settings
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.company_bank_accounts
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.file_upload_intents
               where company_id = any(${companyIds}::uuid[])
                  or actor_user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.file_objects
               where company_id = any(${companyIds}::uuid[])
                  or created_by = any(${userIds}::uuid[])
                  or owner_user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.clients
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.catalog_items
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from private.proposal_number_counters
               where company_id = any(${companyIds}::uuid[]))
            + (select count(*) from private.auth_password_operations
               where actor_user_id = any(${userIds}::uuid[])
                  or target_user_id = any(${userIds}::uuid[]))
            + (select count(*) from private.password_recovery_grants where user_id = any(${userIds}::uuid[]))
            + (select count(*) from public.audit_events
               where actor_user_id = any(${userIds}::uuid[])
                  or company_id = any(${companyIds}::uuid[]))
            + (select count(*) from public.security_events
               where user_id = any(${userIds}::uuid[])
                  or email_hash = any(${emailHashes}::text[])
                  or ip_hash = any(${ipHashes}::text[]))
            + (select count(*) from private.rate_limit_buckets
               where key_hash = any(${rateHashes}::text[]))
          )::integer as count
        `
        if (residue.count !== 0) {
          failure ??= new Error("Task 17 adversarial fixture left residue")
        }
      } catch (error) {
        failure ??= error
      }
    }

    for (const identity of this.identities) identity.jar.clear()
    try {
      await this.ownerSql.end({ timeout: 2 })
    } catch (error) {
      failure ??= error
    }

    const verifier = postgres(this.databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: {
        application_name: `${this.applicationName}-verify`.slice(0, 63),
        statement_timeout: 5_000,
      },
    })
    try {
      const [connections] = await verifier<[{ count: number }]>`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name = ${this.applicationName}
      `
      if (connections.count !== 0) {
        failure ??= new Error("Task 17 adversarial fixture left connections")
      }
    } catch (error) {
      failure ??= error
    } finally {
      await verifier.end({ timeout: 2 })
    }

    if (failure) throw new Error("Task 17 adversarial fixture cleanup failed")
  }
}
