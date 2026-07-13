import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CompanySettingsForm } from "@/modules/settings/ui/company-settings-form"
import { companySettingsAccess } from "@/modules/settings/server/company-settings-access"
import { createCompanyContext } from "../../helpers/auth"

vi.mock("@/modules/files/ui/image-upload-field", () => ({
  ImageUploadField: ({ label }: { label: string }) => <div>{label}</div>,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => vi.stubGlobal("fetch", vi.fn()))

const settings = {
  representativeName: "Maria Silva",
  representativeRole: "Diretora",
  representativeDocumentLast4: "4725",
  taxRate: 5,
  addressStreet: "Rua Central",
  addressNumber: "100",
  addressComplement: null,
  addressNeighborhood: "Centro",
  addressCity: "Fortaleza",
  addressState: "CE",
  addressPostalCode: "60000000",
  consolidatedAddress: "Rua Central, 100 · Fortaleza/CE · CEP 60000-000",
  letterheadFileId: null,
  signatureFileId: null,
  version: 2,
  updatedAt: "2026-07-12T20:00:00.000Z",
} as const

describe("company settings access and UI", () => {
  it("allows admins and administrative members to edit, financial members to read, and rejects others", () => {
    const base = createCompanyContext()
    expect(companySettingsAccess(base)).toBe("edit")
    expect(companySettingsAccess({ ...base, role: "member", modules: ["administrative"] })).toBe("edit")
    expect(companySettingsAccess({ ...base, role: "member", modules: ["financial"] })).toBe("read")
    expect(companySettingsAccess({ ...base, role: "member", modules: ["certificates"] })).toBe("forbidden")
  })

  it("never renders a complete CPF and keeps banks masked and read-only", () => {
    render(
      <CompanySettingsForm
        access="read"
        banks={[{
          id: crypto.randomUUID(), bankCode: "001", bankName: "Banco do Brasil",
          maskedBranch: "•234", maskedAccount: "••56", holderName: "Axsys",
          maskedHolderDocument: "••••4725", accountType: "checking", isDefault: true,
        }]}
        initialDraft={null}
        initialSettings={settings}
      />,
    )

    expect(screen.getByText("Final 4725")).toBeVisible()
    expect(screen.queryByText("52998224725")).not.toBeInTheDocument()
    expect(screen.getByText(/Agência •234 · Conta ••56/u)).toBeVisible()
    expect(screen.getByText(/Solicite alterações ao Super Admin/u)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Salvar configurações" })).not.toBeInTheDocument()
  })

  it("renders edit-only branding uploads and a 44px save action without browser storage", () => {
    render(
      <CompanySettingsForm
        access="edit"
        banks={[]}
        initialDraft={null}
        initialSettings={settings}
      />,
    )

    expect(screen.getByText("Papel timbrado")).toBeVisible()
    expect(screen.getByText("Assinatura institucional")).toBeVisible()
    expect(screen.getByRole("button", { name: "Salvar configurações" })).toHaveClass("min-h-11")
  })

  it("sends the strict official schema without draft-only baseVersion", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "csrf" }))
      .mockResolvedValueOnce(Response.json({ version: 3 }))
    render(<CompanySettingsForm access="edit" banks={[]} initialDraft={null} initialSettings={settings} />)

    await user.click(screen.getByRole("button", { name: "Salvar configurações" }))

    const [, options] = vi.mocked(fetch).mock.calls[1]!
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>
    expect(body.version).toBe(2)
    expect(body).not.toHaveProperty("baseVersion")
  })
})
