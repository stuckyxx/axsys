"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CompanyListSnapshot } from "@/lib/db/bff"
import { updateCompanySchema, type UpdateCompanyInput } from "@/modules/companies/schemas/company-schemas"
import { CompanyCreateForm } from "@/modules/companies/ui/company-create-form"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import { platformMutation } from "@/modules/platform/ui/platform-mutation"

export function CompanyForm({ company }: Readonly<{ company?: CompanyListSnapshot }>) {
  if (!company) return <CompanyCreateForm />
  return <CompanyEditForm company={company} />
}

function CompanyEditForm({ company }: Readonly<{ company: CompanyListSnapshot }>) {
  const router = useRouter()
  const [retryPayload, setRetryPayload] = useState<UpdateCompanyInput | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema) as Resolver<UpdateCompanyInput>,
    defaultValues: {
      legalName: company.legalName,
      tradeName: company.tradeName ?? company.legalName,
      contactEmail: company.contactEmail,
      contactPhone: company.contactPhone,
      timezone: company.timezone,
      version: company.version,
    },
  })

  async function save(payload: UpdateCompanyInput) {
    setMessage(null)
    const result = await platformMutation<CompanyListSnapshot>({ endpoint: `/api/platform/companies/${company.id}`, method: "PATCH", payload })
    if (!result.ok) {
      if (result.code === "REAUTHENTICATION_REQUIRED") { setRetryPayload(payload); setReauthOpen(true); return }
      setMessage(result.code === "VERSION_CONFLICT" ? "Esta empresa foi alterada em outra sessão. Atualizando os dados…" : result.message)
      if (result.code === "VERSION_CONFLICT") router.refresh()
      return
    }
    setRetryPayload(null)
    reset({
      legalName: result.data.legalName,
      tradeName: result.data.tradeName ?? result.data.legalName,
      contactEmail: result.data.contactEmail,
      contactPhone: result.data.contactPhone,
      timezone: result.data.timezone,
      version: result.data.version,
    })
    setMessage("Dados da empresa atualizados.")
    router.refresh()
  }

  return (
    <>
      <form className="grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit(save)}>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-legal-name">Razão social</Label><Input id="edit-legal-name" {...register("legalName")} aria-invalid={!!errors.legalName} /></div>
        <div className="space-y-2"><Label htmlFor="edit-trade-name">Nome fantasia</Label><Input id="edit-trade-name" {...register("tradeName")} aria-invalid={!!errors.tradeName} /></div>
        <div className="space-y-2"><Label htmlFor="edit-email">E-mail institucional</Label><Input id="edit-email" type="email" {...register("contactEmail")} aria-invalid={!!errors.contactEmail} /></div>
        <div className="space-y-2"><Label htmlFor="edit-phone">Telefone</Label><Input id="edit-phone" type="tel" {...register("contactPhone")} /></div>
        <div className="space-y-2"><Label htmlFor="edit-timezone">Fuso horário</Label><Input id="edit-timezone" {...register("timezone")} /></div>
        <input type="hidden" {...register("version", { valueAsNumber: true })} />
        <div aria-live="polite" className="min-h-6 text-sm sm:col-span-2">{message ? <p role={message.includes("alterada") ? "alert" : undefined}>{message}</p> : null}</div>
        <div className="flex justify-end sm:col-span-2"><Button className="h-11" disabled={isSubmitting} type="submit">{isSubmitting ? "Salvando…" : "Salvar alterações"}</Button></div>
      </form>
      <ReauthenticationDialog open={reauthOpen} onOpenChange={setReauthOpen} onConfirmed={async () => { if (retryPayload) await save(retryPayload) }} />
    </>
  )
}
