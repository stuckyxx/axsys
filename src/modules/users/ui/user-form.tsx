"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ShieldCheckIcon, UserPlusIcon, XIcon } from "@phosphor-icons/react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"

const MODULES = [
  ["administrative", "Administrativo"],
  ["financial", "Financeiro"],
  ["certificates", "Certidões"],
] as const

function safeError(body: unknown): { code: string | null; text: string } {
  if (typeof body !== "object" || body === null || !("error" in body)) return { code: null, text: "Não foi possível criar o acesso." }
  const error = body.error
  if (typeof error !== "object" || error === null) return { code: null, text: "Não foi possível criar o acesso." }
  return { code: "code" in error && typeof error.code === "string" ? error.code : null, text: "message" in error && typeof error.message === "string" && error.message.length <= 240 ? error.message : "Não foi possível criar o acesso." }
}

async function csrf(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store", credentials: "same-origin", redirect: "error", signal,
  })
  const body = await response.json() as { token?: unknown }
  if (!response.ok || typeof body.token !== "string" || body.token.length === 0) throw new Error("CSRF")
  return body.token
}

export function UserForm({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const request = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const retry = useRef<Record<string, unknown> | null>(null)
  const inFlight = useRef(false)
  const idempotencyKey = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)

  useEffect(() => () => request.current?.abort(), [])
  if (!open) return null

  function close() { if (pending || inFlight.current) return; retry.current = null; idempotencyKey.current = null; setError(null); onClose() }

  async function perform(payload: Record<string, unknown>) {
    if (inFlight.current) return
    inFlight.current = true
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    idempotencyKey.current ??= crypto.randomUUID()
    setPending(true)
    setError(null)
    try {
      const token = await csrf(controller.signal)
      const response = await fetch("/api/company/users", {
        method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json", "x-csrf-token": token,
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify({
          ...payload,
        }),
      })
      const body = await response.json() as unknown
      if (!response.ok) {
        const parsed = safeError(body)
        if (parsed.code === "REAUTHENTICATION_REQUIRED") { retry.current = payload; setReauthOpen(true); return }
        setError(parsed.text); return
      }
      retry.current = null
      idempotencyKey.current = null
      formRef.current?.reset()
      onCreated()
      onClose()
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("Não foi possível criar o acesso.")
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const values = new FormData(event.currentTarget)
    const password = values.get("temporaryPassword")
    if (typeof password !== "string" || password !== values.get("passwordConfirmation")) { setError("A confirmação da senha provisória não confere."); return }
    void perform({ displayName: values.get("displayName"), email: values.get("email"), temporaryPassword: password, role: values.get("role"), modules: values.getAll("modules") })
  }

  return (
    <><DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" /><DialogPrimitive.Content onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} className="fixed bottom-0 left-1/2 z-40 max-h-[96dvh] w-full -translate-x-1/2 overflow-y-auto border border-border bg-card shadow-2xl shadow-background/60 outline-none sm:bottom-auto sm:top-1/2 sm:max-w-2xl sm:-translate-y-1/2 sm:rounded-2xl">
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-7">
          <div className="flex gap-3"><UserPlusIcon className="mt-0.5 text-primary" size={22} weight="duotone" aria-hidden="true" /><div><DialogPrimitive.Title className="font-semibold">Novo acesso</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">Crie uma identidade com senha provisória válida por 24 horas.</DialogPrimitive.Description></div></div>
          <Button type="button" variant="ghost" size="icon" onClick={close} disabled={pending} aria-label="Fechar"><XIcon /></Button>
        </header>
        <form ref={formRef} onSubmit={submit} onChange={() => { idempotencyKey.current = null }} className="p-5 sm:p-7">
          <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-5 font-mono text-xs uppercase tracking-[.16em] text-primary">Identidade</legend>
            <div className="space-y-2"><Label htmlFor="new-user-name">Nome completo</Label><Input id="new-user-name" name="displayName" required minLength={2} maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="new-user-email">E-mail</Label><Input id="new-user-email" name="email" type="email" autoComplete="off" required maxLength={254} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="new-user-role">Papel</Label><select id="new-user-role" name="role" defaultValue="member" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="member">Membro</option><option value="company_admin">Administrador</option></select><p className="text-xs text-muted-foreground">Administradores gerenciam usuários e configurações mesmo sem módulos operacionais.</p></div>
          </fieldset>
          <fieldset disabled={pending} className="mt-7 border-t border-border pt-6"><legend className="mb-4 font-mono text-xs uppercase tracking-[.16em] text-primary">Módulos</legend><div className="grid gap-2 sm:grid-cols-3">{MODULES.map(([value,label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><input type="checkbox" name="modules" value={value} className="size-4 accent-primary" />{label}</label>)}</div></fieldset>
          <fieldset disabled={pending} className="mt-7 grid gap-5 border-t border-border pt-6 sm:grid-cols-2"><legend className="mb-4 font-mono text-xs uppercase tracking-[.16em] text-primary">Senha provisória</legend><div className="space-y-2"><Label htmlFor="new-user-password">Senha</Label><Input id="new-user-password" name="temporaryPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></div><div className="space-y-2"><Label htmlFor="new-user-password-confirmation">Confirmação</Label><Input id="new-user-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></div><p className="text-xs leading-5 text-muted-foreground sm:col-span-2"><ShieldCheckIcon className="mr-1 inline" />A senha é transmitida somente nesta operação e não é persistida neste dispositivo.</p></fieldset>
          <div aria-live="polite" className="mt-4 min-h-5 text-sm">{error ? <p role="alert" className="text-destructive">{error}</p> : null}</div>
          <footer className="sticky bottom-0 -mx-5 mt-4 flex justify-end gap-2 border-t border-border bg-card px-5 py-4 sm:-mx-7 sm:px-7"><Button type="button" variant="ghost" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? "Criando..." : "Criar acesso"}</Button></footer>
        </form>
      </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root><ReauthenticationDialog open={reauthOpen} onOpenChange={(nextOpen) => { setReauthOpen(nextOpen); if (!nextOpen) retry.current = null }} onConfirmed={async () => { const payload = retry.current; if (payload) await perform(payload) }} /></>
  )
}
