import { beforeEach, describe, expect, it, vi } from "vitest"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

import HomePage from "../../../src/app/page"

describe("HomePage", () => {
  beforeEach(() => {
    redirectMock.mockClear()
  })

  it("redirects the root route to /login", () => {
    HomePage()

    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })
})
