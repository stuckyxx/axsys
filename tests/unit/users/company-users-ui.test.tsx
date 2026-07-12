import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CompanyUsersPage, type CompanyUserSummary } from "@/modules/users/ui/company-users-page"
import { UserForm } from "@/modules/users/ui/user-form"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const USER: CompanyUserSummary = {
  membershipId: "10000000-0000-4000-8000-000000000010",
  userId: "20000000-0000-4000-8000-000000000010",
  displayName: "Marina Albuquerque",
  email: "marina@example.test",
  role: "member",
  status: "active",
  modules: ["financial"],
  version: 3,
  createdAt: "2026-07-12T10:00:00.000Z",
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()))

describe("Task 7 company users UI", () => {
  it("hydrates deep pagination state from SSR and returns to the exact previous cursor", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [USER], nextCursor: null }))

    render(<CompanyUsersPage initialUsers={[USER]} initialNextCursor={null} currentMembershipId="10000000-0000-4000-8000-000000000099" initialQuery="marina" initialCursor="10000000-0000-4000-8000-000000000030" initialPreviousCursor="10000000-0000-4000-8000-000000000020" />)

    expect(screen.getByRole("searchbox", { name: "Buscar no diretório" })).toHaveValue("marina")
    await user.click(screen.getByRole("button", { name: "Página anterior" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("cursor=10000000-0000-4000-8000-000000000020"),
      expect.objectContaining({ cache: "no-store" }),
    ))
  })

  it("keeps the CAS conflict announced after refreshing the authoritative row", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "signed-csrf" }))
      .mockResolvedValueOnce(Response.json({ error: { code: "VERSION_CONFLICT", message: "Conflito." } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ items: [{ ...USER, version: 4 }], nextCursor: null }))

    render(<CompanyUsersPage initialUsers={[USER]} initialNextCursor={null} currentMembershipId="10000000-0000-4000-8000-000000000099" initialQuery="" initialCursor={null} initialPreviousCursor={null} />)
    await user.click(screen.getAllByRole("button", { name: "Editar acesso" })[0])
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Este acesso foi alterado em outra sessão")
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(screen.getByRole("alert")).toHaveTextContent("O diretório foi atualizado")
  })

  it("reauthenticates and retries creation without asking for the provisional password again", async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "csrf-1" }))
      .mockResolvedValueOnce(Response.json({ error: { code: "REAUTHENTICATION_REQUIRED", message: "Confirme sua senha." } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ token: "csrf-2" }))
      .mockResolvedValueOnce(Response.json({ kind: "company" }))
      .mockResolvedValueOnce(Response.json({ token: "csrf-3" }))
      .mockResolvedValueOnce(Response.json({ operationId: "30000000-0000-4000-8000-000000000001" }, { status: 201 }))

    render(<UserForm open onClose={vi.fn()} onCreated={onCreated} />)
    await user.type(screen.getByLabelText("Nome completo"), "Marina Albuquerque")
    await user.type(screen.getByLabelText("E-mail"), "marina@example.test")
    await user.type(screen.getByLabelText("Senha", { selector: "#new-user-password" }), "Senha provisória forte 42!")
    await user.type(screen.getByLabelText("Confirmação"), "Senha provisória forte 42!")
    await user.click(screen.getByRole("button", { name: "Criar acesso" }))

    expect(await screen.findByRole("dialog", { name: "Confirme sua senha" })).toBeVisible()
    await user.type(screen.getByLabelText("Senha atual"), "senha-atual-segura")
    await user.click(screen.getByRole("button", { name: "Confirmar" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/company/users")).toHaveLength(2)
  })

  it("keeps the accessible dialog mounted and cancellation disabled while create is in flight", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "csrf-1" }))
      .mockReturnValueOnce(new Promise<Response>(() => undefined))

    render(<UserForm open onClose={onClose} onCreated={vi.fn()} />)
    await user.type(screen.getByLabelText("Nome completo"), "Marina Albuquerque")
    await user.type(screen.getByLabelText("E-mail"), "marina@example.test")
    await user.type(screen.getByLabelText("Senha", { selector: "#new-user-password" }), "Senha provisória forte 42!")
    await user.type(screen.getByLabelText("Confirmação"), "Senha provisória forte 42!")
    await user.click(screen.getByRole("button", { name: "Criar acesso" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Criando..." })).toBeDisabled())
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Fechar" })).toBeDisabled()
    expect(screen.getByRole("dialog", { name: "Novo acesso" })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })
})
