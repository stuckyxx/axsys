"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import { createBankAccountSchema, type CreateBankAccountInput } from "@/modules/bank-accounts/schemas/bank-account-schemas"
import { platformMutation } from "@/modules/platform/ui/platform-mutation"

const EMPTY: CreateBankAccountInput = { bankCode: "", bankName: "", branch: "", account: "", accountType: "checking", holderName: "", holderDocument: null, makeDefault: false }

export function BankAccountDialog({ companyId, open, onOpenChange }: Readonly<{ companyId: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const router = useRouter()
  const [retryPayload, setRetryPayload] = useState<CreateBankAccountInput | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<CreateBankAccountInput>({ resolver: zodResolver(createBankAccountSchema) as Resolver<CreateBankAccountInput>, defaultValues: EMPTY })

  function clear() { setRetryPayload(null); setMessage(null); reset(EMPTY); onOpenChange(false) }
  async function create(payload: CreateBankAccountInput) {
    const result = await platformMutation({ endpoint: `/api/platform/companies/${companyId}/bank-accounts`, method: "POST", payload })
    if (!result.ok) {
      setValue("branch", ""); setValue("account", ""); setValue("holderDocument", null)
      if (result.code === "REAUTHENTICATION_REQUIRED") { setRetryPayload(payload); setReauthOpen(true); return }
      setRetryPayload(null); setMessage(result.message); return
    }
    setRetryPayload(null); reset(EMPTY); onOpenChange(false); router.refresh()
  }

  return <>
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && !isSubmitting) clear(); else onOpenChange(next) }}>
      <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.018_252/0.68)] backdrop-blur-xs" /><DialogPrimitive.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100dvh-2rem)] -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-5 shadow-2xl sm:left-1/2 sm:right-auto sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:p-7">
        <DialogPrimitive.Title className="text-xl font-semibold tracking-tight">Nova conta bancária</DialogPrimitive.Title><DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">Os dados integrais são enviados uma única vez e armazenados cifrados.</DialogPrimitive.Description>
        <form autoComplete="off" className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit((payload) => create(payload))}>
          <div className="space-y-2"><Label htmlFor="bank-code">Código do banco</Label><Input autoComplete="off" id="bank-code" inputMode="numeric" {...register("bankCode")} aria-invalid={!!errors.bankCode} /></div>
          <div className="space-y-2"><Label htmlFor="bank-name">Banco</Label><Input autoComplete="off" id="bank-name" {...register("bankName")} /></div>
          <div className="space-y-2"><Label htmlFor="bank-branch">Agência</Label><Input autoComplete="off" id="bank-branch" inputMode="numeric" {...register("branch")} /></div>
          <div className="space-y-2"><Label htmlFor="bank-account">Conta</Label><Input autoComplete="off" id="bank-account" inputMode="numeric" {...register("account")} /></div>
          <div className="space-y-2"><Label htmlFor="bank-type">Tipo</Label><select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="bank-type" {...register("accountType")}><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="payment">Pagamento</option></select></div>
          <div className="space-y-2"><Label htmlFor="bank-holder">Titular</Label><Input autoComplete="off" id="bank-holder" {...register("holderName")} /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="bank-document">CPF ou CNPJ do titular</Label><Input autoComplete="off" id="bank-document" inputMode="numeric" {...register("holderDocument")} /></div>
          <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2"><input className="size-4 accent-primary" type="checkbox" {...register("makeDefault")} />Definir como conta padrão</label>
          <div aria-live="polite" className="min-h-5 text-sm sm:col-span-2">{message ? <p role="alert" className="text-destructive">{message}</p> : null}</div>
          <footer className="flex justify-end gap-2 border-t border-border/70 pt-4 sm:col-span-2"><Button className="h-11" disabled={isSubmitting} onClick={clear} type="button" variant="ghost">Cancelar</Button><Button className="h-11" disabled={isSubmitting} type="submit">{isSubmitting ? "Salvando…" : "Salvar conta"}</Button></footer>
        </form>
      </DialogPrimitive.Content></DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    <ReauthenticationDialog open={reauthOpen} onOpenChange={setReauthOpen} onConfirmed={async () => { if (retryPayload) await create(retryPayload) }} />
  </>
}
