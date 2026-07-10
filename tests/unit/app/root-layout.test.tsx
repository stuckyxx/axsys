import { describe, expect, it, vi } from "vitest"

const { connectionMock } = vi.hoisted(() => ({
  connectionMock: vi.fn(),
}))

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}))

vi.mock("next/server", () => ({
  connection: connectionMock,
}))

import RootLayout from "@/app/layout"

describe("RootLayout", () => {
  it("mantém o HTML dark-first para portais sem remover as variáveis Geist", async () => {
    const result = await RootLayout({ children: <span>conteúdo</span> })

    expect(connectionMock).toHaveBeenCalledOnce()
    expect(result.type).toBe("html")
    expect(result.props.className.split(" ")).toEqual(
      expect.arrayContaining(["dark", "font-geist-sans", "font-geist-mono"]),
    )
  })
})
