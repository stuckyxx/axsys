import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AxsysLogo } from "@/components/brand/axsys-logo"

vi.mock("next/image", () => ({
  default: ({ preload = false, priority = false }: { preload?: boolean; priority?: boolean }) => (
    <span
      data-preload={String(preload)}
      data-priority={String(priority)}
      data-testid="axsys-image"
    />
  ),
}))

describe("AxsysLogo", () => {
  it("expõe nome acessível e variantes compacta e horizontal", () => {
    const { rerender } = render(<AxsysLogo variant="horizontal" />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-variant", "horizontal")

    rerender(<AxsysLogo variant="compact" monochrome />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-monochrome", "true")
    expect(screen.queryByText("Axsys")).not.toBeInTheDocument()
  })

  it("não solicita preload por padrão e permite opt-in explícito", () => {
    const { rerender } = render(<AxsysLogo />)

    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-preload", "false")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-priority", "false")

    rerender(<AxsysLogo preload />)

    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-preload", "true")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-priority", "false")
  })
})
