import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import ChangePasswordPage from "@/app/(public)/change-password/page"
import LoginPage from "@/app/(public)/login/page"
import ResetPasswordPage from "@/app/(public)/reset-password/page"
import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form"
import { LoginForm } from "@/modules/auth/ui/login-form"
import { PasswordForm } from "@/modules/auth/ui/password-form"

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  getAccessContext: vi.fn(),
  portalNavigate: vi.fn(),
  redirect: vi.fn((location: string): never => {
    throw new Error(`REDIRECT:${location}`)
  }),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock("@/modules/auth/server/get-access-context", () => ({
  getAccessContext: mocks.getAccessContext,
}))
vi.mock("@/modules/auth/ui/authenticated-navigation", () => ({
  navigateToAuthenticatedPortal: mocks.portalNavigate,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}))

const CSRF_TOKEN = "signed-csrf-token"
const NEUTRAL_RECOVERY_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos as instruções."

function csrfResponse(): Response {
  return Response.json({ token: CSRF_TOKEN })
}

function apiError(
  message: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  return Response.json(
    {
      error: {
        code: "VALIDATION_FAILED",
        message,
        correlationId: "80000000-0000-4000-8000-000000000001",
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
    { status: 422 },
  )
}

function deferredResponse(): {
  promise: Promise<Response>
  resolve: (response: Response) => void
} {
  let resolvePromise: ((response: Response) => void) | undefined
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(response) {
      if (!resolvePromise) throw new Error("Deferred response is unavailable")
      resolvePromise(response)
    },
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

describe("Task 14 authentication forms", () => {
  it("renders the real horizontal brand inside one static, capped auth card", () => {
    const { container } = render(
      <AuthShell title="Acessar Axsys" description="Ambiente restrito.">
        <p>Conteúdo seguro</p>
      </AuthShell>,
    )

    expect(screen.getByRole("img", { name: "Axsys" })).toHaveAttribute(
      "data-variant",
      "horizontal",
    )
    expect(screen.getByRole("heading", { name: "Acessar Axsys" })).toBeVisible()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="card"]')).toHaveClass(
      "max-w-md",
    )
    expect(container.querySelector("main > div")).toHaveClass(
      "sm:min-h-[calc(100dvh-6rem)]",
    )

    const source = readFileSync(
      resolve("src/modules/auth/ui/auth-shell.tsx"),
      "utf8",
    )
    expect(source).not.toMatch(/animate-|framer-motion|keyframes/iu)
  })

  it("associates login labels, exposes autocomplete, and focuses the first invalid field", async () => {
    const user = userEvent.setup()
    render(<LoginForm />)

    const email = screen.getByLabelText("E-mail")
    const password = screen.getByLabelText("Senha")
    const rememberMe = screen.getByLabelText("Manter conectado")

    expect(email).toHaveAttribute("autocomplete", "email")
    expect(password).toHaveAttribute("autocomplete", "current-password")
    expect(rememberMe).toHaveAttribute("type", "button")
    expect(
      screen.getByRole("link", { name: "Esqueci minha senha" }),
    ).toHaveAttribute("href", "/forgot-password")
    expect(
      screen.getByRole("link", { name: "Esqueci minha senha" }),
    ).toHaveClass("inline-flex", "min-h-11")

    await user.click(screen.getByRole("button", { name: "Entrar" }))

    await waitFor(() => expect(email).toHaveFocus())
    expect(email).toHaveAttribute("aria-invalid", "true")
    expect(email).toHaveAttribute("aria-describedby", "login-email-error")
    expect(password).toHaveAttribute("aria-invalid", "true")
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("submits with Enter exactly once, preserves password bytes, and sends the strict login payload", async () => {
    const user = userEvent.setup()
    const mutation = deferredResponse()
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfResponse())
      .mockReturnValueOnce(mutation.promise)

    render(<LoginForm />)
    await user.type(screen.getByLabelText("E-mail"), "  PESSOA@EXAMPLE.TEST  ")
    await user.type(screen.getByLabelText("Senha"), "  senha com espaços  ")
    await user.click(screen.getByLabelText("Manter conectado"))
    await user.click(screen.getByLabelText("Senha"))
    await user.keyboard("{Enter}")

    const pendingButton = await screen.findByRole("button", {
      name: "Entrando...",
    })
    expect(pendingButton).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(2)

    await user.keyboard("{Enter}")
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal),
    })
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/login", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": CSRF_TOKEN,
      },
      body: JSON.stringify({
        email: "pessoa@example.test",
        password: "  senha com espaços  ",
        rememberMe: true,
      }),
      signal: expect.any(AbortSignal),
    })

    mutation.resolve(Response.json({ redirectTo: "/platform" }))
    await waitFor(() =>
      expect(mocks.portalNavigate).toHaveBeenCalledWith("/platform"),
    )
  })

  it("never follows a redirect outside the server response allowlist", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        Response.json({ redirectTo: "https://attacker.example/steal" }),
      )

    render(<LoginForm />)
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test")
    await user.type(screen.getByLabelText("Senha"), "senha-segura")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível concluir o acesso.",
    )
    expect(mocks.portalNavigate).not.toHaveBeenCalled()
  })

  it("completes loading and navigation after the React StrictMode effect replay", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(Response.json({ redirectTo: "/platform" }))

    render(
      <StrictMode>
        <LoginForm />
      </StrictMode>,
    )
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test")
    await user.type(screen.getByLabelText("Senha"), "senha-segura")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    await waitFor(() =>
      expect(mocks.portalNavigate).toHaveBeenCalledWith("/platform"),
    )
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled()
  })

  it("drops a rejected CSRF token and fetches a fresh one only on the next explicit submit", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "stale-csrf-token" }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "CSRF_INVALID",
              message: "Recarregue a proteção da solicitação.",
              correlationId: "80000000-0000-4000-8000-000000000002",
            },
          },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ token: "fresh-csrf-token" }))
      .mockResolvedValueOnce(Response.json({ redirectTo: "/platform" }))

    render(<LoginForm />)
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test")
    await user.type(screen.getByLabelText("Senha"), "senha-segura")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recarregue a proteção da solicitação.",
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.portalNavigate).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Entrar" }))

    await waitFor(() =>
      expect(mocks.portalNavigate).toHaveBeenCalledWith("/platform"),
    )
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal),
    })
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/auth/login",
      expect.objectContaining({
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "fresh-csrf-token",
        },
      }),
    )
  })

  it("maps server field errors, announces them, and focuses the first rejected field", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        apiError("Revise os campos informados.", {
          email: ["E-mail recusado."],
          password: ["Senha recusada."],
        }),
      )

    render(<LoginForm />)
    const email = screen.getByLabelText("E-mail")
    await user.type(email, "pessoa@example.test")
    await user.type(screen.getByLabelText("Senha"), "senha-segura")
    await user.click(screen.getByRole("button", { name: "Entrar" }))

    expect(await screen.findByText("E-mail recusado.")).toHaveAttribute(
      "role",
      "alert",
    )
    await waitFor(() => expect(email).toHaveFocus())
  })

  it("replaces forgot-password input with the fixed neutral message on 202", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        Response.json(
          { message: "A resposta do servidor não altera o texto neutro." },
          { status: 202 },
        ),
      )

    render(<ForgotPasswordForm />)
    const email = screen.getByLabelText("E-mail")
    expect(email).toHaveAttribute("autocomplete", "email")
    await user.type(email, "pessoa@example.test")
    await user.keyboard("{Enter}")

    expect(await screen.findByRole("status")).toHaveTextContent(
      NEUTRAL_RECOVERY_MESSAGE,
    )
    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument()
    const backToLogin = screen.getByRole("link", {
      name: "Voltar para o login",
    })
    expect(backToLogin).toHaveClass(
      "focus-visible:ring-3",
      "focus-visible:ring-ring/50",
    )
    await user.tab()
    expect(backToLogin).toHaveFocus()
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/forgot-password", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": CSRF_TOKEN,
      },
      body: JSON.stringify({ email: "pessoa@example.test" }),
      signal: expect.any(AbortSignal),
    })
  })

  it.each([
    ["temporary" as const, "/api/auth/change-password"],
    ["recovery" as const, "/api/auth/reset-password"],
  ])(
    "sends exact password bytes and keys in %s mode",
    async (mode, endpoint) => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(Response.json({ success: true }))

      render(<PasswordForm mode={mode} />)
      const password = screen.getByLabelText("Nova senha")
      const confirmation = screen.getByLabelText("Confirmar nova senha")
      expect(password).toHaveAttribute("autocomplete", "new-password")
      expect(confirmation).toHaveAttribute("autocomplete", "new-password")

      await user.type(password, "  senha nova com espaços  ")
      await user.type(confirmation, "  senha nova com espaços  ")
      await user.keyboard("{Enter}")

      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
      expect(fetch).toHaveBeenNthCalledWith(2, endpoint, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": CSRF_TOKEN,
        },
        body: JSON.stringify({
          password: "  senha nova com espaços  ",
          confirmation: "  senha nova com espaços  ",
        }),
        signal: expect.any(AbortSignal),
      })
    },
  )

  it("announces a password mismatch and focuses confirmation without a request", async () => {
    const user = userEvent.setup()
    render(<PasswordForm mode="recovery" />)

    await user.type(screen.getByLabelText("Nova senha"), "senha-nova")
    await user.type(screen.getByLabelText("Confirmar nova senha"), "diferente")
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }))

    const confirmation = screen.getByLabelText("Confirmar nova senha")
    await waitFor(() => expect(confirmation).toHaveFocus())
    expect(confirmation).toHaveAttribute("aria-invalid", "true")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "As senhas não coincidem.",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps CSRF and credentials in React memory only", () => {
    const sources = [
      "src/modules/auth/ui/use-secure-mutation.ts",
      "src/modules/auth/ui/login-form.tsx",
      "src/modules/auth/ui/forgot-password-form.tsx",
      "src/modules/auth/ui/password-form.tsx",
    ]
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n")

    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB/u)
    expect(sources).not.toMatch(/console\.|logger\./u)
    expect(sources).not.toMatch(/\.trim\(\).*password|password.*\.trim\(/iu)
  })

  it("keeps the login E2E identity random, local-only, and out of traces", () => {
    const source = readFileSync(
      resolve("tests/e2e/auth/login.spec.ts"),
      "utf8",
    )
    const fixtureSource = readFileSync(
      resolve("tests/e2e/auth/local-platform-fixture.ts"),
      "utf8",
    )
    const playwrightSource = readFileSync(resolve("playwright.config.ts"), "utf8")

    expect(source).not.toMatch(/AXSYS_|BOOTSTRAP|requireCredential/u)
    expect(fixtureSource).not.toMatch(/AXSYS_|BOOTSTRAP/u)
    expect(source).toMatch(/local-platform-fixture/u)
    expect(source).toMatch(/trace:\s*["']off["']/u)
    expect(fixtureSource).toMatch(/LOCAL_SUPABASE_PORT\s*=\s*["']54321["']/u)
    expect(fixtureSource).toMatch(/LOCAL_DATABASE_PORT\s*=\s*["']54322["']/u)
    expect(fixtureSource).toMatch(/delete from auth\.sessions/u)
    expect(fixtureSource).toMatch(/delete from auth\.refresh_tokens/u)
    expect(fixtureSource).toMatch(/deleteUser\(this\.userId, false\)/u)
    expect(fixtureSource).toMatch(/pg_stat_activity/u)
    expect(fixtureSource).not.toContain('"local-or-untrusted-proxy"')
    expect(fixtureSource).toMatch(/readonly clientIp/u)
    expect(source).toMatch(/setExtraHTTPHeaders/u)
    expect(playwrightSource).toMatch(/TRUST_PROXY:\s*["']true["']/u)
  })
})

describe("Task 14 public page guards", () => {
  it.each([
    [{ kind: "platform" }, "/platform"],
    [{ kind: "company" }, "/app/dashboard"],
  ])("redirects an existing safe context to %s", async (body, target) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body))

    render(<LoginPage />)
    await waitFor(() => expect(mocks.portalNavigate).toHaveBeenCalledWith(target))
    expect(fetch).toHaveBeenCalledWith("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal),
    })
  })

  it("redirects a provisional-password session without serializing it in Flight", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { error: { code: "PASSWORD_CHANGE_REQUIRED" } },
        { status: 403 },
      ),
    )

    render(<LoginPage />)
    await waitFor(() =>
      expect(mocks.portalNavigate).toHaveBeenCalledWith("/change-password"),
    )
  })

  it("renders login and does not redirect an anonymous or malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }),
    )

    render(<LoginPage />)
    expect(screen.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible()
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(mocks.portalNavigate).not.toHaveBeenCalled()

    const source = readFileSync(
      resolve("src/app/(public)/login/page.tsx"),
      "utf8",
    )
    expect(source).not.toContain("getAccessContext")
  })

  it("fails closed when reset-password has no verified recovery AMR", async () => {
    mocks.createServerSupabase.mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "password", timestamp: 1_784_000_000 }],
            },
          },
          error: null,
        }),
      },
    })

    await expect(ResetPasswordPage()).rejects.toThrow(
      "REDIRECT:/forgot-password",
    )
  })

  it("renders reset-password only with a verified recovery AMR", async () => {
    mocks.createServerSupabase.mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "recovery", timestamp: 1_784_000_000 }],
            },
          },
          error: null,
        }),
      },
    })

    render(await ResetPasswordPage())
    expect(screen.getByRole("heading", { name: "Defina uma nova senha" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeVisible()
  })

  it("shows no form when the temporary password is expired", async () => {
    const user = userEvent.setup()
    mocks.getAccessContext.mockResolvedValueOnce({
      status: "password_change",
      userId: "11111111-1111-4111-8111-111111111111",
      expired: true,
    })

    render(await ChangePasswordPage())
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A senha provisória não está mais disponível.",
    )
    expect(
      screen.getByRole("link", { name: "Recuperar acesso" }),
    ).toHaveAttribute("href", "/forgot-password")
    expect(
      screen.getByRole("link", { name: "Recuperar acesso" }),
    ).toHaveClass("focus-visible:ring-3", "focus-visible:ring-ring/50")
    await user.tab()
    expect(screen.getByRole("link", { name: "Recuperar acesso" })).toHaveFocus()
    expect(
      screen.queryByRole("button", { name: "Salvar nova senha" }),
    ).not.toBeInTheDocument()
  })

  it("redirects change-password unless the access state requires it", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({ status: "anonymous" })
    await expect(ChangePasswordPage()).rejects.toThrow("REDIRECT:/login")

    mocks.getAccessContext.mockResolvedValueOnce({
      status: "authenticated",
      context: { kind: "platform" },
    })
    await expect(ChangePasswordPage()).rejects.toThrow("REDIRECT:/platform")
  })
})
