import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useTheme } from "next-themes"
import { afterEach, describe, expect, it, vi } from "vitest"

import PublicLayout from "@/app/(public)/layout"
import { AppProviders } from "@/components/providers/app-providers"
import { Toaster } from "@/components/ui/sonner"
import { AxsysThemeProvider } from "@/lib/theme/theme-provider"

vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme?: string }) => (
    <div data-testid="sonner-toaster" data-theme={theme} />
  ),
}))

function ThemeControls() {
  const { setTheme } = useTheme()

  return (
    <>
      <button type="button" onClick={() => setTheme("light")}>
        Usar tema claro
      </button>
      <Toaster />
    </>
  )
}

afterEach(() => {
  localStorage.clear()
  document.documentElement.className = ""
  document.documentElement.style.colorScheme = ""
})

describe("AxsysThemeProvider", () => {
  it("usa dark como padrão e isola a chave visual por usuário", () => {
    render(
      <AxsysThemeProvider userId="user-a" initialTheme="dark">
        <span>conteúdo</span>
      </AxsysThemeProvider>,
    )
    expect(document.documentElement).toHaveClass("dark")
    expect(localStorage.getItem("axsys-theme:user-b")).toBeNull()
  })

  it("mantém a área pública dark sem provider ou chave de armazenamento", () => {
    const { container } = render(
      <AppProviders>
        <PublicLayout>
          <span>Área pública</span>
        </PublicLayout>
      </AppProviders>,
    )

    expect(screen.getByText("Área pública").parentElement).toHaveClass("dark", "min-h-dvh")
    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-theme", "dark")
    expect(container.querySelectorAll("script")).toHaveLength(0)
    expect(localStorage.getItem("axsys-theme:public")).toBeNull()
  })

  it("mantém um único provider por usuário e restaura o tema em uma nova montagem", async () => {
    const firstTab = render(
      <AppProviders>
        <AxsysThemeProvider userId="user-a" initialTheme="dark">
          <ThemeControls />
        </AxsysThemeProvider>
      </AppProviders>,
    )

    expect(firstTab.container.querySelectorAll("script")).toHaveLength(1)
    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-theme", "dark")
    expect(localStorage.getItem("axsys-theme:public")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }))

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light")
      expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-theme", "light")
    })
    expect(localStorage.getItem("axsys-theme:user-a")).toBe("light")
    expect(localStorage.getItem("axsys-theme:public")).toBeNull()

    firstTab.unmount()
    document.documentElement.className = ""

    const nextTab = render(
      <AppProviders>
        <AxsysThemeProvider userId="user-a" initialTheme="dark">
          <ThemeControls />
        </AxsysThemeProvider>
      </AppProviders>,
    )

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light")
      expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-theme", "light")
    })
    expect(nextTab.container.querySelectorAll("script")).toHaveLength(1)
    expect(localStorage.getItem("axsys-theme:public")).toBeNull()
  })
})
