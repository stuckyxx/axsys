import "server-only"

import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"

let bffSql: Sql | undefined

function getSql(): Sql {
  bffSql ??= postgres(getServerEnv().BFF_DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "axsys-bff" },
  })
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
    const [row] = await getSql()<RateLimitDecision[]>`
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
    await getSql()`select private.clear_rate_limit(${bucket}, ${keyHash})`
  },

  async registerAuthSession(
    sessionId: string,
    userId: string,
    rememberMe: boolean,
  ): Promise<string> {
    const [row] = await getSql()<[{ expiresAt: string }]>`
      select private.register_auth_session(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${rememberMe}
      ) as "expiresAt"
    `
    return row.expiresAt
  },

  async assertAuthSession(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await getSql()<[{ active: boolean }]>`
      select private.assert_auth_session(
        ${sessionId}::uuid,
        ${userId}::uuid
      ) as active
    `
    return row.active
  },
}
