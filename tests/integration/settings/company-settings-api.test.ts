import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../helpers/auth"

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(), assertOrigin: vi.fn(), cookies: vi.fn(),
  requireContext: vi.fn(), requireRecent: vi.fn(),
  getSettings: vi.fn(), updateSettings: vi.fn(),
  getDraft: vi.fn(), upsertDraft: vi.fn(), deleteDraft: vi.fn(), rate: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: mocks.cookies }))
vi.mock("@/lib/security/csrf", () => ({ CSRF_COOKIE_NAME: "csrf", assertCsrf: mocks.assertCsrf }))
vi.mock("@/lib/security/origin", () => ({ assertMutationOrigin: mocks.assertOrigin }))
vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyApiContext: mocks.requireContext,
  requireRecentAuthentication: mocks.requireRecent,
}))
vi.mock("@/modules/settings/server/company-settings-service", async (original) => ({
  ...await original<typeof import("@/modules/settings/server/company-settings-service")>(),
  getCompanySettings: mocks.getSettings,
  updateCompanySettings: mocks.updateSettings,
}))
vi.mock("@/modules/settings/server/company-settings-draft-service", () => ({
  getCompanySettingsDraft: mocks.getDraft,
  upsertCompanySettingsDraft: mocks.upsertDraft,
  deleteCompanySettingsDraft: mocks.deleteDraft,
}))
vi.mock("@/modules/settings/server/company-settings-route-security", () => ({
  enforceSettingsDraftRateLimit: mocks.rate,
}))

import * as settingsRoute from "@/app/api/company/settings/route"
import * as draftRoute from "@/app/api/company/settings/draft/route"

const context = createCompanyContext()
const valid = {
  representativeName: "Maria Silva", representativeRole: "Diretora",
  representativeDocument: null, taxRate: 5,
  addressStreet: "Rua Central", addressNumber: "100", addressComplement: null,
  addressNeighborhood: "Centro", addressCity: "Fortaleza", addressState: "CE",
  addressPostalCode: "60000000", letterheadFileId: null, signatureFileId: null,
  version: 2,
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://app.example.test${path}`, {
    method,
    headers: { origin: "https://app.example.test", "x-csrf-token": "token", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) })
  mocks.requireContext.mockResolvedValue(context)
  mocks.rate.mockResolvedValue(null)
})

describe("company settings API", () => {
  it("returns only the safe strict settings DTO with no-store headers", async () => {
    mocks.getSettings.mockResolvedValue({ representativeDocumentLast4: "4725", canEdit: true, banks: [] })
    const response = await settingsRoute.GET(request("/api/company/settings"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({ representativeDocumentLast4: "4725", canEdit: true, banks: [] })
    expect(JSON.stringify(await mocks.getSettings.mock.results[0]?.value)).not.toContain("52998224725")
  })

  it("enforces Origin, CSRF, recent authentication and strict schema before save", async () => {
    mocks.updateSettings.mockResolvedValue({ version: 3 })
    const response = await settingsRoute.PATCH(request("/api/company/settings", "PATCH", valid))
    expect(response.status).toBe(200)
    expect(mocks.assertOrigin).toHaveBeenCalledOnce()
    expect(mocks.assertCsrf).toHaveBeenCalledOnce()
    expect(mocks.requireRecent).toHaveBeenCalledWith(context, 600)
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ context, settings: valid }))

    const rejected = await settingsRoute.PATCH(request("/api/company/settings", "PATCH", { ...valid, companyId: crypto.randomUUID() }))
    expect(rejected.status).toBe(422)
  })

  it("keeps draft mutations remote, actor-scoped, rate-limited and no-store", async () => {
    mocks.upsertDraft.mockResolvedValue({ baseVersion: 2, version: 1, updatedAt: new Date().toISOString() })
    const response = await draftRoute.PUT(request("/api/company/settings/draft", "PUT", {
      ...valid, version: undefined, baseVersion: 2, expectedDraftVersion: null,
    }))
    expect(response.status).toBe(200)
    expect(mocks.rate).toHaveBeenCalledWith(`${context.userId}:${context.companyId}`, expect.any(String))
    expect(mocks.requireRecent).toHaveBeenCalledWith(context, 600)
    expect(mocks.upsertDraft).toHaveBeenCalledOnce()
    expect(response.headers.get("cache-control")).toContain("no-store")

    mocks.deleteDraft.mockResolvedValue({ deleted: true })
    const deleted = await draftRoute.DELETE(request("/api/company/settings/draft", "DELETE"))
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ deleted: true })
  })
})
