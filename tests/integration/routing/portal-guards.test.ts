import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createCompanyContext,
  createPlatformContext,
} from "../../helpers/auth"

const mocks = vi.hoisted(() => ({
  getAccessContext: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((location: string): never => {
    throw new Error(`REDIRECT:${location}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))

import AppLayout from "@/app/(protected)/app/layout"
import PlatformLayout from "@/app/(protected)/platform/layout"

const CHILD = "protected-child"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue({
    get: (name: string) =>
      name === "x-nonce" ? "223e4567e89b42d3a456426614174000" : null,
  })
})

describe("Task 15 canonical portal guard matrix", () => {
  it.each([
    ["/platform", PlatformLayout],
    ["/app", AppLayout],
  ])("redirects an anonymous %s request to login", async (_path, Layout) => {
    mocks.getAccessContext.mockResolvedValueOnce({ status: "anonymous" })

    await expect(Layout({ children: CHILD })).rejects.toThrow("REDIRECT:/login")
  })

  it("keeps platform identities out of the company portal", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: createPlatformContext(),
    })

    await expect(AppLayout({ children: CHILD })).rejects.toThrow(
      "REDIRECT:/platform",
    )
  })

  it("keeps company identities out of the platform portal", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: createCompanyContext(),
    })

    await expect(PlatformLayout({ children: CHILD })).rejects.toThrow(
      "REDIRECT:/app/dashboard",
    )
  })

  it.each([
    ["/platform", PlatformLayout],
    ["/app", AppLayout],
  ])("routes forced-password identity from %s to change-password", async (_path, Layout) => {
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "password_change",
      userId: "10000000-0000-4000-8000-000000000001",
      expired: false,
    })

    await expect(Layout({ children: CHILD })).rejects.toThrow(
      "REDIRECT:/change-password",
    )
  })

  it("admits each verified identity only to its canonical layout", async () => {
    const platform = createPlatformContext()
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: platform,
    })
    const platformElement = await PlatformLayout({ children: CHILD })
    expect(platformElement.key).toBe(`${platform.userId}:platform`)

    const company = createCompanyContext()
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: company,
    })
    const companyElement = await AppLayout({ children: CHILD })
    expect(companyElement.key).toBe(`${company.userId}:${company.companyId}`)
  })
})
