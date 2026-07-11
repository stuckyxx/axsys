import "server-only"

import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"

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
}
