import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AxsysLogo } from "@/components/brand/axsys-logo"

describe("AxsysLogo", () => {
  it("expõe nome acessível e variantes compacta e horizontal", () => {
    const { rerender } = render(<AxsysLogo variant="horizontal" />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-variant", "horizontal")

    rerender(<AxsysLogo variant="compact" monochrome />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-monochrome", "true")
    expect(screen.queryByText("Axsys")).not.toBeInTheDocument()
  })
})
