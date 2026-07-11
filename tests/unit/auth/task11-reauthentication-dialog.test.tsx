import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

describe("Task 11 ReauthenticationDialog", () => {
  it("is accessible and retries only after an explicit successful confirmation", async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: "signed-csrf-token" }))
      .mockResolvedValueOnce(
        Response.json({
          kind: "platform",
          userId: "10000000-0000-4000-8000-000000000001",
          modules: [],
          profile: {
            displayName: "Platform Admin",
            email: "admin@example.test",
            preferredTheme: "dark",
            version: 1,
          },
        }),
      )

    render(
      <ReauthenticationDialog
        open
        onOpenChange={onOpenChange}
        onConfirmed={onConfirmed}
      />,
    )

    expect(
      screen.getByRole("dialog", { name: "Confirme sua senha" }),
    ).toBeVisible()
    const password = screen.getByLabelText("Senha atual")
    expect(password).toHaveAttribute("type", "password")
    expect(password).toHaveAttribute("autocomplete", "current-password")
    expect(onConfirmed).not.toHaveBeenCalled()

    await user.type(password, "current-password-value")
    await user.click(screen.getByRole("button", { name: "Confirmar" }))

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/reauthenticate",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "signed-csrf-token",
        },
        body: JSON.stringify({ password: "current-password-value" }),
        signal: expect.any(AbortSignal),
      },
    )
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      onConfirmed.mock.invocationCallOrder[0],
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows a stable inline error and never retries after a rejected password", async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn()
    const onOpenChange = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "signed-csrf-token" }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "AUTH_INVALID_CREDENTIALS",
              message: "Senha atual inválida.",
              correlationId: "80000000-0000-4000-8000-000000000001",
            },
          },
          { status: 401 },
        ),
      )

    render(
      <ReauthenticationDialog
        open
        onOpenChange={onOpenChange}
        onConfirmed={onConfirmed}
      />,
    )
    const password = screen.getByLabelText("Senha atual")
    await user.type(password, "wrong-password")
    await user.click(screen.getByRole("button", { name: "Confirmar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Senha atual inválida.",
    )
    expect(password).toHaveValue("")
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("allows only one synchronous submit before React commits pending state", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined))

    render(
      <ReauthenticationDialog
        open
        onOpenChange={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText("Senha atual"), "current-password")
    const form = screen.getByRole("button", { name: "Confirmar" }).closest(
      "form",
    )
    expect(form).not.toBeNull()

    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("cancels without retrying and stores no credential or token", async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ReauthenticationDialog
        open
        onOpenChange={onOpenChange}
        onConfirmed={onConfirmed}
      />,
    )
    await user.type(screen.getByLabelText("Senha atual"), "never-persist-this")
    await user.click(screen.getByRole("button", { name: "Cancelar" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()

    const source = readFileSync(
      resolve("src/modules/auth/ui/reauthentication-dialog.tsx"),
      "utf8",
    )
    expect(source).not.toMatch(/localStorage|sessionStorage/u)
    expect(source).not.toMatch(/console\.|logger\./u)
  })
})
