"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import { createCompanyUserSchema, type CreateCompanyUserInput } from "@/modules/users/schemas/user-schemas"
import { platformMutation } from "@/modules/platform/ui/platform-mutation"

const MODULES = [["administrative", "Administrativo"], ["financial", "Financeiro"], ["certificates", "Certidões"]] as const

export function AdminForm({ companyId, open, onOpenChange }: Readonly<{ companyId: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const router = useRouter()
  const [retryRequest, setRetryRequest] = useState<{ payload: CreateCompanyUserInput; key: string } | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<CreateCompanyUserInput>({
    resolver: zodResolver(createCompanyUserSchema),
    defaultValues: { displayName: "", email: "", temporaryPassword: "", role: "company_admin", modules: [] },
  })

  function clear() { setRetryRequest(null); setMessage(null); reset(); onOpenChange(false) }

  async function create(payload: CreateCompanyUserInput, idempotencyKey = crypto.randomUUID()) {
    const result = await platformMutation({ endpoint: `/api/platform/companies/${companyId}/admins`, method: "POST", payload, idempotencyKey })
    if (!result.ok) {
      if (result.code === "REAUTHENTICATION_REQUIRED") {
        setRetryRequest({ payload, key: idempotencyKey })
        setValue("temporaryPassword", "")
        setReauthOpen(true)
        return
      }
      setMessage(result.message)
      return
    }
    setRetryRequest(null)
    reset()
    onOpenChange(false)
    router.refresh()
  }

  return <>
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && !isSubmitting) clear(); else onOpenChange(next) }}>
      <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.018_252/0.68)] backdrop-blur-xs" /><DialogPrimitive.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100dvh-2rem)] -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-5 shadow-2xl sm:left-1/2 sm:right-auto sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:p-7">
        <DialogPrimitive.Title className="text-xl font-semibold tracking-tight">Novo administrador</DialogPrimitive.Title><DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">Crie um acesso exclusivo para esta empresa.</DialogPrimitive.Description>
        <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit((payload) => create(payload))} onChange={() => setRetryRequest(null)}>
          <input type="hidden" {...register("role")} />
          <div className="space-y-2"><Label htmlFor="admin-name">Nome completo</Label><Input id="admin-name" {...register("displayName")} aria-invalid={!!errors.displayName} /></div>
          <div className="space-y-2"><Label htmlFor="admin-email-new">E-mail</Label><Input id="admin-email-new" type="email" {...register("email")} aria-invalid={!!errors.email} /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="admin-password-new">Senha provisória</Label><Input id="admin-password-new" type="password" autoComplete="new-password" {...register("temporaryPassword")} aria-invalid={!!errors.temporaryPassword} /><p className="text-xs text-muted-foreground">A senha é mantida somente durante esta operação e será apagada do formulário.</p></div>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Módulos</legend><div className="mt-2 flex flex-wrap gap-4">{MODULES.map(([value, label]) => <label className="flex min-h-11 items-center gap-2 text-sm" key={value}><input className="size-4 accent-primary" type="checkbox" value={value} {...register("modules")} />{label}</label>)}</div></fieldset>
          <div aria-live="polite" className="min-h-5 text-sm sm:col-span-2">{message ? <p role="alert" className="text-destructive">{message}</p> : null}</div>
          <footer className="flex justify-end gap-2 border-t border-border/70 pt-4 sm:col-span-2"><Button className="h-11" disabled={isSubmitting} onClick={clear} type="button" variant="ghost">Cancelar</Button><Button className="h-11" disabled={isSubmitting} type="submit">{isSubmitting ? "Criando…" : "Criar administrador"}</Button></footer>
        </form>
      </DialogPrimitive.Content></DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    <ReauthenticationDialog open={reauthOpen} onOpenChange={setReauthOpen} onConfirmed={async () => { if (retryRequest) await create(retryRequest.payload, retryRequest.key) }} />
  </>
}
