"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { KeyIcon, XIcon } from "@phosphor-icons/react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"

async function token(signal: AbortSignal) {
  const response = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", redirect: "error", signal })
  const body = await response.json() as { token?: unknown }
  if (!response.ok || typeof body.token !== "string") throw new Error("CSRF")
  return body.token
}

export function ResetPasswordDialog({ membershipId, displayName, onClose }: { membershipId: string; displayName: string; onClose: () => void }) {
  const request = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const retry = useRef<{ temporaryPassword: FormDataEntryValue | null; reasonCode: FormDataEntryValue | null } | null>(null)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [reauthOpen, setReauthOpen] = useState(false)
  useEffect(() => () => request.current?.abort(), [])

  function close() { if (!pending && !inFlight.current) { retry.current = null; onClose() } }
  async function perform(payload: { temporaryPassword: FormDataEntryValue | null; reasonCode: FormDataEntryValue | null }) {
    if (inFlight.current) return
    inFlight.current = true
    const controller = new AbortController(); request.current = controller; setPending(true); setError(null)
    try {
      const csrf = await token(controller.signal)
      const response = await fetch(`/api/company/users/${membershipId}/reset-password`, { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(payload) })
      const body = await response.json() as { error?: { code?: string; message?: string } }
      if (!response.ok) { if (body.error?.code === "REAUTHENTICATION_REQUIRED") { retry.current = payload; setReauthOpen(true); return } setError(typeof body.error?.message === "string" ? body.error.message : "Não foi possível redefinir a senha."); return }
      retry.current = null; formRef.current?.reset(); setDone(true)
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("Não foi possível redefinir a senha.") } finally { inFlight.current = false; if (!controller.signal.aborted) setPending(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const password = values.get("temporaryPassword"); if (password !== values.get("passwordConfirmation")) { setError("A confirmação da senha não confere."); return } void perform({ temporaryPassword: password, reasonCode: values.get("reasonCode") }) }

  return <><DialogPrimitive.Root open onOpenChange={(open) => { if (!open) close() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" /><DialogPrimitive.Content onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} className="fixed inset-0 z-40 flex h-dvh max-h-dvh w-full flex-col overflow-hidden border border-border bg-card p-5 shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7"><header className="flex shrink-0 justify-between gap-4"><div className="flex gap-3"><KeyIcon size={22} className="text-primary" weight="duotone" /><div><DialogPrimitive.Title className="font-semibold">Redefinir senha</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{displayName}</DialogPrimitive.Description></div></div><Button className="size-11" variant="ghost" size="icon" onClick={close} disabled={pending} aria-label="Fechar"><XIcon /></Button></header>{done ? <div className="min-h-0 flex-1 overflow-y-auto pt-6"><p role="status" className="border-l-2 border-primary pl-4 text-sm">Senha provisória atualizada. O usuário deverá trocá-la no próximo acesso.</p><Button className="mt-6 min-h-11 w-full" onClick={close}>Concluir</Button></div> : <form ref={formRef} onSubmit={submit} className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto"><fieldset disabled={pending} className="space-y-5"><div className="space-y-2"><Label htmlFor="reset-password">Nova senha provisória</Label><Input className="min-h-11" id="reset-password" name="temporaryPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div><div className="space-y-2"><Label htmlFor="reset-confirmation">Confirme a senha</Label><Input className="min-h-11" id="reset-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div><div className="space-y-2"><Label htmlFor="reset-reason">Motivo administrativo</Label><select id="reset-reason" name="reasonCode" required defaultValue="ADMIN_RESET_USER_REQUEST" className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="ADMIN_RESET_USER_REQUEST">Solicitação do usuário</option><option value="ADMIN_RESET_ACCESS_RECOVERY">Recuperação de acesso</option><option value="ADMIN_RESET_SECURITY_INCIDENT">Incidente de segurança</option><option value="ADMIN_RESET_ADMINISTRATIVE_CORRECTION">Correção administrativa</option></select></div></fieldset><div aria-live="polite" className="min-h-5 text-sm">{error ? <p role="alert" className="text-destructive">{error}</p> : null}</div><div className="sticky bottom-0 mt-auto flex shrink-0 justify-end gap-2 border-t border-border bg-card py-4"><Button className="min-h-11" type="button" variant="ghost" onClick={close} disabled={pending}>Cancelar</Button><Button className="min-h-11" type="submit" disabled={pending}>{pending ? "Redefinindo..." : "Redefinir senha"}</Button></div></form>}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root><ReauthenticationDialog open={reauthOpen} onOpenChange={(open) => { setReauthOpen(open); if (!open) retry.current = null }} onConfirmed={async () => { const payload = retry.current; if (payload) await perform(payload) }} /></>
}
