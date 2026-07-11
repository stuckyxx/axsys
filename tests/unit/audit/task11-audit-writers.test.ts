import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  type AuthenticatedAuditEventInput,
  writeAuditEvent,
} from "@/modules/audit/server/write-audit-event"
import {
  type SecurityEventInput,
  writeSecurityEvent,
} from "@/modules/audit/server/write-security-event"

const mocks = vi.hoisted(() => ({
  redactRecord: vi.fn(),
  writeAuthenticatedAuditEvent: vi.fn(),
  writeSecurityEvent: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    writeAuthenticatedAuditEvent: mocks.writeAuthenticatedAuditEvent,
    writeSecurityEvent: mocks.writeSecurityEvent,
  },
}))

vi.mock("@/lib/security/redact", () => ({
  redactRecord: mocks.redactRecord,
}))

const ACTOR_ID = "10000000-0000-4000-8000-000000000001"
const SESSION_ID = "90000000-0000-4000-8000-000000000001"
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001"
const HASH = "a".repeat(64)

beforeEach(() => {
  mocks.redactRecord.mockImplementation((value) => value)
  mocks.writeAuthenticatedAuditEvent.mockResolvedValue(undefined)
  mocks.writeSecurityEvent.mockResolvedValue(undefined)
})

describe("Task 11 authenticated audit writer", () => {
  it("maps the sole auth.login contract explicitly and returns no record", async () => {
    const input: AuthenticatedAuditEventInput = {
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      action: "auth.login",
      resourceType: "session",
      resourceId: null,
      outcome: "success",
      reasonCode: null,
      correlationId: CORRELATION_ID,
      ipHash: HASH,
      userAgentHash: HASH,
      metadata: { rememberMe: true },
    }

    expectTypeOf(writeAuditEvent).returns.toEqualTypeOf<Promise<void>>()
    await expect(writeAuditEvent(input)).resolves.toBeUndefined()

    expect(mocks.redactRecord).toHaveBeenCalledWith({ rememberMe: true })
    expect(mocks.writeAuthenticatedAuditEvent).toHaveBeenCalledWith(input)
  })

  it.each([
    [{ action: "company.update" }],
    [{ resourceType: "company" }],
    [{ outcome: "failure" }],
    [{ reasonCode: "RAW_REASON" }],
    [{ metadata: { arbitrary: "raw" } }],
    [{ metadata: { rememberMe: { nested: true } } }],
    [{ extraAuthority: "tenant-a" }],
  ])("rejects a cast-bypassed audit input before redaction or BFF: %j", async (change) => {
    const input = {
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      action: "auth.login",
      resourceType: "session",
      resourceId: null,
      outcome: "success",
      reasonCode: null,
      correlationId: CORRELATION_ID,
      ipHash: HASH,
      userAgentHash: HASH,
      metadata: { rememberMe: false },
      ...change,
    } as AuthenticatedAuditEventInput

    await expect(writeAuditEvent(input)).rejects.toThrow("Invalid audit event")
    expect(mocks.redactRecord).not.toHaveBeenCalled()
    expect(mocks.writeAuthenticatedAuditEvent).not.toHaveBeenCalled()
  })
})

describe("Task 11 anonymous security writer", () => {
  it("maps an allowlisted neutral login failure without a user identity", async () => {
    const input: SecurityEventInput = {
      eventType: "auth.login.failed",
      emailHash: HASH,
      ipHash: HASH,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId: CORRELATION_ID,
      metadata: { attempts: 3 },
    }

    expectTypeOf(writeSecurityEvent).returns.toEqualTypeOf<Promise<void>>()
    await expect(writeSecurityEvent(input)).resolves.toBeUndefined()

    expect(mocks.redactRecord).toHaveBeenCalledWith({ attempts: 3 })
    expect(mocks.writeSecurityEvent).toHaveBeenCalledWith(input)
    expect(mocks.writeSecurityEvent.mock.calls[0]?.[0]).not.toHaveProperty(
      "userId",
    )
  })

  it.each([
    [{ eventType: "auth.login.success" }],
    [{ outcome: "success" }],
    [{ reasonCode: "UNKNOWN_REASON" }],
    [{ metadata: { rawEmail: "person@example.test" } }],
    [{ metadata: { attempts: -1 } }],
    [{ metadata: { retryAfterSeconds: 86_401 } }],
    [{ userId: ACTOR_ID }],
  ])("rejects a cast-bypassed security event before the BFF: %j", async (change) => {
    const input = {
      eventType: "auth.login.failed",
      emailHash: HASH,
      ipHash: HASH,
      outcome: "denied",
      reasonCode: "AUTH_INVALID_CREDENTIALS",
      correlationId: CORRELATION_ID,
      metadata: { attempts: 1 },
      ...change,
    } as SecurityEventInput

    await expect(writeSecurityEvent(input)).rejects.toThrow(
      "Invalid security event",
    )
    expect(mocks.redactRecord).not.toHaveBeenCalled()
    expect(mocks.writeSecurityEvent).not.toHaveBeenCalled()
  })

  it("keeps both writers server-only and free of table/admin escape hatches", () => {
    for (const path of [
      "src/modules/audit/server/write-audit-event.ts",
      "src/modules/audit/server/write-security-event.ts",
    ]) {
      const source = readFileSync(resolve(path), "utf8")
      expect(source.trimStart()).toMatch(/^import "server-only"/u)
      expect(source).not.toMatch(/\.from\(["'](?:audit|security)_events["']\)/u)
      expect(source).not.toContain("getAdminSupabase")
      expect(source).not.toContain("SUPABASE_SECRET_KEY")
      expect(source).not.toMatch(/console\.|logger\./u)
    }
    const securitySource = readFileSync(
      resolve("src/modules/audit/server/write-security-event.ts"),
      "utf8",
    )
    expect(securitySource).not.toMatch(/\buserId\b/u)
  })
})
