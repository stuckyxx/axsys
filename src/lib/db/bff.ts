import "server-only"

import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"

const BFF_DATABASE_FAILURE = "BFF database unavailable"
let bffSql: Promise<Sql> | undefined

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

  async clearRateLimit(bucket: string, keyHash: string): Promise<void> {
    const sql = await getSql()
    await sql`select private.clear_rate_limit(${bucket}, ${keyHash})`
  },

  async registerAuthSession(
    sessionId: string,
    userId: string,
    rememberMe: boolean,
  ): Promise<string> {
    const sql = await getSql()
    const [row] = await sql<[{ expiresAt: string }]>`
      select private.register_auth_session(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${rememberMe}
      ) as "expiresAt"
    `
    return row.expiresAt
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
}
