"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { BuildingsIcon, ShieldCheckIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"

const GENERIC_ERROR = "Não foi possível criar a empresa. Revise os dados e tente novamente."

type CompanyPayload = Readonly<{
  legalName: FormDataEntryValue | null
  tradeName: FormDataEntryValue | null
  cnpj: FormDataEntryValue | null
  contactEmail: FormDataEntryValue | null
  contactPhone: FormDataEntryValue | null
  timezone: FormDataEntryValue | null
  firstAdmin: Readonly<{
    displayName: FormDataEntryValue | null
    email: FormDataEntryValue | null
    temporaryPassword: string
    modules: FormDataEntryValue[]
  }>
}>

function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return GENERIC_ERROR
  }
  const error = body.error
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length <= 240
    ? error.message
    : GENERIC_ERROR
}

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null
  const error = body.error
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null
}

async function csrfToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  })
  const body = (await response.json()) as unknown
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    body.token.length === 0
  ) {
    throw new Error(GENERIC_ERROR)
  }
  return body.token
}

export function CompanyCreateForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [retryPayload, setRetryPayload] = useState<{ payload: CompanyPayload; key: string } | null>(null)

  async function provision(payload: CompanyPayload, key: string) {
    if (pending) return
    const controller = new AbortController()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const token = await csrfToken(controller.signal)
      const response = await fetch("/api/platform/companies", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-csrf-token": token, "idempotency-key": key },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as unknown
      const code = errorCode(body)
      if (!response.ok) {
        if (code === "REAUTHENTICATION_REQUIRED") {
          setRetryPayload({ payload, key })
          setReauthOpen(true)
        } else {
          setRetryPayload(null)
          setError(errorMessage(body))
        }
        return
      }
      setRetryPayload(null)
      setFormVersion((version) => version + 1)
      setMessage("Empresa e primeiro administrador criados com sucesso.")
      router.refresh()
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return
      setError(GENERIC_ERROR)
    } finally {
      setPending(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const values = new FormData(form)
    const temporaryPassword = values.get("temporaryPassword")
    const passwordConfirmation = values.get("passwordConfirmation")
    if (
      typeof temporaryPassword !== "string" ||
      temporaryPassword !== passwordConfirmation
    ) {
      setMessage(null)
      setError("A confirmação da senha provisória não confere.")
      return
    }
    const payload: CompanyPayload = {
      legalName: values.get("legalName"), tradeName: values.get("tradeName"), cnpj: values.get("cnpj"),
      contactEmail: values.get("contactEmail"), contactPhone: values.get("contactPhone") || null, timezone: values.get("timezone"),
      firstAdmin: { displayName: values.get("adminDisplayName"), email: values.get("adminEmail"), temporaryPassword, modules: values.getAll("modules") },
    }
    const passwordInput = form.elements.namedItem("temporaryPassword")
    const confirmationInput = form.elements.namedItem("passwordConfirmation")
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = ""
    if (confirmationInput instanceof HTMLInputElement) confirmationInput.value = ""
    await provision(payload, crypto.randomUUID())
  }

  return (
    <section className="border-t border-border/80 pt-8" aria-labelledby="create-company-title">
      <div className="mb-7 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-primary">
          <BuildingsIcon size={20} weight="duotone" aria-hidden="true" />
        </span>
        <div>
          <h2 id="create-company-title" className="text-lg font-semibold tracking-tight">
            Nova empresa
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            O primeiro administrador recebe uma senha provisória válida por 24 horas.
          </p>
        </div>
      </div>

      <form className="space-y-8" key={formVersion} onSubmit={submit} onChange={() => setRetryPayload(null)}>
        <fieldset disabled={pending} className="grid gap-5 md:grid-cols-2">
          <legend className="sr-only">Dados da empresa</legend>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="company-legal-name">Razão social</Label>
            <Input id="company-legal-name" name="legalName" required minLength={2} maxLength={180} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-trade-name">Nome fantasia</Label>
            <Input id="company-trade-name" name="tradeName" required minLength={2} maxLength={180} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-cnpj">CNPJ</Label>
            <Input id="company-cnpj" name="cnpj" inputMode="numeric" required maxLength={18} placeholder="00.000.000/0000-00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-contact-email">E-mail institucional</Label>
            <Input id="company-contact-email" name="contactEmail" type="email" required maxLength={254} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-contact-phone">Telefone</Label>
            <Input id="company-contact-phone" name="contactPhone" type="tel" maxLength={32} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="company-timezone">Fuso horário</Label>
            <select id="company-timezone" name="timezone" defaultValue="America/Fortaleza" className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/25">
              <option value="America/Fortaleza">Fortaleza</option>
              <option value="America/Sao_Paulo">São Paulo</option>
              <option value="America/Manaus">Manaus</option>
              <option value="America/Rio_Branco">Rio Branco</option>
              <option value="America/Noronha">Fernando de Noronha</option>
            </select>
          </div>
        </fieldset>

        <fieldset disabled={pending} className="grid gap-5 border-t border-border/70 pt-7 md:grid-cols-2">
          <legend className="mb-5 text-sm font-semibold">Primeiro administrador</legend>
          <div className="space-y-2">
            <Label htmlFor="admin-display-name">Nome</Label>
            <Input id="admin-display-name" name="adminDisplayName" required minLength={2} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-email">E-mail</Label>
            <Input id="admin-email" name="adminEmail" type="email" required maxLength={254} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="admin-temporary-password">Senha provisória</Label>
            <Input id="admin-temporary-password" name="temporaryPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            <p className="text-xs text-muted-foreground">Use ao menos 12 caracteres. A senha não é armazenada no banco nem em logs.</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="admin-password-confirmation">Confirme a senha provisória</Label>
            <Input id="admin-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </div>
          <div className="space-y-3 md:col-span-2">
            <span className="text-sm font-medium">Módulos iniciais</span>
            <div className="flex flex-wrap gap-4">
              {[['administrative', 'Administrativo'], ['financial', 'Financeiro'], ['certificates', 'Certidões']].map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="modules" value={value} className="size-4 accent-primary" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <div aria-live="polite" className="min-h-6 text-sm">
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          {message ? <p className="flex items-center gap-2 text-primary"><ShieldCheckIcon size={17} aria-hidden="true" />{message}</p> : null}
        </div>
        <div className="flex justify-end border-t border-border/70 pt-5">
          <Button type="submit" disabled={pending}>{pending ? "Criando empresa..." : "Criar empresa"}</Button>
        </div>
      </form>
      <ReauthenticationDialog open={reauthOpen} onOpenChange={setReauthOpen} onConfirmed={async () => { if (retryPayload) await provision(retryPayload.payload, retryPayload.key) }} />
    </section>
  )
}
