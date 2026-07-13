import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProfileForm } from "@/modules/settings/ui/profile-form"

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/modules/files/ui/image-upload-field", () => ({
  ImageUploadField: ({ onReady }: { onReady?: (file: { id: string }) => void }) => (
    <button type="button" onClick={() => onReady?.({ id: "73000000-0000-4000-8000-000000000001" })}>
      Concluir avatar seguro
    </button>
  ),
}))

const profile = Object.freeze({
  userId: "71000000-0000-4000-8000-000000000001",
  displayName: "Gabriel Machado",
  email: "gabriel@example.test",
  preferredTheme: "dark" as const,
  version: 4,
  avatarFileId: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn())
})

describe("profile form", () => {
  it("keeps email read-only and every control touch-safe", () => {
    render(<ProfileForm initialProfile={profile} allowAvatar />)

    expect(screen.getByLabelText("E-mail")).toBeDisabled()
    expect(screen.getByLabelText("Nome completo")).toHaveClass("min-h-11")
    expect(screen.getByRole("button", { name: "Salvar perfil" })).toHaveClass("min-h-11")
    expect(screen.getByText("A alteração de e-mail ainda não está disponível.")).toBeVisible()
    expect(screen.getByRole("button", { name: "Concluir avatar seguro" })).toBeVisible()
  })

  it("does not offer avatar upload to the platform identity", () => {
    render(<ProfileForm initialProfile={profile} allowAvatar={false} />)
    expect(screen.queryByRole("button", { name: "Concluir avatar seguro" })).toBeNull()
  })

  it("preserves the edited name on a CAS conflict", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "csrf-profile" }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "VERSION_CONFLICT", message: "Os dados mudaram." },
        current: profile,
      }, { status: 409 }))
    render(<ProfileForm initialProfile={profile} allowAvatar />)

    const name = screen.getByLabelText("Nome completo")
    await user.clear(name)
    await user.type(name, "Gabriel de Andrade Machado")
    await user.click(screen.getByRole("button", { name: "Salvar perfil" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("alterado em outra sessão")
    expect(name).toHaveValue("Gabriel de Andrade Machado")
  })

  it("attaches only the ready file id with the current CAS version", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: "csrf-avatar" }))
      .mockResolvedValueOnce(Response.json({ ...profile, version: 5, avatarFileId: "73000000-0000-4000-8000-000000000001" }))
    render(<ProfileForm initialProfile={profile} allowAvatar />)

    await user.click(screen.getByRole("button", { name: "Concluir avatar seguro" }))

    await vi.waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/profile/avatar",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ fileId: "73000000-0000-4000-8000-000000000001", version: 4 }),
      }),
    ))
  })
})
