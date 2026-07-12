import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { BankAccountDialog } from "@/modules/platform/ui/bank-account-dialog"
import { CompanyDetail } from "@/modules/platform/ui/company-detail"
import { CompanyList } from "@/modules/platform/ui/company-list"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

describe("Task 9 platform portal UI", () => {
  it("distinguishes an empty company directory from a failed load", () => {
    const { rerender } = render(<CompanyList companies={[]} />)
    expect(screen.getByText("Nenhuma empresa cadastrada")).toBeVisible()

    rerender(<CompanyList companies={[]} state="temporarily-unavailable" />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar as empresas",
    )
  })

  it("clears bank plaintext when the dialog is cancelled", async () => {
    const user = userEvent.setup()
    render(
      <BankAccountDialog
        companyId="10000000-0000-4000-8000-000000000001"
        open
        onOpenChange={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText("Agência"), "1567")
    await user.type(screen.getByLabelText("Conta"), "482901")
    await user.click(screen.getByRole("button", { name: "Cancelar" }))

    expect(screen.getByLabelText("Agência")).toHaveValue("")
    expect(screen.getByLabelText("Conta")).toHaveValue("")
  })

  it("requires an explicit active replacement before archiving a default account", async () => {
    const user = userEvent.setup()
    render(<CompanyDetail detail={{
      company: { id: "10000000-0000-4000-8000-000000000001", legalName: "Fornecimentos do Sertão Ltda", tradeName: "Sertão Público", cnpj: "11222333000181", contactEmail: "financeiro@sertao.test", contactPhone: null, timezone: "America/Fortaleza", status: "active", version: 4, createdAt: "2026-07-12T10:00:00.000Z", updatedAt: "2026-07-12T10:00:00.000Z" },
      admins: [],
      bankAccounts: [
        { id: "20000000-0000-4000-8000-000000000001", bankCode: "001", bankName: "Banco do Brasil", branchLast4: "1567", accountLast4: "2901", accountType: "checking", isDefault: true, status: "active", version: 2 },
        { id: "20000000-0000-4000-8000-000000000002", bankCode: "104", bankName: "Caixa", branchLast4: "3012", accountLast4: "8840", accountType: "checking", isDefault: false, status: "active", version: 1 },
      ],
      counters: { activeAdmins: 0, activeUsers: 0, bankAccounts: 2 },
    }} />)

    await user.click(screen.getByRole("button", { name: "Arquivar conta padrão" }))
    expect(screen.getByRole("button", { name: "Confirmar arquivamento" })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText("Nova conta padrão"), "20000000-0000-4000-8000-000000000002")
    expect(screen.getByRole("button", { name: "Confirmar arquivamento" })).toBeEnabled()
  })

  it("collects a bounded company archive reason in an accessible dialog", async () => {
    const user = userEvent.setup()
    render(<CompanyDetail detail={{
      company: { id: "10000000-0000-4000-8000-000000000001", legalName: "Fornecimentos do Sertão Ltda", tradeName: "Sertão Público", cnpj: "11222333000181", contactEmail: "financeiro@sertao.test", contactPhone: null, timezone: "America/Fortaleza", status: "active", version: 4, createdAt: "2026-07-12T10:00:00.000Z", updatedAt: "2026-07-12T10:00:00.000Z" }, admins: [], bankAccounts: [], counters: { activeAdmins: 0, activeUsers: 0, bankAccounts: 0 },
    }} />)

    await user.click(screen.getByRole("button", { name: /^Arquivar$/u }))
    expect(screen.getByRole("dialog", { name: "Arquivar empresa" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Confirmar arquivamento" })).toBeDisabled()
    await user.type(screen.getByLabelText("Motivo do arquivamento"), "Contrato encerrado pelo fornecedor")
    expect(screen.getByRole("button", { name: "Confirmar arquivamento" })).toBeEnabled()
  })
})
