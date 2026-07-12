import "server-only"

import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"
import type {
  FileFinalizationState,
  FileObject,
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
  userId: string
  displayName: string
  email: string
  role: "company_admin" | "member"
  status: "active" | "suspended"
  modules: ("administrative" | "financial" | "certificates")[]
  createdAt: string
}

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
    correlationId: string
  }): Promise<{ operationId: string; expiresAt: string }> {
    const sql = await getSql()
    const [row] = await sql<[{ operationId: string; expiresAt: Date }]>`
      select operation_id as "operationId", expires_at as "expiresAt"
      from private.begin_temporary_password_reset(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.targetUserId}::uuid,
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

  async listCompanyUserDirectory(input: {
    actorUserId: string
    sessionId: string
    cursor: string | null
    limit: number
    searchQuery: string | null
  }): Promise<CompanyUserDirectoryEntry[]> {
    const sql = await getSql()
    const rows = await sql<
      (Omit<CompanyUserDirectoryEntry, "createdAt"> & { createdAt: Date })[]
    >`
      select user_id as "userId",
             display_name as "displayName",
             email,
             role,
             status,
             modules,
             created_at as "createdAt"
      from private.list_company_user_directory(
        ${input.actorUserId}::uuid,
        ${input.sessionId}::uuid,
        ${input.cursor}::uuid,
        ${input.limit},
        ${input.searchQuery}
      )
    `
    return rows.map((row) => ({
      ...row,
      modules: [...row.modules],
      createdAt: row.createdAt.toISOString(),
    }))
  },
}
