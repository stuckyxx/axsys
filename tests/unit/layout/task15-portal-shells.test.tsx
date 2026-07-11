import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CompanyShell } from "@/components/layout/company-shell"
import { PlatformShell } from "@/components/layout/platform-shell"
import {
  createCompanyContext,
  createPlatformContext,
} from "../../helpers/auth"

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/dashboard",
}))

describe("Task 15 portal shells", () => {
  it("keeps the platform portal visually and semantically separate", () => {
    render(
      <PlatformShell context={createPlatformContext()}>
        <h1>Visão geral da plataforma</h1>
      </PlatformShell>,
    )

    const desktopNavigation = screen.getByRole("navigation", {
      name: "Navegação da plataforma",
    })
    for (const label of [
      "Visão geral",
      "Empresas",
      "Administradores",
      "Auditoria",
      "Saúde",
    ]) {
      expect(within(desktopNavigation).getByRole("link", { name: label })).toBeVisible()
    }
    expect(within(desktopNavigation).queryByText("Financeiro")).not.toBeInTheDocument()
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("heading", { name: "Visão geral da plataforma" }),
    )
  })

  it("derives the company navigation only from the verified context", () => {
    const context = {
      ...createCompanyContext(),
      role: "member" as const,
      modules: Object.freeze(["financial"] as const),
    }

    render(
      <CompanyShell context={context}>
        <h1>Dashboard</h1>
      </CompanyShell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Navegação da empresa",
    })
    expect(within(navigation).getByRole("link", { name: "Dashboard" })).toBeVisible()
    expect(within(navigation).getByRole("link", { name: "Financeiro" })).toBeVisible()
    expect(within(navigation).getByRole("link", { name: "Perfil" })).toBeVisible()
    expect(within(navigation).queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole("link", { name: "Empresa" })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole("link", { name: "Administrativo" })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole("link", { name: "Certidões" })).not.toBeInTheDocument()
  })

  it("exposes admin destinations and every DB-derived module to company admins", () => {
    render(
      <CompanyShell context={createCompanyContext()}>
        <h1>Dashboard</h1>
      </CompanyShell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Navegação da empresa",
    })
    for (const label of [
      "Dashboard",
      "Administrativo",
      "Financeiro",
      "Certidões",
      "Usuários",
      "Perfil",
      "Empresa",
    ]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible()
    }
  })

  it("uses accessible 44px controls for mobile and tablet navigation", async () => {
    render(
      <PlatformShell context={createPlatformContext()}>
        <h1>Visão geral</h1>
      </PlatformShell>,
    )

    const mobileTrigger = screen.getByRole("button", { name: "Abrir menu" })
    const railTrigger = screen.getByRole("button", {
      name: "Expandir navegação",
    })
    expect(mobileTrigger).toHaveClass("size-11")
    expect(railTrigger).toHaveClass("size-11")

    fireEvent.click(mobileTrigger)
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("navigation", { name: "Menu móvel da plataforma" })).toBeVisible()
    expect(
      within(dialog).getByRole("navigation", { name: "Menu móvel da plataforma" }),
    ).toHaveClass("min-h-0", "overflow-y-auto")
    expect(within(dialog).getByRole("button", { name: "Fechar menu" })).toHaveClass(
      "size-11",
    )
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await waitFor(() => expect(mobileTrigger).toHaveFocus())
  })

  it("closes the persistent mobile overlay after a navigation choice", async () => {
    render(
      <PlatformShell context={createPlatformContext()}>
        <h1>Visão geral</h1>
      </PlatformShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }))
    const dialog = screen.getByRole("dialog")
    const destination = within(dialog).getByRole("link", { name: "Visão geral" })
    destination.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(destination)

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })
})
