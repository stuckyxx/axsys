import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AxsysLogo } from "@/components/brand/axsys-logo"

vi.mock("next/image", () => ({
  default: ({
    className,
    height,
    preload = false,
    priority = false,
    sizes,
    src,
    width,
  }: {
    className?: string
    height: number
    preload?: boolean
    priority?: boolean
    sizes?: string
    src: string
    width: number
  }) => (
    <span
      className={className}
      data-height={String(height)}
      data-preload={String(preload)}
      data-priority={String(priority)}
      data-sizes={sizes}
      data-src={src}
      data-testid="axsys-image"
      data-width={String(width)}
    />
  ),
}))

describe("AxsysLogo", () => {
  it("expõe nome acessível e variantes compacta e horizontal", () => {
    const { rerender } = render(<AxsysLogo variant="horizontal" />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-variant", "horizontal")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute(
      "data-src",
      "/brand/axsys-wordmark.png",
    )
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-width", "1942")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-height", "809")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-sizes", "132px")
    expect(screen.getByTestId("axsys-image")).toHaveClass("h-auto", "w-[132px]")

    rerender(<AxsysLogo variant="compact" monochrome />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-monochrome", "true")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute(
      "data-src",
      "/brand/axsys-mark-monochrome.png",
    )
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-width", "1254")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-height", "1254")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-sizes", "32px")
    expect(screen.getByTestId("axsys-image")).toHaveClass("size-8")
    expect(screen.queryByText("Axsys")).not.toBeInTheDocument()

    rerender(<AxsysLogo variant="horizontal" monochrome />)
    expect(screen.getByTestId("axsys-image")).toHaveAttribute(
      "data-src",
      "/brand/axsys-monochrome.png",
    )
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-width", "1942")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-height", "809")

    rerender(<AxsysLogo variant="compact" />)
    expect(screen.getByTestId("axsys-image")).toHaveAttribute(
      "data-src",
      "/brand/axsys-mark.png",
    )
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-width", "1254")
    expect(screen.getByTestId("axsys-image")).toHaveAttribute("data-height", "1254")
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
