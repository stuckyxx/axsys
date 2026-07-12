import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/platform/companies/route"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  provision: vi.fn(),
  dependencies: Object.freeze({}),
  rateLimit: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}))
vi.mock("@/lib/security/csrf", () => ({
  CSRF_COOKIE_NAME: "__Host-axsys-csrf",
  assertCsrf: vi.fn(),
}))
vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: vi.fn() }))
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.rateLimit,
}))
vi.mock("@/modules/auth/server/guards", () => ({
  requirePlatformApiContext: mocks.context,
  requireRecentAuthentication: vi.fn(),
}))
vi.mock("@/modules/companies/server/company-provisioner", () => ({
  getCompanyProvisioningDependencies: () => mocks.dependencies,
  provisionCompany: mocks.provision,
}))

const context = {
  kind: "platform" as const,
  userId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  authenticatedAt: Math.floor(Date.now() / 1_000),
  profile: {
    displayName: "Super Admin",
    email: "platform@example.com",
    preferredTheme: "dark" as const,
    version: 1,
  },
}

const validInput = {
  legalName: "Axsys Serviços Ltda.",
  tradeName: "Axsys",
  cnpj: "11.222.333/0001-81",
  contactEmail: "contato@example.com",
  contactPhone: null,
  timezone: "America/Fortaleza",
  firstAdmin: {
    displayName: "Maria Administradora",
    email: "maria@example.com",
    temporaryPassword: "frase provisoria segura 2026",
    modules: ["administrative", "financial"],
  },
}

beforeEach(() => {
  mocks.cookies.mockResolvedValue({
    get: vi.fn(() => ({ value: "csrf-cookie" })),
  })
  mocks.context.mockResolvedValue(context)
  mocks.rateLimit.mockResolvedValue({
    allowed: true,
    attempts: 1,
    retryAfterSeconds: 0,
  })
})

describe("platform company creation route", () => {
  it("provisions through the BFF saga and never returns the password", async () => {
    mocks.provision.mockResolvedValue({
      company: { id: crypto.randomUUID(), status: "active" },
      membership: { id: crypto.randomUUID(), role: "company_admin" },
      modules: ["administrative", "financial"],
    })
    const response = await POST(
      new Request("https://axsys.test/api/platform/companies", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://axsys.test",
          "x-csrf-token": "csrf-cookie",
          "idempotency-key": "company-create-2026-0001",
        },
        body: JSON.stringify(validInput),
      }),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const text = await response.text()
    expect(text).not.toContain(validInput.firstAdmin.temporaryPassword)
    expect(mocks.provision).toHaveBeenCalledWith(mocks.dependencies, {
      actorUserId: context.userId,
      sessionId: context.sessionId,
      idempotencyKey: "company-create-2026-0001",
      correlationId: expect.any(String),
      input: expect.objectContaining({ cnpj: "11222333000181" }),
    })
  })

  it("rejects protected fields before reserving the saga", async () => {
    const response = await POST(
      new Request("https://axsys.test/api/platform/companies", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "company-create-2026-0002",
        },
        body: JSON.stringify({ ...validInput, status: "active" }),
      }),
    )

    expect(response.status).toBe(422)
    expect(mocks.provision).not.toHaveBeenCalled()
  })

  it("enforces the dedicated platform rate limit", async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      attempts: 11,
      retryAfterSeconds: 3_600,
    })
    const response = await POST(
      new Request("https://axsys.test/api/platform/companies", {
        method: "POST",
        headers: { "idempotency-key": "company-create-2026-0003" },
        body: JSON.stringify(validInput),
      }),
    )
    expect(response.status).toBe(429)
    expect(mocks.provision).not.toHaveBeenCalled()
  })
})
