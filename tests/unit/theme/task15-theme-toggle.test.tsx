import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PROFILE_THEME_INVALIDATED_EVENT,
  ThemeToggle,
} from "@/components/theme/theme-toggle"

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: "dark" as "dark" | "light",
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: mocks.setTheme, theme: mocks.theme }),
}))

const CSRF_TOKEN = "csrf-token-in-memory"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.theme = "dark"
  mocks.setTheme.mockReset()
  vi.stubGlobal("fetch", vi.fn())
})

describe("Task 15 theme toggle", () => {
  it("keeps the global theme unchanged until the server persists the optimistic choice", async () => {
    const user = userEvent.setup()
    const persisted = deferredResponse()
    const onProfileInvalidated = vi.fn()
    const browserInvalidation = vi.fn()
    window.addEventListener(PROFILE_THEME_INVALIDATED_EVENT, browserInvalidation, {
      once: true,
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: CSRF_TOKEN }))
      .mockReturnValueOnce(persisted.promise)

    render(
      <ThemeToggle
        initialTheme="dark"
        initialVersion={7}
        onProfileInvalidated={onProfileInvalidated}
      />,
    )

    const toggle = screen.getByRole("button", { name: "Ativar tema claro" })
    expect(toggle).toHaveClass("size-11")
    expect(toggle).toHaveAttribute("data-selected-theme", "dark")

    await user.click(toggle)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    expect(screen.getByRole("button", { name: "Ativar tema escuro" })).toHaveAttribute(
      "data-selected-theme",
      "light",
    )
    expect(mocks.setTheme).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal),
    })
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/profile/theme", {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": CSRF_TOKEN,
      },
      body: JSON.stringify({ theme: "light", version: 7 }),
      signal: expect.any(AbortSignal),
    })

    persisted.resolve(jsonResponse({ preferredTheme: "light", version: 8 }))

    await waitFor(() => {
      expect(mocks.setTheme).toHaveBeenCalledWith("light")
      expect(onProfileInvalidated).toHaveBeenCalledTimes(1)
      expect(browserInvalidation).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("rolls back its selection and exposes a generic accessible error", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: CSRF_TOKEN }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "Detalhe não confiável do servidor",
              correlationId: "80000000-0000-4000-8000-000000000001",
            },
          },
          500,
        ),
      )

    render(<ThemeToggle initialTheme="dark" initialVersion={4} />)
    await user.click(screen.getByRole("button", { name: "Ativar tema claro" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Não foi possível salvar o tema. Tente novamente.")
    expect(screen.getByRole("button", { name: "Ativar tema claro" })).toHaveAttribute(
      "data-selected-theme",
      "dark",
    )
    expect(mocks.setTheme).not.toHaveBeenCalled()
  })

  it("uses the current server version after a 409 without overwriting it", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: CSRF_TOKEN }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "VERSION_CONFLICT",
              message: "Os dados mudaram em outra sessão.",
              correlationId: "80000000-0000-4000-8000-000000000001",
            },
            current: { preferredTheme: "light", version: 9 },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ preferredTheme: "dark", version: 10 }))

    render(<ThemeToggle initialTheme="dark" initialVersion={3} />)
    const toggle = screen.getByRole("button", { name: "Ativar tema claro" })
    await user.click(toggle)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Os dados mudaram em outra sessão. Tente novamente.",
    )
    expect(screen.getByRole("button", { name: "Ativar tema escuro" })).toHaveAttribute(
      "data-selected-theme",
      "light",
    )
    expect(mocks.setTheme).toHaveBeenCalledWith("light")
    await user.click(screen.getByRole("button", { name: "Ativar tema escuro" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/profile/theme",
      expect.objectContaining({
        body: JSON.stringify({ theme: "dark", version: 9 }),
      }),
    )
    await waitFor(() => expect(mocks.setTheme).toHaveBeenLastCalledWith("dark"))
  })

  it("ignores repeated activation while a save is in flight", async () => {
    const user = userEvent.setup()
    const persisted = deferredResponse()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: CSRF_TOKEN }))
      .mockReturnValueOnce(persisted.promise)

    render(<ThemeToggle initialTheme="dark" initialVersion={1} />)
    const toggle = screen.getByRole("button", { name: "Ativar tema claro" })
    await user.dblClick(toggle)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    persisted.resolve(jsonResponse({ preferredTheme: "light", version: 2 }))
    await waitFor(() => expect(mocks.setTheme).toHaveBeenCalledTimes(1))
  })
})
