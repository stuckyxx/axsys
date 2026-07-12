"use client"

import { useRef, useState } from "react"
import { ArchiveIcon, BankIcon, PencilSimpleIcon, PlusIcon, UserPlusIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import type { CompanyDetailSnapshot } from "@/lib/db/bff"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import { AdminForm } from "@/modules/platform/ui/admin-form"
import { BankAccountDialog } from "@/modules/platform/ui/bank-account-dialog"
import { CompanyForm } from "@/modules/platform/ui/company-form"
import { platformMutation } from "@/modules/platform/ui/platform-mutation"

export function CompanyDetail({ detail }: Readonly<{ detail: CompanyDetailSnapshot }>) {
  const router = useRouter()
  const [edit, setEdit] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [archiveCompanyOpen, setArchiveCompanyOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState("")
  const [archiveBankId, setArchiveBankId] = useState<string | null>(null)
  const [replacementId, setReplacementId] = useState("")
  const [reauthOpen, setReauthOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const retry = useRef<null | (() => Promise<void>)>(null)
  const { company } = detail
  const archiveBank = detail.bankAccounts.find((bank) => bank.id === archiveBankId) ?? null
  const replacementCandidates = detail.bankAccounts.filter((bank) => bank.status === "active" && bank.id !== archiveBankId)

  async function mutate(endpoint: string, payload: unknown) {
    setMessage(null)
    const operation = async () => {
      const result = await platformMutation({ endpoint, method: "POST", payload })
      if (!result.ok) {
        if (result.code === "REAUTHENTICATION_REQUIRED") { retry.current = operation; setReauthOpen(true); return }
        setMessage(result.code === "VERSION_CONFLICT" ? "Os dados foram alterados em outra sessão. Atualizando…" : result.message)
        if (result.code === "VERSION_CONFLICT") router.refresh()
        return
      }
      retry.current = null
      router.refresh()
    }
    await operation()
  }

  async function changeStatus(reason: string | null) {
    const archive = company.status === "active"
    if (archive && (!reason || reason.trim().length < 10)) return
    setMessage(null)
    const operation = async () => {
      const result = await platformMutation({ endpoint: `/api/platform/companies/${company.id}/status`, method: "PATCH", payload: { action: archive ? "archive" : "reactivate", version: company.version, reason } })
      if (!result.ok) {
        if (result.code === "REAUTHENTICATION_REQUIRED") { retry.current = operation; setReauthOpen(true); return }
        setMessage(result.code === "VERSION_CONFLICT" ? "A situação mudou em outra sessão. Atualizando…" : result.message)
        if (result.code === "VERSION_CONFLICT") router.refresh()
        return
      }
      retry.current = null; router.refresh()
    }
    await operation()
  }

  return <div className="space-y-9">
    <header className="grid gap-6 border-b border-border/70 pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Empresa</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{company.tradeName ?? company.legalName}</h1><p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{company.legalName} · <span className="font-mono">{company.cnpj}</span></p></div>
      <div className="flex flex-wrap gap-2"><Button className="h-11" onClick={() => setEdit((value) => !value)} variant="outline"><PencilSimpleIcon aria-hidden />Editar</Button><Button className="h-11" onClick={() => { if (company.status === "active") setArchiveCompanyOpen(true); else void changeStatus(null) }} variant={company.status === "active" ? "destructive" : "secondary"}><ArchiveIcon aria-hidden />{company.status === "active" ? "Arquivar" : "Reativar"}</Button></div>
    </header>

    {edit ? <section className="rounded-2xl border bg-card p-5 sm:p-7" aria-label="Editar empresa"><CompanyForm company={company} /></section> : null}
    <div aria-live="polite" className="min-h-5 text-sm">{message ? <p role="alert">{message}</p> : null}</div>

    <section aria-labelledby="admins-title">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-semibold" id="admins-title">Administradores</h2><p className="mt-1 text-sm text-muted-foreground">Acessos que administram esta empresa.</p></div><Button className="h-11" onClick={() => setAdminOpen(true)}><UserPlusIcon aria-hidden />Adicionar</Button></div>
      {detail.admins.length === 0 ? <Empty text="Nenhum administrador disponível." /> : <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border bg-card">{detail.admins.map((admin) => <div className="grid gap-2 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={admin.membershipId}><div><p className="font-medium">{admin.displayName}</p><p className="mt-1 text-sm text-muted-foreground">{admin.email}</p></div><span className="w-fit rounded-full border px-2.5 py-1 text-xs">{admin.accessState === "active" ? "Ativo" : admin.accessState === "password_change_required" ? "Troca de senha" : "Suspenso"}</span></div>)}</div>}
    </section>

    <section aria-labelledby="banks-title">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-semibold" id="banks-title">Contas bancárias</h2><p className="mt-1 text-sm text-muted-foreground">Somente dados mascarados são exibidos.</p></div><Button className="h-11" onClick={() => setBankOpen(true)} variant="secondary"><PlusIcon aria-hidden />Nova conta</Button></div>
      {detail.bankAccounts.length === 0 ? <Empty text="Nenhuma conta bancária cadastrada." /> : <div className="grid gap-3 lg:grid-cols-2">{detail.bankAccounts.map((bank) => {
        const canReplaceDefault = detail.bankAccounts.some((candidate) => candidate.status === "active" && candidate.id !== bank.id)
        return <article className="rounded-2xl border bg-card p-5" key={bank.id}><div className="flex items-start justify-between gap-3"><BankIcon aria-hidden className="size-6 text-primary" weight="duotone" /><div className="flex gap-2">{!bank.isDefault && bank.status === "active" ? <Button size="sm" variant="ghost" onClick={() => mutate(`/api/platform/companies/${company.id}/bank-accounts/${bank.id}/default`, { version: bank.version })}>Tornar padrão</Button> : null}{bank.status === "active" ? <Button aria-label={bank.isDefault ? "Arquivar conta padrão" : `Arquivar conta ${bank.bankName}`} disabled={bank.isDefault && !canReplaceDefault} size="sm" title={bank.isDefault && !canReplaceDefault ? "Cadastre outra conta ativa antes de arquivar a conta padrão." : undefined} variant="destructive" onClick={() => { if (bank.isDefault) { setReplacementId(""); setArchiveBankId(bank.id) } else void mutate(`/api/platform/companies/${company.id}/bank-accounts/${bank.id}/archive`, { version: bank.version, replacementDefaultId: null, reasonCode: "BANK_ARCHIVE_ACCOUNT_CLOSED" }) }}>Arquivar</Button> : null}</div></div><p className="mt-5 font-medium">{bank.bankName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">Ag. ••••{bank.branchLast4} · Conta ••••{bank.accountLast4}</p><p className="mt-3 text-xs text-muted-foreground">{bank.isDefault ? "Conta padrão" : bank.status === "archived" ? "Arquivada" : "Ativa"}</p></article>
      })}</div>}
    </section>

    <AdminForm companyId={company.id} open={adminOpen} onOpenChange={setAdminOpen} />
    <BankAccountDialog companyId={company.id} open={bankOpen} onOpenChange={setBankOpen} />
    <DialogPrimitive.Root open={archiveCompanyOpen} onOpenChange={(open) => { setArchiveCompanyOpen(open); if (!open) setArchiveReason("") }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.018_252/0.68)] backdrop-blur-xs" /><DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-popover p-6 shadow-2xl"><DialogPrimitive.Title className="text-lg font-semibold">Arquivar empresa</DialogPrimitive.Title><DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground">O acesso empresarial será interrompido. Registre um motivo claro para a auditoria.</DialogPrimitive.Description><div className="mt-5 space-y-2"><label className="text-sm font-medium" htmlFor="company-archive-reason">Motivo do arquivamento</label><textarea className="min-h-28 w-full resize-y rounded-xl border bg-background p-3 text-sm" id="company-archive-reason" maxLength={500} minLength={10} required value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></div><div className="mt-6 flex justify-end gap-2"><Button className="h-11" onClick={() => setArchiveCompanyOpen(false)} variant="ghost">Cancelar</Button><Button className="h-11" disabled={archiveReason.trim().length < 10} onClick={async () => { await changeStatus(archiveReason.trim()); setArchiveCompanyOpen(false); setArchiveReason("") }} variant="destructive">Confirmar arquivamento</Button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
    <DialogPrimitive.Root open={archiveBank !== null} onOpenChange={(open) => { if (!open) { setArchiveBankId(null); setReplacementId("") } }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.018_252/0.68)] backdrop-blur-xs" /><DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-popover p-6 shadow-2xl"><DialogPrimitive.Title className="text-lg font-semibold">Arquivar conta padrão</DialogPrimitive.Title><DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground">Selecione explicitamente qual conta ativa passará a ser a padrão.</DialogPrimitive.Description><div className="mt-5 space-y-2"><label className="text-sm font-medium" htmlFor="replacement-default">Nova conta padrão</label><select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="replacement-default" required value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">Selecione uma conta</option>{replacementCandidates.map((bank) => <option key={bank.id} value={bank.id}>{bank.bankName} · ••••{bank.accountLast4}</option>)}</select></div><div className="mt-6 flex justify-end gap-2"><Button className="h-11" onClick={() => { setArchiveBankId(null); setReplacementId("") }} variant="ghost">Cancelar</Button><Button className="h-11" disabled={!replacementId || !archiveBank} onClick={async () => { if (!archiveBank || !replacementId) return; await mutate(`/api/platform/companies/${company.id}/bank-accounts/${archiveBank.id}/archive`, { version: archiveBank.version, replacementDefaultId: replacementId, reasonCode: "BANK_ARCHIVE_ACCOUNT_CLOSED" }); setArchiveBankId(null); setReplacementId("") }} variant="destructive">Confirmar arquivamento</Button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
    <ReauthenticationDialog open={reauthOpen} onOpenChange={(open) => { setReauthOpen(open); if (!open) retry.current = null }} onConfirmed={async () => { if (retry.current) await retry.current() }} />
  </div>
}

function Empty({ text }: { text: string }) { return <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">{text}</div> }
