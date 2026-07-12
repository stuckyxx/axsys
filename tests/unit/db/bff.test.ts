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
  it("exports only the twenty-five typed security-control, password, upload and directory operations", () => {
    expect(Object.keys(bffDb).sort()).toEqual([
      "activateFileUploadAuthorization",
      "assertAuthSession",
      "beginFileFinalization",
      "beginPasswordRecovery",
      "beginTemporaryPasswordReset",
      "cancelUnissuedFileReservation",
      "clearRateLimit",
      "completePasswordRecovery",
      "completeTemporaryPasswordChange",
      "completeTemporaryPasswordReset",
      "consumeRateLimit",
      "failClosedLoginSession",
      "failPasswordRecovery",
      "failTemporaryPasswordReset",
      "finalizeFileUpload",
      "listCompanyUserDirectory",
      "markFileCleanupRequired",
      "registerAuthSession",
      "rejectFileUpload",
      "releaseFileFinalizationForRetry",
      "reserveImageUploadIntent",
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
    expectTypeOf<Parameters<typeof bffDb.beginPasswordRecovery>>().toEqualTypeOf<
      [input: { grantHash: string; correlationId: string }]
    >()
    expectTypeOf(bffDb.beginPasswordRecovery).returns.toEqualTypeOf<
      Promise<{ operationId: string; userId: string; sessionId: string }>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.completePasswordRecovery>
    >().toEqualTypeOf<
      [input: { operationId: string; correlationId: string }]
    >()
    expectTypeOf(bffDb.completePasswordRecovery).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<Parameters<typeof bffDb.failPasswordRecovery>>().toEqualTypeOf<
      [
        input: {
          operationId: string
          reasonCode:
            | "AUTH_PROVIDER_FAILURE"
            | "AUTH_COMPLETION_FAILURE"
            | "AUTH_CALL_NOT_ATTEMPTED"
          correlationId: string
        },
      ]
    >()
    expectTypeOf(bffDb.failPasswordRecovery).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<Parameters<typeof bffDb.reserveImageUploadIntent>>().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          purpose:
            | "profile_avatar"
            | "company_letterhead"
            | "company_signature"
          declaredName: string
          declaredMime: string
          declaredSize: number
        },
      ]
    >()
    expectTypeOf(bffDb.reserveImageUploadIntent).returns.toEqualTypeOf<
      Promise<Readonly<{
        intentId: string
        quarantinePath: string
        declaredSize: number
      }>>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.activateFileUploadAuthorization>
    >().toEqualTypeOf<
      [input: { actorUserId: string; sessionId: string; intentId: string }]
    >()
    expectTypeOf(bffDb.activateFileUploadAuthorization).returns.toEqualTypeOf<
      Promise<{
        uploadAuthorizationExpiresAt: string
        finalizeBefore: string
      }>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.cancelUnissuedFileReservation>
    >().toEqualTypeOf<
      [input: { actorUserId: string; sessionId: string; intentId: string }]
    >()
    expectTypeOf(bffDb.cancelUnissuedFileReservation).returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<
      Parameters<typeof bffDb.listCompanyUserDirectory>
    >().toEqualTypeOf<
      [
        input: {
          actorUserId: string
          sessionId: string
          cursor: string | null
          limit: number
          searchQuery: string | null
        },
      ]
    >()
    expectTypeOf(bffDb.listCompanyUserDirectory).returns.toEqualTypeOf<
      Promise<
        {
          userId: string
          displayName: string
          email: string
          role: "company_admin" | "member"
          status: "active" | "suspended"
          modules: ("administrative" | "financial" | "certificates")[]
          createdAt: string
        }[]
      >
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
      "activate_file_upload_authorization",
      "assert_auth_session",
      "begin_password_recovery",
      "begin_temporary_password_reset",
      "cancel_unissued_file_reservation",
      "clear_rate_limit",
      "complete_password_recovery",
      "complete_temporary_password_change",
      "complete_temporary_password_reset",
      "consume_rate_limit",
      "fail_closed_login_session",
      "fail_password_recovery",
      "fail_temporary_password_reset",
      "internal_begin_file_finalization",
      "internal_finalize_file_upload",
      "internal_mark_file_cleanup_required",
      "internal_reject_file_upload",
      "internal_release_file_finalization_for_retry",
      "list_company_user_directory",
      "register_auth_session",
      "reserve_image_upload_intent",
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
