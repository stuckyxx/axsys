import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST as createUpload } from "@/app/api/files/uploads/route"
import { POST as finalizeUpload } from "@/app/api/files/uploads/[intentId]/finalize/route"
import { GET as downloadFile } from "@/app/api/files/[fileId]/download/route"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  create: vi.fn(),
  finalize: vi.fn(),
  download: vi.fn(),
  repository: Object.freeze({}),
  downloadRepository: Object.freeze({}),
  capabilityStorage: Object.freeze({}),
  finalizationStorage: Object.freeze({}),
  downloadStorage: Object.freeze({}),
  scanner: Object.freeze({}),
}))

vi.mock("@/modules/files/server/file-route-security", () => ({
  authorizeFileMutation: mocks.authorize,
  authorizeFileDownload: mocks.authorize,
}))
vi.mock("@/modules/files/server/create-upload-intent", () => ({
  createUploadIntent: mocks.create,
}))
vi.mock("@/modules/files/server/finalize-upload-intent", () => ({
  finalizeUploadIntent: mocks.finalize,
}))
vi.mock("@/modules/files/server/authorize-file-download", () => ({
  createAuthorizedDownload: mocks.download,
}))
vi.mock("@/modules/files/server/file-repository", () => ({
  getFileRepository: () => mocks.repository,
  getImageDownloadRepository: () => mocks.downloadRepository,
}))
vi.mock("@/modules/files/server/file-storage", () => ({
  getFileFinalizationStorage: () => mocks.finalizationStorage,
  getResumableUploadEndpoint: () =>
    "http://127.0.0.1:54321/storage/v1/upload/resumable",
  getUploadCapabilityStorage: () => mocks.capabilityStorage,
  getPrivateDownloadStorage: () => mocks.downloadStorage,
}))
vi.mock("@/modules/files/server/clamav-client", () => ({
  getClamAvScanner: () => mocks.scanner,
}))
vi.mock("@/modules/files/server/image-normalizer", () => ({
  normalizeImage: vi.fn(),
}))

const context = Object.freeze({
  kind: "company" as const,
  userId: "20000000-0000-4000-8000-000000000001",
  sessionId: "90000000-0000-4000-8000-000000000001",
  authenticatedAt: 1_700_000_000,
  companyId: "30000000-0000-4000-8000-000000000001",
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "company_admin" as const,
  modules: [] as const,
  profile: {
    displayName: "Admin",
    email: "admin@example.test",
    preferredTheme: "dark" as const,
    version: 1,
  },
})

const correlationId = "80000000-0000-4000-8000-000000000001"
const intentId = "10000000-0000-4000-8000-000000000001"
const fileId = "50000000-0000-4000-8000-000000000001"

beforeEach(() => {
  mocks.authorize.mockResolvedValue(context)
})

describe("file upload route handlers", () => {
  it("returns a no-store handshake without accepting tenant or path fields", async () => {
    const handshake = {
      intentId,
      endpoint: "http://127.0.0.1:54321/storage/v1/upload/resumable",
      bucket: "axsys-quarantine",
      path: `${context.companyId}/${context.userId}/${intentId}/20000000-0000-4000-8000-000000000002`,
      token: "signed",
      uploadAuthorizationExpiresAt: "2030-01-01T02:00:00.000Z",
      finalizeBefore: "2030-01-02T02:15:00.000Z",
      maxBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png"],
    }
    mocks.create.mockResolvedValue(handshake)
    const request = new Request("https://axsys.test/api/files/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        purpose: "profile_avatar",
        targetResourceId: null,
        declaredName: "avatar.png",
        declaredMime: "image/png",
        declaredSize: 1024,
      }),
    })

    const response = await createUpload(request)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual(handshake)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: mocks.repository,
        storage: mocks.capabilityStorage,
      }),
      {
        context,
        correlationId,
        purpose: "profile_avatar",
        targetResourceId: null,
        declaredName: "avatar.png",
        declaredMime: "image/png",
        declaredSize: 1024,
      },
    )
  })

  it("awaits the dynamic intent id and returns only committed file metadata", async () => {
    const file = {
      id: "50000000-0000-4000-8000-000000000001",
      status: "ready",
      scanStatus: "clean",
    }
    mocks.finalize.mockResolvedValue(file)
    const request = new Request(
      `https://axsys.test/api/files/uploads/${intentId}/finalize`,
      { method: "POST", headers: { "x-correlation-id": correlationId } },
    )

    const response = await finalizeUpload(request, {
      params: Promise.resolve({ intentId }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual(file)
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: mocks.repository,
        scanner: mocks.scanner,
        storage: mocks.finalizationStorage,
      }),
      { context, correlationId, intentId },
    )
  })

  it("rejects extra handshake keys before touching reservation code", async () => {
    const response = await createUpload(
      new Request("https://axsys.test/api/files/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "profile_avatar",
          targetResourceId: null,
          declaredName: "avatar.png",
          declaredMime: "image/png",
          declaredSize: 1024,
          companyId: context.companyId,
        }),
      }),
    )

    expect(response.status).toBe(422)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("streams the final private response with no-store headers", async () => {
    mocks.download.mockResolvedValue(
      new Response("verified bytes", {
        headers: {
          "content-type": "image/webp",
          "content-disposition": "attachment; filename=avatar.webp",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      }),
    )
    const request = new Request(
      `https://axsys.test/api/files/${fileId}/download`,
      { headers: { "x-correlation-id": correlationId } },
    )

    const response = await downloadFile(request, {
      params: Promise.resolve({ fileId }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("vary")).toContain("Cookie")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.text()).resolves.toBe("verified bytes")
    expect(mocks.download).toHaveBeenCalledWith(
      {
        repository: mocks.downloadRepository,
        storage: mocks.downloadStorage,
      },
      { context, fileId, correlationId },
    )
  })

  it("keeps Storage credentials and browser session APIs out of route source", () => {
    const source = [
      "src/app/api/files/uploads/route.ts",
      "src/app/api/files/uploads/[intentId]/finalize/route.ts",
      "src/app/api/files/[fileId]/download/route.ts",
    ]
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n")

    expect(source).not.toMatch(/service[_-]?role|secret[_-]?key|getSession/u)
    expect(source).not.toMatch(/companyId\s*:/u)
  })
})
