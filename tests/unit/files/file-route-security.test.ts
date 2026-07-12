import { beforeEach, describe, expect, it, vi } from "vitest"

import { authorizeFileDownload } from "@/modules/files/server/file-route-security"

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.access,
}))
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.rateLimit,
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}))

const companyContext = {
  kind: "company" as const,
  userId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  authenticatedAt: Date.now(),
  companyId: crypto.randomUUID(),
  membershipId: crypto.randomUUID(),
  role: "member" as const,
  modules: [] as const,
  profile: {
    displayName: "Membro",
    email: "member@example.com",
    preferredTheme: "dark" as const,
    version: 1,
  },
}

beforeEach(() => {
  mocks.rateLimit.mockResolvedValue({
    allowed: true,
    attempts: 1,
    retryAfterSeconds: 0,
  })
})

describe("file download route security", () => {
  it("requires a company context and applies the dedicated 60/min bucket", async () => {
    mocks.access.mockResolvedValue({ status: "authenticated", context: companyContext })

    await expect(authorizeFileDownload()).resolves.toBe(companyContext)
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "file-download-user",
      companyContext.userId,
    )
  })

  it("rejects platform and forced-password contexts", async () => {
    mocks.access.mockResolvedValue({
      status: "authenticated",
      context: { ...companyContext, kind: "platform" },
    })
    await expect(authorizeFileDownload()).rejects.toMatchObject({
      code: "FILE_FORBIDDEN",
      status: 403,
    })

    mocks.access.mockResolvedValue({ status: "password_change" })
    await expect(authorizeFileDownload()).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
      status: 403,
    })
  })

  it("fails closed when the download rate is exceeded", async () => {
    mocks.access.mockResolvedValue({ status: "authenticated", context: companyContext })
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      attempts: 61,
      retryAfterSeconds: 60,
    })

    await expect(authorizeFileDownload()).rejects.toMatchObject({
      code: "FILE_RATE_LIMITED",
      status: 429,
    })
  })
})
