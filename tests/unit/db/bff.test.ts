import { readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { describe, expect, expectTypeOf, it } from "vitest"
import { bffDb, type RateLimitDecision } from "@/lib/db/bff"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

describe("bffDb boundary", () => {
  it("exports only the thirteen typed security-control and password operations", () => {
    expect(Object.keys(bffDb).sort()).toEqual([
      "assertAuthSession",
      "beginTemporaryPasswordReset",
      "clearRateLimit",
      "completeTemporaryPasswordChange",
      "completeTemporaryPasswordReset",
      "consumeRateLimit",
      "failClosedLoginSession",
      "failTemporaryPasswordReset",
      "registerAuthSession",
      "revokeSessionsAndWriteLogout",
      "rotateAppSessionAfterReauthentication",
      "writeAuthenticatedAuditEvent",
      "writeSecurityEvent",
    ])

    expectTypeOf<RateLimitDecision>().toEqualTypeOf<{
      allowed: boolean
      attempts: number
      retryAfterSeconds: number
    }>()
    expectTypeOf<Parameters<typeof bffDb.consumeRateLimit>>().toEqualTypeOf<
      [
        input: {
          bucket: string
          keyHash: string
          limit: number
          windowSeconds: number
          blockSeconds: number
        },
      ]
    >()
    expectTypeOf(bffDb.consumeRateLimit).returns.toEqualTypeOf<
      Promise<RateLimitDecision>
    >()
    expectTypeOf<Parameters<typeof bffDb.clearRateLimit>>().toEqualTypeOf<
      [
        bucket: "login-account-failure" | "reauth-account-failure",
        keyHash: string,
      ]
    >()
    expectTypeOf(bffDb.clearRateLimit).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<Parameters<typeof bffDb.registerAuthSession>>().toEqualTypeOf<
      [sessionId: string, userId: string, rememberMe: boolean]
    >()
    expectTypeOf(bffDb.registerAuthSession).returns.toEqualTypeOf<Promise<string>>()
    expectTypeOf<Parameters<typeof bffDb.assertAuthSession>>().toEqualTypeOf<
      [sessionId: string, userId: string]
    >()
    expectTypeOf(bffDb.assertAuthSession).returns.toEqualTypeOf<Promise<boolean>>()
    expectTypeOf<
      Parameters<typeof bffDb.writeAuthenticatedAuditEvent>
    >().toEqualTypeOf<
      [
        input: {
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
        },
      ]
    >()
    expectTypeOf(bffDb.writeAuthenticatedAuditEvent).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<Parameters<typeof bffDb.writeSecurityEvent>>().toEqualTypeOf<
      [
        input: {
          eventType: string
          emailHash: string | null
          ipHash: string | null
          outcome: "success" | "denied" | "failure"
          reasonCode: string | null
          correlationId: string
          metadata: Record<string, unknown>
        },
      ]
    >()
    expectTypeOf(bffDb.writeSecurityEvent).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<
      Parameters<typeof bffDb.revokeSessionsAndWriteLogout>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          correlationId: string
          ipHash: string | null
          userAgentHash: string | null
        },
      ]
    >()
    expectTypeOf(bffDb.revokeSessionsAndWriteLogout).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<Parameters<typeof bffDb.failClosedLoginSession>>().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          reasonCode: string
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.failClosedLoginSession).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<
      Parameters<typeof bffDb.rotateAppSessionAfterReauthentication>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          oldSessionId: string
          newSessionId: string
          correlationId: string
        },
      ]
    >()
    expectTypeOf(
      bffDb.rotateAppSessionAfterReauthentication,
    ).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<
      Parameters<typeof bffDb.beginTemporaryPasswordReset>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          targetUserId: string
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.beginTemporaryPasswordReset).returns.toEqualTypeOf<
      Promise<{ operationId: string; expiresAt: string }>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.completeTemporaryPasswordReset>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          operationId: string
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.completeTemporaryPasswordReset).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.failTemporaryPasswordReset>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          operationId: string
          reasonCode:
            | "AUTH_PROVIDER_FAILURE"
            | "AUTH_COMPLETION_FAILURE"
            | "AUTH_CALL_NOT_ATTEMPTED"
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.failTemporaryPasswordReset).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.completeTemporaryPasswordChange>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.completeTemporaryPasswordChange).returns.toEqualTypeOf<
      Promise<void>
    >()
  })

  it("keeps the SQL client private and uses static private function names", () => {
    const facadePath = resolve("src/lib/db/bff.ts")
    const source = readFileSync(facadePath, "utf8")

    expect(source).not.toMatch(/export\s+(?:const|function|let|var)\s+(?:getSql|sql)/u)
    expect(source).not.toMatch(/\b(?:unsafe|transaction|begin|reserve|execute|query|call)\s*:/u)
    expect(source).not.toContain(".unsafe(")
    const staticRoutineNames = Array.from(
      source.matchAll(/private\.([a-z_]+)\(/gu),
      ([, routineName]) => routineName,
    ).sort()
    expect(staticRoutineNames).toEqual([
      "assert_auth_session",
      "begin_temporary_password_reset",
      "clear_rate_limit",
      "complete_temporary_password_change",
      "complete_temporary_password_reset",
      "consume_rate_limit",
      "fail_closed_login_session",
      "fail_temporary_password_reset",
      "register_auth_session",
      "revoke_sessions_and_write_logout",
      "rotate_app_session_after_reauthentication",
      "write_authenticated_audit_event",
      "write_security_event",
    ])
    expect(source).toMatch(/private\.write_security_event\([\s\S]*?null::uuid,/u)
    expect(source).toMatch(/register_auth_session\([\s\S]*?\.toISOString\(\)/u)
    expect(source).not.toContain("::public.audit_outcome")
    expect(source).not.toMatch(/\brevokeAuthSessions\b/u)
    expect(source).not.toContain("input.userId")
    expect(source).not.toMatch(/private\.\$\{/u)
  })

  it("is the only application source allowed to import postgres", () => {
    const facadePath = resolve("src/lib/db/bff.ts")
    const violations = sourceFiles(resolve("src")).filter((path) => {
      if (path === facadePath) return false
      return /from\s+["']postgres["']/u.test(readFileSync(path, "utf8"))
    })

    expect(violations).toEqual([])
  })
})
