import { describe, expect, it } from "vitest"

describe("Vitest UI project", () => {
  it("runs TSX unit tests with browser globals", () => {
    const element = document.createElement("div")

    expect(window.document).toBe(document)
    expect(element).toBeInstanceOf(HTMLElement)
  })
})
