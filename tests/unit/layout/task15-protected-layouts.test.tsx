import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createCompanyContext,
  createPlatformContext,
} from "../../helpers/auth"

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((location: string): never => {
    throw new Error(`REDIRECT:${location}`)
  }),
  headers: vi.fn(),
  listCompanies: vi.fn(),
  getCompanyDetail: vi.fn(),
  getPlatformDashboard: vi.fn(),
  requireCompanyContext: vi.fn(),
  requirePlatformContext: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/platform",
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}))
vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("@/modules/auth/server/guards", () => ({
  requireCompanyContext: mocks.requireCompanyContext,
  requirePlatformContext: mocks.requirePlatformContext,
}))
vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    listCompanies: mocks.listCompanies,
    getCompanyDetail: mocks.getCompanyDetail,
  },
}))
vi.mock("@/modules/platform/server/platform-repository", () => ({
  getPlatformDashboard: mocks.getPlatformDashboard,
}))

import AppError from "@/app/(protected)/app/error"
import AppLayout, {
  dynamic as appDynamic,
} from "@/app/(protected)/app/layout"
import AppLoading from "@/app/(protected)/app/loading"
import AppIndex from "@/app/(protected)/app/page"
import DashboardPage from "@/app/(protected)/app/dashboard/page"
import PlatformError from "@/app/(protected)/platform/error"
import PlatformLayout, {
  dynamic as platformDynamic,
} from "@/app/(protected)/platform/layout"
import PlatformLoading from "@/app/(protected)/platform/loading"
import PlatformPage from "@/app/(protected)/platform/page"
import { ScopedProviders } from "@/components/providers/scoped-providers"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { AxsysThemeProvider } from "@/lib/theme/theme-provider"

const CSP_NONCE = "223e4567e89b42d3a456426614174000"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformContext.mockResolvedValue(createPlatformContext())
  mocks.requireCompanyContext.mockResolvedValue(createCompanyContext())
  mocks.headers.mockResolvedValue({
    get: (name: string) => (name === "x-nonce" ? CSP_NONCE : null),
  })
  mocks.listCompanies.mockResolvedValue({ items: [], nextCursor: null })
  mocks.getPlatformDashboard.mockResolvedValue({
    checkedAt: "2026-07-12T12:00:00.000Z",
    activeCompanies: 0,
    archivedCompanies: 0,
    activeAdmins: 0,
    activeUsers: 0,
    activeBankAccounts: 0,
    archivedBankAccounts: 0,
    pendingCompensations: 0,
    pendingCompanyAccessReconciliations: 0,
    pendingMemberAccessReconciliations: 0,
  })
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.className = ""
  vi.unstubAllGlobals()
})

describe("Task 15 protected layouts", () => {
  it("guards and keys the platform provider by verified identity", async () => {
    const context = createPlatformContext()
    mocks.requirePlatformContext.mockResolvedValueOnce(context)

    const element = await PlatformLayout({ children: <p>Conteúdo</p> })

    expect(platformDynamic).toBe("force-dynamic")
    expect(mocks.requirePlatformContext).toHaveBeenCalledTimes(1)
    expect(element.key).toBe(`${context.userId}:platform`)
    expect(element.props).toMatchObject({
      companyId: null,
      initialTheme: "dark",
      nonce: CSP_NONCE,
      profileVersion: context.profile.version,
      userId: context.userId,
    })
    expect(element.props.children.props.context).toEqual({
      profile: context.profile,
    })
    expect(JSON.stringify(element.props.children.props.context)).not.toContain(
      context.sessionId,
    )
  })

  it("guards and keys the company provider by verified user and tenant", async () => {
    const context = createCompanyContext()
    mocks.requireCompanyContext.mockResolvedValueOnce(context)

    const element = await AppLayout({ children: <p>Conteúdo</p> })

    expect(appDynamic).toBe("force-dynamic")
    expect(mocks.requireCompanyContext).toHaveBeenCalledTimes(1)
    expect(element.key).toBe(`${context.userId}:${context.companyId}`)
    expect(element.props).toMatchObject({
      companyId: context.companyId,
      initialTheme: "dark",
      nonce: CSP_NONCE,
      profileVersion: context.profile.version,
      userId: context.userId,
    })
    expect(element.props.children.props.context).toEqual({
      modules: context.modules,
      profile: context.profile,
      role: context.role,
    })
    const serializedShellContext = JSON.stringify(
      element.props.children.props.context,
    )
    expect(serializedShellContext).not.toContain(context.sessionId)
    expect(serializedShellContext).not.toContain(context.membershipId)
  })

  it("threads the request CSP nonce into the protected theme bootstrap", () => {
    const themeElement = AxsysThemeProvider({
      children: <p>Protegido</p>,
      initialTheme: "dark",
      nonce: CSP_NONCE,
      userId: "10000000-0000-4000-8000-000000000001",
    })
    expect(themeElement.props.nonce).toBe(CSP_NONCE)

    const scopedElement = ScopedProviders({
      children: <p>Protegido</p>,
      companyId: null,
      initialTheme: "dark",
      nonce: CSP_NONCE,
      profileVersion: 1,
      userId: "10000000-0000-4000-8000-000000000001",
    })
    expect(scopedElement.props.nonce).toBe(CSP_NONCE)
  })

  it("makes the fresh database theme authoritative over stale browser storage and prop refreshes", async () => {
    const userId = "10000000-0000-4000-8000-000000000001"
    localStorage.setItem(`axsys-theme:${userId}`, "light")
    const { rerender } = render(
      <ScopedProviders
        companyId={null}
        initialTheme="dark"
        nonce={CSP_NONCE}
        profileVersion={1}
        userId="10000000-0000-4000-8000-000000000001"
      >
        <p>Protegido</p>
      </ScopedProviders>,
    )

    await vi.waitFor(() => {
      expect(document.documentElement).toHaveClass("dark")
      expect(localStorage.getItem(`axsys-theme:${userId}`)).toBe("dark")
    })

    rerender(
      <ScopedProviders
        companyId={null}
        initialTheme="light"
        nonce={CSP_NONCE}
        profileVersion={2}
        userId={userId}
      >
        <p>Protegido</p>
      </ScopedProviders>,
    )
    await vi.waitFor(() => {
      expect(document.documentElement).toHaveClass("light")
      expect(localStorage.getItem(`axsys-theme:${userId}`)).toBe("light")
    })
  })

  it("applies a persisted theme immediately without reloading the protected route", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/auth/me") {
          return Promise.resolve(
            Response.json({
              kind: "platform",
              userId: "10000000-0000-4000-8000-000000000001",
              modules: [],
              profile: {
                displayName: "Administrador",
                email: "admin@example.test",
                preferredTheme: "dark",
                version: 1,
              },
            }),
          )
        }
        if (path === "/api/auth/csrf") {
          return Promise.resolve(Response.json({ token: "csrf-token" }))
        }
        return Promise.resolve(
          Response.json({ preferredTheme: "light", version: 2 }),
        )
      }),
    )

    render(
      <ScopedProviders
        companyId={null}
        initialTheme="dark"
        nonce={CSP_NONCE}
        profileVersion={1}
        userId="10000000-0000-4000-8000-000000000001"
      >
        <ThemeToggle initialTheme="dark" initialVersion={1} />
      </ScopedProviders>,
    )
    await vi.waitFor(() => expect(document.documentElement).toHaveClass("dark"))

    await user.click(screen.getByRole("button", { name: "Ativar tema claro" }))

    await vi.waitFor(() => {
      expect(document.documentElement).toHaveClass("light")
      expect(localStorage.getItem("axsys-theme:10000000-0000-4000-8000-000000000001")).toBe(
        "light",
      )
    })
  })

  it("redirects the company portal root to its only canonical dashboard", () => {
    expect(() => AppIndex()).toThrow("REDIRECT:/app/dashboard")
  })
})

describe("Task 15 protected route states", () => {
  it.each([
    "src/app/(protected)/platform/page.tsx",
    "src/app/(protected)/app/dashboard/page.tsx",
  ])("keeps Server Component page %s free of client-only icon imports", (path) => {
    expect(readFileSync(path, "utf8")).not.toContain("@phosphor-icons/react")
  })

  it.each([
    ["plataforma", PlatformLoading],
    ["empresa", AppLoading],
  ])("renders a labelled skeleton for the %s portal", (_name, Loading) => {
    const { container } = render(<Loading />)
    expect(screen.getByRole("status")).toHaveAccessibleName("Carregando conteúdo")
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2)
  })

  it.each([
    ["plataforma", PlatformError],
    ["empresa", AppError],
  ])("keeps the %s error generic and retryable", (_name, ErrorBoundary) => {
    const reset = vi.fn()
    render(
      <ErrorBoundary
        error={new Error("foreign tenant company 90000000 secret")}
        reset={reset}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar esta área.",
    )
    expect(screen.getByRole("alert")).not.toHaveTextContent("foreign tenant")
    const retry = screen.getByRole("button", { name: "Tentar novamente" })
    expect(retry).toHaveClass("min-h-11")
    fireEvent.click(retry)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("uses truthful foundation copy without fabricated business metrics", async () => {
    const platform = render(await PlatformPage())
    expect(screen.getByRole("heading", { name: "Visão da plataforma" })).toBeVisible()
    expect(platform.container.textContent).not.toMatch(/R\$|\d+(?:[.,]\d+)?%/u)
    platform.unmount()

    const dashboard = render(<DashboardPage />)
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    expect(dashboard.container.textContent).not.toMatch(/R\$|\d+(?:[.,]\d+)?%/u)
  })
})
