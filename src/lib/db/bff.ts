import "server-only"

import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"
import { z } from "@/lib/validation/zod"
import type {
  FileFinalizationState,
  FileObject,
  ImageDownloadAuthorization,
  UploadReservationDTO,
} from "@/modules/files/domain/file-types"

const BFF_DATABASE_FAILURE = "BFF database unavailable"
const BFF_METADATA_FAILURE = "Invalid BFF metadata"
const MAX_JSON_DEPTH = 12
const MAX_JSON_NODES = 1_000
let bffSql: Promise<Sql> | undefined

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject

type JsonObject = Readonly<{ [key: string]: JsonValue }>
type JsonGuardState = { readonly seen: WeakSet<object>; nodes: number }

function consumeJsonNode(state: JsonGuardState, value: object): boolean {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODES || state.seen.has(value)) return false
  state.seen.add(value)
  return true
}

function isJsonValue(
  value: unknown,
  state: JsonGuardState,
  depth: number,
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || depth > MAX_JSON_DEPTH) return false
  if (!consumeJsonNode(state, value)) return false

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, state, depth + 1))
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(value).every((entry) =>
    isJsonValue(entry, state, depth + 1),
  )
}

function toJsonObject(metadata: Record<string, unknown>): JsonObject {
  const state: JsonGuardState = { seen: new WeakSet(), nodes: 0 }
  if (
    Array.isArray(metadata) ||
    !isJsonValue(metadata, state, 0)
  ) {
    throw new Error(BFF_METADATA_FAILURE)
  }
  return metadata
}

async function createVerifiedSql(): Promise<Sql> {
  const sql = postgres(getServerEnv().BFF_DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "axsys-bff" },
  })
  try {
    const [identity] = await sql<[{ valid: boolean }]>`
      select current_user = 'axsys_bff' as valid
    `
    if (identity?.valid !== true) {
      throw new Error(BFF_DATABASE_FAILURE)
    }
    return sql
  } catch {
    try {
      await sql.end()
    } catch {
      // The fixed outward error remains independent of driver and connection details.
    }
    throw new Error(BFF_DATABASE_FAILURE)
  }
}

async function getSql(): Promise<Sql> {
  bffSql ??= createVerifiedSql()
  return bffSql
}

function toSafeInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(BFF_DATABASE_FAILURE)
  }
  return parsed
}

type CancellableQuery<T> = PromiseLike<T> & { cancel(): void }

async function executeCancellableQuery<T>(
  pending: CancellableQuery<T>,
  signal: AbortSignal,
): Promise<T> {
  const cancel = () => pending.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    return await pending
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

export type RateLimitDecision = {
  allowed: boolean
  attempts: number
  retryAfterSeconds: number
}

type ImageUploadPurpose =
  | "profile_avatar"
  | "company_letterhead"
  | "company_signature"

type UploadAuthorization = {
  uploadAuthorizationExpiresAt: string
  finalizeBefore: string
}

type CompanyUserDirectoryEntry = {
  membershipId: string
  userId: string
  displayName: string
  email: string
  role: "company_admin" | "member"
  status: "active" | "suspended"
  modules: ("administrative" | "financial" | "certificates")[]
  version: number
  createdAt: string
}

type RetirementStatus =
  | "issued"
  | "finalizing"
  | "ready"
  | "rejected"
  | "expired"
  | "cleanup_required"

export type UploadAuthorizationRetirementClaim = {
  intentId: string
  quarantineObjectPath: string
  retirementStatus: RetirementStatus
  claimId: string
  expectedVersion: number
}

export type UploadAuthorizationRetirementCompletion = {
  intentId: string
  status: RetirementStatus
  releasedBytes: number
  version: number
  authorizationRetiredAt: string
}

export type CompanyProvisioningOperationSnapshot = {
  id: string
  status:
    | "reserved"
    | "auth_created"
    | "committed"
    | "compensated"
    | "compensation_required"
  authUserId: string | null
}

export type ProvisionedCompanySnapshot = {
  company: { id: string; status: "active" }
  membership: { id: string; role: "company_admin" }
  modules: ("administrative" | "financial" | "certificates")[]
}

export type ManagedCompanySnapshot = {
  id: string
  legalName: string
  tradeName: string | null
  cnpj: string
  contactEmail: string
  contactPhone: string | null
  timezone: string
  status: "active" | "archived"
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CompanyListSnapshot = Omit<ManagedCompanySnapshot, "archivedAt">

export type CompanyDetailSnapshot = {
  company: CompanyListSnapshot
  admins: Array<{
    id: string
    membershipId: string
    targetUserId: string
    displayName: string
    email: string
    role: "company_admin"
    status: "active" | "suspended"
    modules: ("administrative" | "financial" | "certificates")[]
    version: number
    mustChangePassword: boolean
    temporaryPasswordExpiresAt: string | null
    accessState:
      | "active"
      | "suspended"
      | "password_change_required"
      | "archived_company"
  }>
  bankAccounts: Array<{
    id: string
    bankCode: string
    bankName: string
    branchLast4: string
    accountLast4: string
    accountType: "checking" | "savings" | "payment"
    isDefault: boolean
    status: "active" | "archived"
    version: number
  }>
  counters: {
    activeAdmins: number
    activeUsers: number
    bankAccounts: number
  }
}

export type ManagedCompanyUserSnapshot = {
  membershipId: string
  targetUserId: string
  displayName: string
  email: string
  role: "company_admin" | "member"
  status: "active" | "suspended"
  modules: ("administrative" | "financial" | "certificates")[]
  version: number
  mustChangePassword: boolean
  temporaryPasswordExpiresAt: string | null
  accessState: string
}

export type BankAccountSummarySnapshot = {
  id: string
  companyId: string
  bankCode: string
  bankName: string
  maskedBranch: string
  maskedAccount: string
  accountType: "checking" | "savings" | "payment"
  holderName: string
  maskedHolderDocument: string | null
  status: "active" | "archived"
  isDefault: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export type PlatformAuditEventSnapshot = {
  id: string
  actorUserId: string
  action: string
  resourceType: string
  resourceId: string | null
  outcome: "success" | "denied" | "failure"
  reasonCode: string | null
  correlationId: string
  metadata: Record<string, unknown>
  occurredAt: string
}

export type PlatformHealthSnapshot = {
  checkedAt: string
  pendingCompensations: number
  pendingCompanyAccessReconciliations: number
  pendingMemberAccessReconciliations: number
  pendingFileCleanup: number
  scanFailures: number
  storageBytes: number
  reservedStorageBytes: number
  companiesNearQuota: number
  quotaDriftAlerts: number
}

export type PlatformAdminSnapshot = {
  membershipId: string
  companyId: string
  companyLegalName: string
  displayName: string
  email: string
  status: "active" | "suspended"
  modules: ("administrative" | "financial" | "certificates")[]
  createdAt: string
  version: number
  mustChangePassword: boolean
  temporaryPasswordExpiresAt: string | null
  accessState:
    | "active"
    | "suspended"
    | "password_change_required"
    | "archived_company"
}

export type PlatformDashboardSnapshot = {
  checkedAt: string
  activeCompanies: number
  archivedCompanies: number
  activeAdmins: number
  activeUsers: number
  activeBankAccounts: number
  archivedBankAccounts: number
  pendingCompensations: number
  pendingCompanyAccessReconciliations: number
  pendingMemberAccessReconciliations: number
}

export type OwnProfileSnapshot = {
  userId: string
  email: string
  displayName: string
  preferredTheme: "dark" | "light"
  avatarFileId: string | null
  version: number
}

const companyListSnapshotSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(2).max(160),
    tradeName: z.string().min(2).max(180).nullable(),
    cnpj: z.string().regex(/^\d{14}$/u),
    contactEmail: z.email().max(254),
    contactPhone: z.string().min(8).max(32).nullable(),
    timezone: z.string().min(1).max(255),
    status: z.enum(["active", "archived"]),
    version: z.int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const managedCompanySnapshotSchema = companyListSnapshotSchema
  .extend({ archivedAt: z.iso.datetime({ offset: true }).nullable() })
  .strict()

const companyDetailSnapshotSchema = z
  .object({
    company: companyListSnapshotSchema,
    admins: z.array(
      z
        .object({
          id: z.uuid(),
          membershipId: z.uuid(),
          targetUserId: z.uuid(),
          displayName: z.string().min(2).max(120),
          email: z.email().max(254),
          role: z.literal("company_admin"),
          status: z.enum(["active", "suspended"]),
          modules: z.array(
            z.enum(["administrative", "financial", "certificates"]),
          ),
          version: z.int().positive(),
          mustChangePassword: z.boolean(),
          temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable(),
          accessState: z.enum([
            "active",
            "suspended",
            "password_change_required",
            "archived_company",
          ]),
        })
        .strict(),
    ),
    bankAccounts: z.array(
      z
        .object({
          id: z.uuid(),
          bankCode: z.string().min(1).max(20),
          bankName: z.string().min(2).max(120),
          branchLast4: z.string().regex(/^\d{1,4}$/u),
          accountLast4: z.string().regex(/^\d{1,4}$/u),
          accountType: z.enum(["checking", "savings", "payment"]),
          isDefault: z.boolean(),
          status: z.literal("active"),
          version: z.int().positive(),
        })
        .strict(),
    ),
    counters: z
      .object({
        activeAdmins: z.int().nonnegative(),
        activeUsers: z.int().nonnegative(),
        bankAccounts: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict()

const reconciliationSnapshotSchema = z
  .object({
    reconciliationId: z.uuid(),
    status: z.enum(["complete", "pending"]),
    failedUserIds: z.array(z.uuid()),
    attemptCount: z.int().nonnegative(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const memberAuthAccessReconciliationSchema = z
  .object({
    status: z.enum(["pending", "completed"]),
    desiredState: z.enum(["active", "banned"]),
    attemptCount: z.int().nonnegative(),
  })
  .strict()

const provisioningOperationSnapshotSchema = z
  .object({
    id: z.uuid(),
    status: z.enum([
      "reserved",
      "auth_created",
      "committed",
      "compensated",
      "compensation_required",
    ]),
    authUserId: z.uuid().nullable(),
  })
  .strict()

const managedCompanyUserSnapshotSchema = z
  .object({
    membershipId: z.uuid(),
    targetUserId: z.uuid(),
    displayName: z.string().min(2).max(120),
    email: z.email().max(254),
    role: z.enum(["company_admin", "member"]),
    status: z.enum(["active", "suspended"]),
    modules: z.array(z.enum(["administrative", "financial", "certificates"])),
    version: z.int().positive(),
    mustChangePassword: z.boolean(),
    temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    accessState: z.enum([
      "active",
      "suspended",
      "password_change_required",
      "archived_company",
    ]),
  })
  .strict()

const companyUserDirectoryEntrySchema = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    displayName: z.string().min(2).max(120),
    email: z.email().max(254),
    role: z.enum(["company_admin", "member"]),
    status: z.enum(["active", "suspended"]),
    modules: z.array(z.enum(["administrative", "financial", "certificates"])),
    version: z.int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const bankAccountSummarySnapshotSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    bankCode: z.string().regex(/^\d{3,8}$/u),
    bankName: z.string().min(2).max(120),
    maskedBranch: z.string().min(1).max(4),
    maskedAccount: z.string().min(1).max(4),
    accountType: z.enum(["checking", "savings", "payment"]),
    holderName: z.string().min(2).max(160),
    maskedHolderDocument: z.string().min(5).max(8).nullable(),
    status: z.enum(["active", "archived"]),
    isDefault: z.boolean(),
    version: z.int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const auditMetadataSchema = z.record(z.string(), z.unknown())

const platformAuditEventSnapshotSchema = z
  .object({
    id: z.uuid(),
    actorUserId: z.uuid(),
    action: z.string().min(3).max(128),
    resourceType: z.string().min(1).max(64),
    resourceId: z.uuid().nullable(),
    outcome: z.enum(["success", "denied", "failure"]),
    reasonCode: z.string().min(1).max(128).nullable(),
    correlationId: z.uuid(),
    metadata: auditMetadataSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const platformHealthSnapshotSchema = z
  .object({
    checkedAt: z.iso.datetime({ offset: true }),
    pendingCompensations: z.int().nonnegative(),
    pendingCompanyAccessReconciliations: z.int().nonnegative(),
    pendingMemberAccessReconciliations: z.int().nonnegative(),
    pendingFileCleanup: z.int().nonnegative(),
    scanFailures: z.int().nonnegative(),
    storageBytes: z.int().nonnegative(),
    reservedStorageBytes: z.int().nonnegative(),
    companiesNearQuota: z.int().nonnegative(),
    quotaDriftAlerts: z.int().nonnegative(),
  })
  .strict()

const platformAdminSnapshotSchema = z
  .object({
    membershipId: z.uuid(),
    companyId: z.uuid(),
    companyLegalName: z.string().min(2).max(160),
    displayName: z.string().min(2).max(120),
    email: z.email().max(254),
    status: z.enum(["active", "suspended"]),
    modules: z.array(z.enum(["administrative", "financial", "certificates"])),
    createdAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
    mustChangePassword: z.boolean(),
    temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    accessState: z.enum([
      "active",
      "suspended",
      "password_change_required",
      "archived_company",
    ]),
  })
  .strict()

const platformDashboardSnapshotSchema = z
  .object({
    checkedAt: z.iso.datetime({ offset: true }),
    activeCompanies: z.int().nonnegative(),
    archivedCompanies: z.int().nonnegative(),
    activeAdmins: z.int().nonnegative(),
    activeUsers: z.int().nonnegative(),
    activeBankAccounts: z.int().nonnegative(),
    archivedBankAccounts: z.int().nonnegative(),
    pendingCompensations: z.int().nonnegative(),
    pendingCompanyAccessReconciliations: z.int().nonnegative(),
    pendingMemberAccessReconciliations: z.int().nonnegative(),
  })
  .strict()

const ownProfileSnapshotSchema = z
  .object({
    userId: z.uuid(),
    email: z.email().max(254),
    displayName: z.string().min(2).max(120),
    preferredTheme: z.enum(["dark", "light"]),
    avatarFileId: z.uuid().nullable(),
    version: z.int().positive(),
  })
  .strict()

const companySettingsDraftPayloadSchema = z
  .object({
    representativeName: z.string().max(160).nullable(),
    representativeRole: z.string().max(120).nullable(),
    representativeDocumentAction: z.enum(["preserve", "replace", "clear"]),
    representativeDocumentCiphertext: z.string().nullable(),
    representativeDocumentIv: z.string().nullable(),
    representativeDocumentTag: z.string().nullable(),
    representativeDocumentKeyVersion: z.int().positive().nullable(),
    representativeDocumentLast4: z.string().regex(/^\d{4}$/u).nullable(),
    taxRate: z.number().min(0).max(100),
    addressStreet: z.string().max(180).nullable(),
    addressNumber: z.string().max(30).nullable(),
    addressComplement: z.string().max(120).nullable(),
    addressNeighborhood: z.string().max(120).nullable(),
    addressCity: z.string().max(120).nullable(),
    addressState: z.string().length(2).nullable(),
    addressPostalCode: z.string().regex(/^\d{8}$/u).nullable(),
    letterheadFileId: z.uuid().nullable(),
    signatureFileId: z.uuid().nullable(),
  })
  .strict()

const companySettingsSnapshotSchema = z
  .object({
    companyId: z.uuid(),
    representativeName: z.string().max(160).nullable(),
    representativeRole: z.string().max(120).nullable(),
    maskedRepresentativeDocument: z.string().regex(/^••••\d{4}$/u).nullable(),
    taxRate: z.number().min(0).max(100),
    addressStreet: z.string().max(180).nullable(),
    addressNumber: z.string().max(30).nullable(),
    addressComplement: z.string().max(120).nullable(),
    addressNeighborhood: z.string().max(120).nullable(),
    addressCity: z.string().max(120).nullable(),
    addressState: z.string().length(2).nullable(),
    addressPostalCode: z.string().regex(/^\d{8}$/u).nullable(),
    consolidatedAddress: z.string().nullable(),
    letterheadFileId: z.uuid().nullable(),
    signatureFileId: z.uuid().nullable(),
    version: z.int().positive(),
    updatedAt: z.iso.datetime({ offset: true }),
    canEdit: z.boolean(),
    banks: z.array(bankAccountSummarySnapshotSchema),
  })
  .strict()

const companySettingsDraftSnapshotSchema = z
  .object({
    payload: companySettingsDraftPayloadSchema,
    baseVersion: z.int().positive(),
    version: z.int().positive(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type CompanySettingsSnapshot = z.infer<typeof companySettingsSnapshotSchema>
export type CompanySettingsDraftPayload = z.infer<typeof companySettingsDraftPayloadSchema>
export type CompanySettingsDraftSnapshot = z.infer<typeof companySettingsDraftSnapshotSchema>

export const bffDb = {
  async consumeRateLimit(input: {
    bucket: string
    keyHash: string
    limit: number
    windowSeconds: number
    blockSeconds: number
  }): Promise<RateLimitDecision> {
    const sql = await getSql()
    const [row] = await sql<RateLimitDecision[]>`
      select allowed, attempts, retry_after_seconds as "retryAfterSeconds"
      from private.consume_rate_limit(
        ${input.bucket},
        ${input.keyHash},
        ${input.limit},
        ${input.windowSeconds},
        ${input.blockSeconds}
      )
    `
    return row
  },

  async clearRateLimit(
    bucket: "login-account-failure" | "reauth-account-failure",
    keyHash: string,
  ): Promise<void> {
    const sql = await getSql()
    await sql`select private.clear_rate_limit(${bucket}, ${keyHash})`
  },

  async registerAuthSession(
    sessionId: string,
    userId: string,
    rememberMe: boolean,
  ): Promise<string> {
    const sql = await getSql()
    const [row] = await sql<[{ expiresAt: Date }]>`
      select private.register_auth_session(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${rememberMe}
      ) as "expiresAt"
    `
    return row.expiresAt.toISOString()
  },

  async assertAuthSession(sessionId: string, userId: string): Promise<boolean> {
    const sql = await getSql()
    const [row] = await sql<[{ active: boolean }]>`
      select private.assert_auth_session(
        ${sessionId}::uuid,
        ${userId}::uuid
      ) as active
    `
    return row.active
  },

  async writeAuthenticatedAuditEvent(input: {
    actorUserId: string
    sessionId: string
    action: string
    resourceType: string
    resourceId: string | null
    outcome: "success" | "denied" | "failure"
    reasonCode: string | null
    correlationId: string
    ipHash: string | null
    userAgentHash: string | null
    metadata: Record<string, unknown>
  }): Promise<void> {
    const sql = await getSql()
    const metadata = toJsonObject(input.metadata)
    await sql`
      select private.write_authenticated_audit_event(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.action},
        ${input.resourceType},
        ${input.resourceId}::uuid,
        ${input.outcome},
        ${input.reasonCode},
        ${input.correlationId}::uuid,
        ${input.ipHash},
        ${input.userAgentHash},
        ${sql.json(metadata)}::jsonb
      )
    `
  },

  async writeSecurityEvent(input: {
    eventType: string
    emailHash: string | null
    ipHash: string | null
    outcome: "success" | "denied" | "failure"
    reasonCode: string | null
    correlationId: string
    metadata: Record<string, unknown>
  }): Promise<void> {
    const sql = await getSql()
    const metadata = toJsonObject(input.metadata)
    await sql`
      select private.write_security_event(
        ${input.eventType},
        null::uuid,
        ${input.emailHash},
        ${input.ipHash},
        ${input.outcome},
        ${input.reasonCode},
        ${input.correlationId}::uuid,
        ${sql.json(metadata)}::jsonb
      )
    `
  },

  async revokeSessionsAndWriteLogout(input: {
    actorUserId: string
    sessionId: string
    correlationId: string
    ipHash: string | null
    userAgentHash: string | null
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.revoke_sessions_and_write_logout(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.correlationId}::uuid,
        ${input.ipHash},
        ${input.userAgentHash}
      )
    `
  },

  async failClosedLoginSession(input: {
    actorUserId: string
    sessionId: string
    reasonCode: string
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.fail_closed_login_session(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.reasonCode},
        ${input.correlationId}::uuid
      )
    `
  },

  async rotateAppSessionAfterReauthentication(input: {
    actorUserId: string
    oldSessionId: string
    newSessionId: string
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.rotate_app_session_after_reauthentication(
        ${input.actorUserId}::uuid,
        ${input.oldSessionId}::uuid,
        ${input.newSessionId}::uuid,
        ${input.correlationId}::uuid
      )
    `
  },

  async beginTemporaryPasswordReset(input: {
    actorUserId: string
    sessionId: string
    targetUserId: string
    requestReasonCode:
      | "ADMIN_RESET_USER_REQUEST"
      | "ADMIN_RESET_ACCESS_RECOVERY"
      | "ADMIN_RESET_SECURITY_INCIDENT"
      | "ADMIN_RESET_ADMINISTRATIVE_CORRECTION"
    correlationId: string
  }): Promise<{ operationId: string; expiresAt: string }> {
    const sql = await getSql()
    const [row] = await sql<[{ operationId: string; expiresAt: Date }]>`
      select operation_id as "operationId", expires_at as "expiresAt"
      from private.begin_temporary_password_reset(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.targetUserId}::uuid,
        ${input.requestReasonCode},
        ${input.correlationId}::uuid
      )
    `
    return {
      operationId: row.operationId,
      expiresAt: row.expiresAt.toISOString(),
    }
  },

  async completeTemporaryPasswordReset(input: {
    actorUserId: string
    sessionId: string
    operationId: string
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.complete_temporary_password_reset(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.operationId}::uuid,
        ${input.correlationId}::uuid
      )
    `
  },

  async failTemporaryPasswordReset(input: {
    actorUserId: string
    sessionId: string
    operationId: string
    reasonCode:
      | "AUTH_PROVIDER_FAILURE"
      | "AUTH_COMPLETION_FAILURE"
      | "AUTH_CALL_NOT_ATTEMPTED"
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.fail_temporary_password_reset(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.operationId}::uuid,
        ${input.reasonCode},
        ${input.correlationId}::uuid
      )
    `
  },

  async completeTemporaryPasswordChange(input: {
    actorUserId: string
    sessionId: string
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.complete_temporary_password_change(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.correlationId}::uuid
      )
    `
  },

  async beginPasswordRecovery(input: {
    grantHash: string
    correlationId: string
  }): Promise<{ operationId: string; userId: string; sessionId: string }> {
    const sql = await getSql()
    const [row] = await sql<
      [{ operationId: string; userId: string; sessionId: string }]
    >`
      select operation_id as "operationId",
             user_id as "userId",
             session_id as "sessionId"
      from private.begin_password_recovery(
        ${input.grantHash},
        ${input.correlationId}::uuid
      )
    `
    return row
  },

  async completePasswordRecovery(input: {
    operationId: string
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.complete_password_recovery(
        ${input.operationId}::uuid,
        ${input.correlationId}::uuid
      )
    `
  },

  async failPasswordRecovery(input: {
    operationId: string
    reasonCode:
      | "AUTH_PROVIDER_FAILURE"
      | "AUTH_COMPLETION_FAILURE"
      | "AUTH_CALL_NOT_ATTEMPTED"
    correlationId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.fail_password_recovery(
        ${input.operationId}::uuid,
        ${input.reasonCode},
        ${input.correlationId}::uuid
      )
    `
  },

  async reserveImageUploadIntent(input: {
    actorUserId: string
    sessionId: string
    purpose: ImageUploadPurpose
    declaredName: string
    declaredMime: string
    declaredSize: number
  }): Promise<UploadReservationDTO> {
    const sql = await getSql()
    const [row] = await sql<[{ reservation: UploadReservationDTO }]>`
      select private.reserve_image_upload_intent(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.purpose},
        ${input.declaredName},
        ${input.declaredMime},
        ${input.declaredSize}::bigint
      ) as reservation
    `
    return row.reservation
  },

  async activateFileUploadAuthorization(input: {
    actorUserId: string
    sessionId: string
    intentId: string
  }): Promise<UploadAuthorization> {
    const sql = await getSql()
    const [row] = await sql<[{ authorization: UploadAuthorization }]>`
      select private.activate_file_upload_authorization(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid
      ) as authorization
    `
    return row.authorization
  },

  async cancelUnissuedFileReservation(input: {
    actorUserId: string
    sessionId: string
    intentId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.cancel_unissued_file_reservation(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid
      )
    `
  },

  async beginFileFinalization(input: {
    actorUserId: string
    sessionId: string
    intentId: string
  }): Promise<FileFinalizationState> {
    const sql = await getSql()
    const [row] = await sql<[{ state: FileFinalizationState }]>`
      select private.internal_begin_file_finalization(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid
      ) as state
    `
    return row.state
  },

  async finalizeFileUpload(input: {
    actorUserId: string
    sessionId: string
    intentId: string
    fileId: string
    objectPath: string
    detectedMime: string
    finalExtension: string
    byteSize: number
    sha256: string
    correlationId: string
  }): Promise<FileObject> {
    const sql = await getSql()
    const [row] = await sql<
      (Omit<FileObject, "createdAt" | "promotedAt"> & {
        createdAt: Date
        promotedAt: Date | null
      })[]
    >`
      select file_object.id,
             file_object.company_id as "companyId",
             file_object.owner_user_id as "ownerUserId",
             file_object.purpose,
             file_object.bucket,
             file_object.object_path as "objectPath",
             file_object.original_name as "originalName",
             file_object.detected_mime as "detectedMime",
             file_object.byte_size::double precision as "byteSize",
             file_object.sha256,
             file_object.scan_status as "scanStatus",
             file_object.status,
             file_object.created_by as "createdBy",
             file_object.created_at as "createdAt",
             file_object.promoted_at as "promotedAt"
      from private.internal_finalize_file_upload(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid,
        ${input.fileId}::uuid,
        ${input.objectPath},
        ${input.detectedMime},
        ${input.finalExtension},
        ${input.byteSize}::bigint,
        ${input.sha256},
        ${input.correlationId}::uuid
      ) file_object
    `
    return Object.freeze({
      ...row,
      createdAt: row.createdAt.toISOString(),
      promotedAt: row.promotedAt?.toISOString() ?? null,
    })
  },

  async rejectFileUpload(input: {
    actorUserId: string
    sessionId: string
    intentId: string
    reasonCode: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.internal_reject_file_upload(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid,
        ${input.reasonCode}
      )
    `
  },

  async releaseFileFinalizationForRetry(input: {
    actorUserId: string
    sessionId: string
    intentId: string
    reasonCode: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.internal_release_file_finalization_for_retry(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid,
        ${input.reasonCode}
      )
    `
  },

  async markFileCleanupRequired(input: {
    actorUserId: string
    sessionId: string
    intentId: string
    reasonCode: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.internal_mark_file_cleanup_required(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.intentId}::uuid,
        ${input.reasonCode}
      )
    `
  },

  async claimUploadAuthorizationsForRetirement(
    limit: number,
    workerId: string,
  ): Promise<UploadAuthorizationRetirementClaim[]> {
    const sql = await getSql()
    const rows = await sql<
      (Omit<UploadAuthorizationRetirementClaim, "expectedVersion"> & {
        expectedVersion: number | string
      })[]
    >`
      select intent_id as "intentId",
             quarantine_object_path as "quarantineObjectPath",
             retirement_status as "retirementStatus",
             claim_id as "claimId",
             expected_version as "expectedVersion"
      from private.claim_upload_authorizations_for_retirement(
        ${limit},
        ${workerId}::uuid
      )
    `
    return rows.map((row) => ({
      ...row,
      expectedVersion: toSafeInteger(row.expectedVersion),
    }))
  },

  async releaseUploadAuthorizationRetirementClaim(input: {
    intentId: string
    claimId: string
    expectedVersion: number
    errorCode:
      | "FILE_QUARANTINE_DELETE_AMBIGUOUS"
      | "FILE_QUARANTINE_DELETE_FAILED"
      | "FILE_QUARANTINE_DELETE_UNAVAILABLE"
  }): Promise<number> {
    const sql = await getSql()
    const [row] = await sql<[{ version: number | string }]>`
      select private.release_upload_authorization_retirement_claim(
        ${input.intentId}::uuid,
        ${input.claimId}::uuid,
        ${input.expectedVersion}::bigint,
        ${input.errorCode}
      ) as version
    `
    return toSafeInteger(row.version)
  },

  async completeUploadAuthorizationRetirement(input: {
    intentId: string
    claimId: string
    expectedVersion: number
  }): Promise<UploadAuthorizationRetirementCompletion> {
    const sql = await getSql()
    const [row] = await sql<
      [{
        intentId: string
        status: RetirementStatus
        releasedBytes: number | string
        version: number | string
        authorizationRetiredAt: Date
      }]
    >`
      select intent_id as "intentId",
             status,
             released_bytes as "releasedBytes",
             version,
             authorization_retired_at as "authorizationRetiredAt"
      from private.complete_upload_authorization_retirement(
        ${input.intentId}::uuid,
        ${input.claimId}::uuid,
        ${input.expectedVersion}::bigint
      )
    `
    return {
      ...row,
      releasedBytes: toSafeInteger(row.releasedBytes),
      version: toSafeInteger(row.version),
      authorizationRetiredAt: row.authorizationRetiredAt.toISOString(),
    }
  },

  async cancelStaleReservedUploadIntents(limit: number): Promise<number> {
    const sql = await getSql()
    const [row] = await sql<[{ cancelled: number | string }]>`
      select count(*) as cancelled
      from private.cancel_stale_reserved_upload_intents(${limit})
    `
    return toSafeInteger(row.cancelled)
  },

  async authorizeImageFileDownload(input: {
    actorUserId: string
    sessionId: string
    fileId: string
    correlationId: string
    signal: AbortSignal
  }): Promise<ImageDownloadAuthorization> {
    if (input.signal.aborted) throw new Error(BFF_DATABASE_FAILURE)
    const sql = await getSql()
    if (input.signal.aborted) throw new Error(BFF_DATABASE_FAILURE)
    const query = sql<
      [(Omit<ImageDownloadAuthorization, "byteSize"> & {
        byteSize: number | string
      })]
    >`
      select file_id as "fileId",
             company_id as "companyId",
             purpose,
             owner_user_id as "ownerUserId",
             bucket,
             object_path as "objectPath",
             mime_type as "mimeType",
             byte_size as "byteSize",
             sha256,
             original_name as "originalName",
             attempt_id as "attemptId",
             completion_nonce as "completionNonce"
      from private.authorize_image_file_download(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.fileId}::uuid,
        ${input.correlationId}::uuid
      )
    `
    const [row] = await executeCancellableQuery(query, input.signal)
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return { ...row, byteSize: toSafeInteger(row.byteSize) }
  },

  async completeDownloadAudit(input: {
    attemptId: string
    completionNonce: string
    outcome: "completed" | "aborted" | "integrity_failed" | "stream_failed"
    byteClass: "empty" | "under_1_mib" | "under_10_mib" | "at_least_10_mib"
    signal: AbortSignal
  }): Promise<void> {
    if (input.signal.aborted) throw new Error(BFF_DATABASE_FAILURE)
    const sql = await getSql()
    if (input.signal.aborted) throw new Error(BFF_DATABASE_FAILURE)
    const query = sql`
      select private.complete_download_audit(
        ${input.attemptId}::uuid,
        ${input.completionNonce},
        ${input.outcome},
        ${input.byteClass}
      )
    `
    await executeCancellableQuery(query, input.signal)
  },

  async reserveCompanyProvisioning(input: {
    actorUserId: string
    sessionId: string
    idempotencyKeyHash: string
    requestHash: string
    subjectEmailHash: string
    correlationId: string
  }): Promise<CompanyProvisioningOperationSnapshot> {
    const sql = await getSql()
    const [row] = await sql<CompanyProvisioningOperationSnapshot[]>`
      select id,
             status,
             auth_user_id as "authUserId"
      from private.internal_reserve_company_provisioning(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.idempotencyKeyHash},
        ${input.requestHash},
        ${input.subjectEmailHash},
        ${input.correlationId}::uuid
      )
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return row
  },

  async markProvisioningAuthCreated(input: {
    operationId: string
    actorUserId: string
    sessionId: string
    authUserId: string
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.internal_mark_provisioning_auth_created(
        ${input.operationId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.authUserId}::uuid
      )
    `
  },

  async commitCompanyProvisioning(input: {
    operationId: string
    actorUserId: string
    sessionId: string
    authUserId: string
    companyId: string
    legalName: string
    tradeName: string
    cnpj: string
    contactEmail: string
    contactPhone: string | null
    timezone: string
    adminDisplayName: string
    adminEmail: string
    modules: ("administrative" | "financial" | "certificates")[]
    correlationId: string
  }): Promise<ProvisionedCompanySnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: ProvisionedCompanySnapshot }]>`
      select private.internal_commit_company_provisioning(
        ${input.operationId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.authUserId}::uuid,
        ${input.companyId}::uuid,
        ${input.legalName},
        ${input.tradeName},
        ${input.cnpj},
        ${input.contactEmail}::text,
        ${input.contactPhone},
        ${input.timezone},
        ${input.adminDisplayName},
        ${input.adminEmail}::text,
        ${input.modules}::public.module_key[],
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return row.result
  },

  async markProvisioningCompensation(input: {
    operationId: string
    actorUserId: string
    sessionId: string
    status: "compensated" | "compensation_required"
    errorCode: "DB_COMMIT_FAILED" | "AUTH_DELETE_FAILED"
  }): Promise<void> {
    const sql = await getSql()
    await sql`
      select private.internal_mark_provisioning_compensation(
        ${input.operationId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.status}::public.provisioning_status,
        ${input.errorCode}
      )
    `
  },

  async updateCompany(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    legalName: string
    tradeName: string
    contactEmail: string
    contactPhone: string | null
    timezone: string
    expectedVersion: number
    correlationId: string
  }): Promise<{ company: ManagedCompanySnapshot }> {
    const sql = await getSql()
    const [row] = await sql<[{ result: { company: ManagedCompanySnapshot } }]>`
      select private.internal_update_company(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.legalName},
        ${input.tradeName},
        ${input.contactEmail}::text,
        ${input.contactPhone},
        ${input.timezone},
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return z
      .object({ company: managedCompanySnapshotSchema })
      .strict()
      .parse(row.result)
  },

  async setCompanyStatus(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    targetStatus: "active" | "archived"
    expectedVersion: number
    reason: string | null
    correlationId: string
  }): Promise<{
    company: ManagedCompanySnapshot
    affectedUserIds: string[]
    reconciliationId: string
  }> {
    const sql = await getSql()
    const [row] = await sql<[
      {
        result: {
          company: ManagedCompanySnapshot
          affectedUserIds: string[]
          reconciliationId: string
        }
      },
    ]>`
      select private.internal_set_company_status(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.targetStatus}::public.company_status,
        ${input.expectedVersion}::bigint,
        ${input.reason},
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    const result = z
      .object({
        company: managedCompanySnapshotSchema,
        affectedUserIds: z.array(z.uuid()),
        reconciliationId: z.uuid(),
      })
      .strict()
      .parse(row.result)
    return {
      ...result,
      affectedUserIds: [...result.affectedUserIds],
    }
  },

  async listCompanies(input: {
    actorUserId: string
    sessionId: string
    search: string | null
    status: "active" | "archived" | null
    cursorCreatedAt: string | null
    cursorId: string | null
    limit: number
  }): Promise<{
    items: CompanyListSnapshot[]
    nextCursor: { createdAt: string; id: string } | null
  }> {
    const sql = await getSql()
    const [row] = await sql<[
      {
        result: {
          items: CompanyListSnapshot[]
          nextCursor: { createdAt: string; id: string } | null
        }
      },
    ]>`
      select private.internal_list_companies(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.search},
        ${input.status}::public.company_status,
        ${input.cursorCreatedAt}::timestamptz,
        ${input.cursorId}::uuid,
        ${input.limit}
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    const result = z
      .object({
        items: z.array(companyListSnapshotSchema),
        nextCursor: z
          .object({
            createdAt: z.iso.datetime({ offset: true }),
            id: z.uuid(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .parse(row.result)
    return {
      items: [...result.items],
      nextCursor: result.nextCursor,
    }
  },

  async getCompanyDetail(input: {
    actorUserId: string
    sessionId: string
    companyId: string
  }): Promise<CompanyDetailSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: CompanyDetailSnapshot }]>`
      select private.internal_get_company_detail(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return companyDetailSnapshotSchema.parse(row.result)
  },

  async completeCompanyAccessReconciliation(input: {
    actorUserId: string
    sessionId: string
    reconciliationId: string
    failedUserIds: string[]
    correlationId: string
  }): Promise<{
    reconciliationId: string
    status: "complete" | "pending"
    failedUserIds: string[]
    attemptCount: number
    updatedAt: string
  }> {
    const sql = await getSql()
    const [row] = await sql<[
      {
        result: {
          reconciliationId: string
          status: "complete" | "pending"
          failedUserIds: string[]
          attemptCount: number
          updatedAt: string
        }
      },
    ]>`
      select private.internal_complete_company_access_reconciliation(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.reconciliationId}::uuid,
        ${input.failedUserIds}::uuid[],
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    const result = reconciliationSnapshotSchema.parse(row.result)
    return {
      ...result,
      failedUserIds: [...result.failedUserIds],
    }
  },

  async reserveCompanyAdminProvisioning(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    idempotencyKeyHash: string
    requestHash: string
    subjectEmailHash: string
    correlationId: string
  }): Promise<CompanyProvisioningOperationSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: CompanyProvisioningOperationSnapshot }]>`
      select private.internal_reserve_company_admin_provisioning(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.idempotencyKeyHash},
        ${input.requestHash},
        ${input.subjectEmailHash},
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return provisioningOperationSnapshotSchema.parse(row.result)
  },

  async commitCompanyAdminProvisioning(input: {
    actorUserId: string
    sessionId: string
    operationId: string
    authUserId: string
    companyId: string
    displayName: string
    email: string
    modules: ("administrative" | "financial" | "certificates")[]
    correlationId: string
  }): Promise<ManagedCompanyUserSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: ManagedCompanyUserSnapshot }]>`
      select private.internal_commit_company_admin_provisioning(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.operationId}::uuid,
        ${input.authUserId}::uuid,
        ${input.companyId}::uuid,
        ${input.displayName},
        ${input.email},
        ${input.modules}::public.module_key[],
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return managedCompanyUserSnapshotSchema.parse(row.result)
  },

  async findProvisioningAuthUser(input: {
    actorUserId: string
    sessionId: string
    operationId: string
    expectedEmail: string
  }): Promise<string | null> {
    const sql = await getSql()
    const [row] = await sql<[{ authUserId: string | null }]>`
      select private.internal_find_provisioning_auth_user(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.operationId}::uuid,
        ${input.expectedEmail}
      ) as "authUserId"
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return z.uuid().nullable().parse(row.authUserId)
  },

  async updatePlatformCompanyAdmin(input: {
    actorUserId: string
    sessionId: string
    membershipId: string
    displayName: string
    status: "active" | "suspended"
    modules: ("administrative" | "financial" | "certificates")[]
    reason: string | null
    expectedVersion: number
    correlationId: string
  }): Promise<ManagedCompanyUserSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: ManagedCompanyUserSnapshot }]>`
      select private.internal_platform_update_company_admin(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.membershipId}::uuid,
        ${input.displayName},
        ${input.status}::public.membership_status,
        ${input.modules}::public.module_key[],
        ${input.reason},
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return managedCompanyUserSnapshotSchema.parse(row.result)
  },

  async getCompanyUser(input: {
    actorUserId: string
    sessionId: string
    membershipId: string
  }): Promise<ManagedCompanyUserSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: ManagedCompanyUserSnapshot }]>`
      select private.internal_get_company_user(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.membershipId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return managedCompanyUserSnapshotSchema.parse(row.result)
  },

  async getPlatformCompanyAdmin(input: {
    actorUserId: string
    sessionId: string
    membershipId: string
  }): Promise<ManagedCompanyUserSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: ManagedCompanyUserSnapshot }]>`
      select private.internal_get_platform_company_admin(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.membershipId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return managedCompanyUserSnapshotSchema.parse(row.result)
  },

  async completeMemberAuthAccessReconciliation(input: {
    actorUserId: string
    sessionId: string
    membershipId: string
    operationCorrelationId: string
    succeeded: boolean
    errorCode:
      | "AUTH_ADMIN_FAILED"
      | "AUTH_ADMIN_TIMEOUT"
      | "AUTH_ADMIN_UNAVAILABLE"
      | null
    completionCorrelationId: string
  }): Promise<{
    status: "pending" | "completed"
    desiredState: "active" | "banned"
    attemptCount: number
  }> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_complete_member_auth_access_reconciliation(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.membershipId}::uuid,
        ${input.operationCorrelationId}::uuid,
        ${input.succeeded},
        ${input.errorCode},
        ${input.completionCorrelationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return memberAuthAccessReconciliationSchema.parse(row.result)
  },

  async listCompanyUserDirectory(input: {
    actorUserId: string
    sessionId: string
    cursor: string | null
    limit: number
    searchQuery: string | null
  }): Promise<CompanyUserDirectoryEntry[]> {
    const sql = await getSql()
    const rows = await sql<
      (Omit<CompanyUserDirectoryEntry, "createdAt" | "version"> & {
        createdAt: Date
        version: number | string
      })[]
    >`
      select membership_id as "membershipId",
             user_id as "userId",
             display_name as "displayName",
             email,
             role,
             status,
             modules,
             version,
             created_at as "createdAt"
      from private.list_company_user_directory(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.cursor}::uuid,
        ${input.limit},
        ${input.searchQuery}
      )
    `
    return z.array(companyUserDirectoryEntrySchema).parse(
      rows.map((row) => ({
        ...row,
        modules: [...row.modules],
        version: toSafeInteger(row.version),
        createdAt: row.createdAt.toISOString(),
      })),
    )
  },

  async upsertBankAccount(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    bankAccountId: string
    bankCode: string
    bankName: string
    branch: { ciphertext: string; iv: string; tag: string; keyVersion: number }
    branchLast4: string
    account: { ciphertext: string; iv: string; tag: string; keyVersion: number }
    accountLast4: string
    accountType: "checking" | "savings" | "payment"
    holderName: string
    holderDocument: { ciphertext: string; iv: string; tag: string; keyVersion: number } | null
    holderDocumentLast4: string | null
    makeDefault: boolean
    expectedVersion: number | null
    correlationId: string
  }): Promise<BankAccountSummarySnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: BankAccountSummarySnapshot }]>`
      select private.internal_upsert_bank_account(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.bankAccountId}::uuid,
        ${input.bankCode},
        ${input.bankName},
        ${input.branch.ciphertext},
        ${input.branch.iv},
        ${input.branch.tag},
        ${input.branch.keyVersion},
        ${input.branchLast4},
        ${input.account.ciphertext},
        ${input.account.iv},
        ${input.account.tag},
        ${input.account.keyVersion},
        ${input.accountLast4},
        ${input.accountType}::public.bank_account_type,
        ${input.holderName},
        ${input.holderDocument?.ciphertext ?? null},
        ${input.holderDocument?.iv ?? null},
        ${input.holderDocument?.tag ?? null},
        ${input.holderDocument?.keyVersion ?? null},
        ${input.holderDocumentLast4},
        ${input.makeDefault},
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return bankAccountSummarySnapshotSchema.parse(row.result)
  },

  async setDefaultBankAccount(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    bankAccountId: string
    expectedVersion: number
    correlationId: string
  }): Promise<BankAccountSummarySnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: BankAccountSummarySnapshot }]>`
      select private.internal_set_default_bank_account(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.bankAccountId}::uuid,
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return bankAccountSummarySnapshotSchema.parse(row.result)
  },

  async archiveBankAccount(input: {
    actorUserId: string
    sessionId: string
    companyId: string
    bankAccountId: string
    replacementDefaultId: string | null
    reasonCode:
      | "BANK_ARCHIVE_ACCOUNT_CLOSED"
      | "BANK_ARCHIVE_BANK_CHANGED"
      | "BANK_ARCHIVE_DATA_CORRECTION"
      | "BANK_ARCHIVE_SECURITY_RESPONSE"
    expectedVersion: number
    correlationId: string
  }): Promise<BankAccountSummarySnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: BankAccountSummarySnapshot }]>`
      select private.internal_archive_bank_account(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid,
        ${input.bankAccountId}::uuid,
        ${input.replacementDefaultId}::uuid,
        ${input.reasonCode},
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return bankAccountSummarySnapshotSchema.parse(row.result)
  },

  async listPlatformBankAccounts(input: {
    actorUserId: string
    sessionId: string
    companyId: string
  }): Promise<BankAccountSummarySnapshot[]> {
    const sql = await getSql()
    const [row] = await sql<[{ result: BankAccountSummarySnapshot[] }]>`
      select private.internal_list_company_bank_accounts(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.companyId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return bankAccountSummarySnapshotSchema.array().parse(row.result)
  },

  async listPlatformAuditEvents(input: {
    actorUserId: string
    sessionId: string
    action: string | null
    resourceType: string | null
    outcome: "success" | "denied" | "failure" | null
    cursorOccurredAt: string | null
    cursorId: string | null
    limit: number
  }): Promise<PlatformAuditEventSnapshot[]> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_list_platform_audit_events(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.action},
        ${input.resourceType},
        ${input.outcome},
        ${input.cursorOccurredAt}::timestamptz,
        ${input.cursorId}::uuid,
        ${input.limit}
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return platformAuditEventSnapshotSchema.array().parse(row.result)
  },

  async getPlatformHealth(input: {
    actorUserId: string
    sessionId: string
  }): Promise<PlatformHealthSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_get_platform_health(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return platformHealthSnapshotSchema.parse(row.result)
  },

  async listPlatformAdmins(input: {
    actorUserId: string
    sessionId: string
    search: string | null
    cursorCreatedAt: string | null
    cursorMembershipId: string | null
    limit: number
  }): Promise<{
    items: PlatformAdminSnapshot[]
    nextCursor: { createdAt: string; membershipId: string } | null
  }> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_list_platform_admins(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.search},
        ${input.cursorCreatedAt}::timestamptz,
        ${input.cursorMembershipId}::uuid,
        ${input.limit}
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    const result = z
      .object({
        items: z.array(platformAdminSnapshotSchema),
        nextCursor: z
          .object({
            createdAt: z.iso.datetime({ offset: true }),
            membershipId: z.uuid(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .parse(row.result)
    return { items: [...result.items], nextCursor: result.nextCursor }
  },

  async getPlatformDashboard(input: {
    actorUserId: string
    sessionId: string
  }): Promise<PlatformDashboardSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_get_platform_dashboard(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return platformDashboardSnapshotSchema.parse(row.result)
  },

  async getOwnProfile(input: {
    actorUserId: string
    sessionId: string
  }): Promise<OwnProfileSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_get_own_profile(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return ownProfileSnapshotSchema.parse(row.result)
  },

  async updateOwnProfile(input: {
    actorUserId: string
    sessionId: string
    displayName: string
    expectedVersion: number
    correlationId: string
  }): Promise<OwnProfileSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_update_own_profile(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.displayName},
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return ownProfileSnapshotSchema.parse(row.result)
  },

  async attachOwnAvatar(input: {
    actorUserId: string
    sessionId: string
    fileId: string
    expectedVersion: number
    correlationId: string
  }): Promise<OwnProfileSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_attach_own_avatar(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.fileId}::uuid,
        ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return ownProfileSnapshotSchema.parse(row.result)
  },

  async syncConfirmedProfileEmail(input: {
    actorUserId: string
    sessionId: string
    correlationId: string
  }): Promise<OwnProfileSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_sync_confirmed_profile_email(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return ownProfileSnapshotSchema.parse(row.result)
  },

  async getOwnCompanySettings(input: {
    actorUserId: string
    sessionId: string
  }): Promise<CompanySettingsSnapshot> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_get_own_company_settings(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return companySettingsSnapshotSchema.parse(row.result)
  },

  async updateOwnCompanySettings(input: {
    actorUserId: string
    sessionId: string
    payload: CompanySettingsDraftPayload
    expectedVersion: number
    correlationId: string
  }): Promise<CompanySettingsSnapshot> {
    const sql = await getSql()
    const value = companySettingsDraftPayloadSchema.parse(input.payload)
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_update_own_company_settings(
        ${input.actorUserId}::uuid, ${input.sessionId}::uuid,
        ${value.representativeName}, ${value.representativeRole},
        ${value.representativeDocumentAction},
        ${value.representativeDocumentCiphertext}, ${value.representativeDocumentIv},
        ${value.representativeDocumentTag}, ${value.representativeDocumentKeyVersion},
        ${value.representativeDocumentLast4}, ${value.taxRate},
        ${value.addressStreet}, ${value.addressNumber}, ${value.addressComplement},
        ${value.addressNeighborhood}, ${value.addressCity}, ${value.addressState},
        ${value.addressPostalCode}, ${value.letterheadFileId}::uuid,
        ${value.signatureFileId}::uuid, ${input.expectedVersion}::bigint,
        ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return companySettingsSnapshotSchema.parse(row.result)
  },

  async getOwnCompanySettingsDraft(input: {
    actorUserId: string
    sessionId: string
  }): Promise<CompanySettingsDraftSnapshot | null> {
    const sql = await getSql()
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_get_own_company_settings_draft(
        ${input.actorUserId}::uuid, ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return companySettingsDraftSnapshotSchema.nullable().parse(row.result)
  },

  async upsertOwnCompanySettingsDraft(input: {
    actorUserId: string
    sessionId: string
    payload: CompanySettingsDraftPayload
    baseVersion: number
    expectedDraftVersion: number | null
    correlationId: string
  }): Promise<CompanySettingsDraftSnapshot> {
    const sql = await getSql()
    const payload = companySettingsDraftPayloadSchema.parse(input.payload)
    const [row] = await sql<[{ result: unknown }]>`
      select private.internal_upsert_own_company_settings_draft(
        ${input.actorUserId}::uuid, ${input.sessionId}::uuid,
        ${JSON.stringify(payload)}::jsonb, ${input.baseVersion}::bigint,
        ${input.expectedDraftVersion}::bigint, ${input.correlationId}::uuid
      ) as result
    `
    if (row === undefined) throw new Error(BFF_DATABASE_FAILURE)
    return companySettingsDraftSnapshotSchema.parse(row.result)
  },

  async deleteOwnCompanySettingsDraft(input: {
    actorUserId: string
    sessionId: string
  }): Promise<boolean> {
    const sql = await getSql()
    const [row] = await sql<[{ result: boolean }]>`
      select private.internal_delete_own_company_settings_draft(
        ${input.actorUserId}::uuid, ${input.sessionId}::uuid
      ) as result
    `
    if (row === undefined || typeof row.result !== "boolean") {
      throw new Error(BFF_DATABASE_FAILURE)
    }
    return row.result
  },
}
