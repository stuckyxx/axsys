import { describe, expect, it, vi } from "vitest"

import { navigateToAuthenticatedPortal } from "@/modules/auth/ui/authenticated-navigation"

describe("authenticated portal navigation", () => {
  it("replaces the full document so a scoped theme provider is server-rendered", () => {
    const replace = vi.fn()

    navigateToAuthenticatedPortal("/platform", { replace })

    expect(replace).toHaveBeenCalledWith("/platform")
  })
})
