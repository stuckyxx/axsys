"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageUploadField } from "@/modules/files/ui/image-upload-field"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import type { CompanySettingsAccess } from "@/modules/settings/server/company-settings-access"
import {
  CompanyBankAccountsReadonly,
  type ReadonlyBankAccount,
} from "@/modules/settings/ui/company-bank-accounts-readonly"
import { COMPANY_SETTINGS_INVALIDATED_EVENT } from "@/modules/settings/ui/company-settings-events"

export type CompanySettingsView = Readonly<{
  representativeName: string | null
  representativeRole: string | null
  representativeDocumentLast4: string | null
  taxRate: number
  addressStreet: string | null
  addressNumber: string | null
  addressComplement: string | null
  addressNeighborhood: string | null
  addressCity: string | null
  addressState: string | null
  addressPostalCode: string | null
  consolidatedAddress: string | null
  letterheadFileId: string | null
  signatureFileId: string | null
  version: number
  updatedAt: string
}>

type DraftView = Readonly<{
  payload: Partial<Record<keyof CompanySettingsView | "representativeDocument", unknown>>
  baseVersion: number
  version: number
  updatedAt: string
}>

type FormValues = {
  representativeName: string
  representativeRole: string
  representativeDocument: string
  taxRate: string
  addressStreet: string
  addressNumber: string
  addressComplement: string
  addressNeighborhood: string
  addressCity: string
  addressState: string
  addressPostalCode: string
  letterheadFileId: string | null
  signatureFileId: string | null
}

function values(settings: CompanySettingsView, draft: DraftView | null): FormValues {
  const source = { ...settings, ...(draft?.payload ?? {}) }
  const text = (key: keyof CompanySettingsView): string =>
    typeof source[key] === "string" ? String(source[key]) : ""
  return {
    representativeName: text("representativeName"), representativeRole: text("representativeRole"),
    representativeDocument: "", taxRate: String(source.taxRate ?? 0),
    addressStreet: text("addressStreet"), addressNumber: text("addressNumber"),
    addressComplement: text("addressComplement"), addressNeighborhood: text("addressNeighborhood"),
    addressCity: text("addressCity"), addressState: text("addressState"),
    addressPostalCode: text("addressPostalCode"),
    letterheadFileId: typeof source.letterheadFileId === "string" ? source.letterheadFileId : null,
    signatureFileId: typeof source.signatureFileId === "string" ? source.signatureFileId : null,
  }
}

async function csrf(): Promise<string> {
  const response = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin" })
  const body = await response.json() as { token?: unknown }
  if (!response.ok || typeof body.token !== "string") throw new Error("CSRF")
  return body.token
}

export function CompanySettingsForm({ access, banks, initialDraft, initialSettings }: Readonly<{
  access: CompanySettingsAccess
  banks: readonly ReadonlyBankAccount[]
  initialDraft: DraftView | null
  initialSettings: CompanySettingsView
}>) {
  const [form, setForm] = useState(() => values(initialSettings, initialDraft))
  const [draftVersion, setDraftVersion] = useState(initialDraft?.version ?? null)
  const [settingsVersion, setSettingsVersion] = useState(initialSettings.version)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  const [conflict, setConflict] = useState<CompanySettingsView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const router = useRouter()
  const retry = useRef<"draft" | "save" | null>(null)
  const inFlight = useRef(false)
  const editable = access === "edit"

  const payload = useCallback(() => ({
    ...form,
    taxRate: Number(form.taxRate),
    representativeDocument: null,
    baseVersion: initialDraft?.baseVersion ?? settingsVersion,
  }), [form, initialDraft?.baseVersion, settingsVersion])

  const saveDraft = useCallback(async () => {
    if (!editable || !dirty || inFlight.current) return
    inFlight.current = true; setStatus("saving")
    try {
      const token = await csrf()
      const response = await fetch("/api/company/settings/draft", {
        method: "PUT", cache: "no-store", credentials: "same-origin", keepalive: true,
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ ...payload(), expectedDraftVersion: draftVersion }),
      })
      const body = await response.json() as { version?: number; error?: { code?: string } }
      if (body.error?.code === "REAUTHENTICATION_REQUIRED") {
        retry.current = "draft"; setReauthOpen(true); return
      }
      if (!response.ok || !Number.isSafeInteger(body.version)) throw new Error("DRAFT")
      setDraftVersion(body.version!); setDirty(false); setStatus("saved")
    } catch { setStatus("failed") } finally { inFlight.current = false }
  }, [dirty, draftVersion, editable, payload])

  useEffect(() => {
    if (!dirty || !editable) return
    const timer = window.setTimeout(() => { void saveDraft() }, 750)
    const flush = () => { if (document.visibilityState === "hidden") void saveDraft() }
    document.addEventListener("visibilitychange", flush)
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", flush) }
  }, [dirty, editable, saveDraft])

  const change = (key: keyof FormValues, value: string | null) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key !== "representativeDocument") setDirty(true)
    setStatus("idle")
  }

  const saveOfficial = useCallback(async () => {
    if (!editable || inFlight.current) return
    inFlight.current = true; setMessage(null); setConflict(null)
    try {
      const token = await csrf()
      const response = await fetch("/api/company/settings", {
        method: "PATCH", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({
          ...form,
          taxRate: Number(form.taxRate),
          representativeDocument: form.representativeDocument || null,
          version: settingsVersion,
        }),
      })
      const body = await response.json() as { current?: CompanySettingsView; version?: number; error?: { code?: string; message?: string } }
      if (body.error?.code === "REAUTHENTICATION_REQUIRED") {
        retry.current = "save"; setReauthOpen(true); return
      }
      if (response.status === 409 && body.current) { setConflict(body.current); setMessage("A versão atual mudou. Revise antes de tentar novamente."); return }
      if (!response.ok) throw new Error("SAVE")
      if (typeof body.version === "number") setSettingsVersion(body.version)
      setDraftVersion(null); setDirty(false); setStatus("idle"); setMessage("Configurações atualizadas.")
      setForm((current) => ({ ...current, representativeDocument: "" }))
      window.dispatchEvent(new Event(COMPANY_SETTINGS_INVALIDATED_EVENT))
      router.refresh()
    } catch { setMessage("Não foi possível salvar as configurações.") } finally { inFlight.current = false }
  }, [editable, form, router, settingsVersion])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); void saveOfficial()
  }

  const field = (key: keyof FormValues, label: string, options?: { max?: number; type?: string }) => (
    <div className="space-y-2"><Label htmlFor={`settings-${key}`}>{label}</Label><Input className="min-h-11" disabled={!editable} id={`settings-${key}`} maxLength={options?.max} type={options?.type} value={String(form[key] ?? "")} onChange={(event) => change(key, event.target.value)} /></div>
  )

  return (
    <><form className="space-y-10" onSubmit={submit}>
      <header className="border-b pb-6"><p className="font-mono text-xs uppercase tracking-[.18em] text-primary">Dados institucionais</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Configurações da empresa</h1><p className="mt-2 text-sm text-muted-foreground">{editable ? "Alterações usam versão e rascunho remoto por usuário." : "Consulta autorizada; edição indisponível para este acesso."}</p></header>
      <fieldset disabled={!editable} className="grid gap-5 sm:grid-cols-2"><legend className="mb-4 text-lg font-semibold">Dados fiscais e representante</legend>{field("representativeName", "Representante legal", { max: 160 })}{field("representativeRole", "Cargo", { max: 120 })}{field("taxRate", "Alíquota (%)", { type: "number" })}<div className="space-y-2"><Label htmlFor="settings-representativeDocument">CPF do representante</Label><Input className="min-h-11" disabled={!editable} id="settings-representativeDocument" inputMode="numeric" autoComplete="off" value={form.representativeDocument} onChange={(event) => change("representativeDocument", event.target.value)} placeholder={initialSettings.representativeDocumentLast4 ? `Final ${initialSettings.representativeDocumentLast4}` : "Somente para substituir"} />{initialSettings.representativeDocumentLast4 ? <p className="text-xs text-muted-foreground">Final {initialSettings.representativeDocumentLast4}</p> : null}<p className="text-xs text-muted-foreground">Por segurança, o CPF não entra no rascunho. Use “Salvar configurações” para aplicá-lo.</p></div></fieldset>
      <fieldset disabled={!editable} className="grid gap-5 sm:grid-cols-2"><legend className="mb-4 text-lg font-semibold">Endereço</legend>{field("addressStreet", "Logradouro")}{field("addressNumber", "Número")}{field("addressComplement", "Complemento")}{field("addressNeighborhood", "Bairro")}{field("addressCity", "Cidade")}{field("addressState", "UF", { max: 2 })}{field("addressPostalCode", "CEP", { max: 9 })}{initialSettings.consolidatedAddress ? <p className="sm:col-span-2 text-sm text-muted-foreground">Endereço consolidado: {initialSettings.consolidatedAddress}</p> : null}</fieldset>
      {editable ? <section className="space-y-6"><h2 className="text-lg font-semibold">Identidade documental</h2>{form.letterheadFileId ? <div><p className="mb-2 text-sm font-medium">Timbrado atual</p><Image unoptimized width={640} height={240} alt="Prévia do papel timbrado atual" className="max-h-40 w-auto rounded-xl border object-contain" src={`/api/files/${encodeURIComponent(form.letterheadFileId)}/download`} /></div> : null}<ImageUploadField purpose="company_letterhead" label="Papel timbrado" description="Imagem limpa usada em documentos." onReady={(file) => change("letterheadFileId", file.id)} />{form.signatureFileId ? <div><p className="mb-2 text-sm font-medium">Assinatura atual</p><Image unoptimized width={480} height={160} alt="Prévia da assinatura institucional atual" className="max-h-32 w-auto rounded-xl border object-contain" src={`/api/files/${encodeURIComponent(form.signatureFileId)}/download`} /></div> : null}<ImageUploadField purpose="company_signature" label="Assinatura institucional" description="Assinatura normalizada e protegida." onReady={(file) => change("signatureFileId", file.id)} /></section> : null}
      <CompanyBankAccountsReadonly banks={banks} />
      {conflict ? <section role="alert" className="grid gap-4 rounded-xl border border-destructive/40 p-4 sm:grid-cols-2"><div><h2 className="font-semibold">Sua edição</h2><p className="text-sm text-muted-foreground">Os dados permanecem neste formulário.</p></div><div><h2 className="font-semibold">Versão atual</h2><p className="text-sm text-muted-foreground">Versão {conflict.version}.</p><Button className="mt-3 min-h-11" type="button" variant="outline" onClick={() => { setSettingsVersion(conflict.version); setConflict(null); setMessage("Revise e tente novamente com a versão atual.") }}>Revisar e tentar novamente</Button></div></section> : null}
      {editable ? <footer className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur"><p aria-live="polite" className="text-sm text-muted-foreground">{status === "saving" ? "Salvando rascunho…" : status === "saved" ? "Rascunho salvo" : status === "failed" ? "Falha ao salvar rascunho" : message}</p><Button className="min-h-11" type="submit">Salvar configurações</Button></footer> : null}
    </form><ReauthenticationDialog open={reauthOpen} onOpenChange={(open) => { setReauthOpen(open); if (!open) retry.current = null }} onConfirmed={async () => { const operation = retry.current; retry.current = null; if (operation === "draft") await saveDraft(); else if (operation === "save") await saveOfficial() }} /></>
  )
}
