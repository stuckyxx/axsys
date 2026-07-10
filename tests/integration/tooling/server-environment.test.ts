import "server-only"

import { describe, expect, it } from "vitest"

describe("Vitest server project", () => {
  it("runs integration tests without browser globals", () => {
    expect(typeof window).toBe("undefined")
  })
})
