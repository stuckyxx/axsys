"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  EnvelopeSimpleIcon, KeyIcon, MagnifyingGlassIcon, PencilSimpleIcon,
  ShieldCheckIcon, UserIcon, UserPlusIcon, XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReauthenticationDialog } from "@/modules/auth/ui/reauthentication-dialog"
import { ResetPasswordDialog } from "@/modules/users/ui/reset-password-dialog"
import { UserForm } from "@/modules/users/ui/user-form"
import { Dialog as DialogPrimitive } from "radix-ui"

export type CompanyUserSummary = Readonly<{
  membershipId: string
  userId: string
  displayName: string
  email: string
  role: "company_admin" | "member"
  status: "active" | "suspended"
  modules: readonly ("administrative" | "financial" | "certificates")[]
  version: number
  createdAt: string
}>

const ROLE_LABEL = { company_admin: "Administrador", member: "Membro" } as const
const MODULES = [["administrative", "Administrativo"], ["financial", "Financeiro"], ["certificates", "Certidões"]] as const

function message(body: unknown, fallback: string): { code: string | null; text: string } {
  if (typeof body !== "object" || body === null || !("error" in body) || typeof body.error !== "object" || body.error === null) return { code: null, text: fallback }
  const error = body.error as { code?: unknown; message?: unknown }
  return { code: typeof error.code === "string" ? error.code : null, text: typeof error.message === "string" && error.message.length <= 240 ? error.message : fallback }
}

async function csrf(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", redirect: "error", signal })
  const body = await response.json() as { token?: unknown }
  if (!response.ok || typeof body.token !== "string" || body.token.length === 0) throw new Error("CSRF")
  return body.token
}

export function CompanyUsersPage({ initialUsers, initialNextCursor, currentMembershipId, initialQuery, initialCursor, initialPreviousCursor }: {
  initialUsers: readonly CompanyUserSummary[]
  initialNextCursor: string | null
  currentMembershipId: string
  initialQuery: string
  initialCursor: string | null
  initialPreviousCursor: string | null
}) {
  const request = useRef<AbortController | null>(null)
  const [users, setUsers] = useState<readonly CompanyUserSummary[]>(initialUsers)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>(initialCursor === null ? [] : [initialPreviousCursor])
  const [currentCursor, setCurrentCursor] = useState<string | null>(initialCursor)
  const [query, setQuery] = useState(initialQuery)
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyUserSummary | null>(null)
  const [resetting, setResetting] = useState<CompanyUserSummary | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function load(search: string, cursor: string | null, preserveError = false) {
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    setPending(true); if (!preserveError) setError(null)
    const params = new URLSearchParams({ limit: "20" })
    if (search) params.set("search", search)
    if (cursor) params.set("cursor", cursor)
    try {
      const response = await fetch("/api/company/users?" + params.toString(), { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal })
      const body = await response.json() as { items?: CompanyUserSummary[]; nextCursor?: string | null; error?: unknown }
      if (!response.ok || !Array.isArray(body.items)) { setError(message(body, "Não foi possível carregar os usuários.").text); return }
      setUsers(body.items); setNextCursor(typeof body.nextCursor === "string" ? body.nextCursor : null); setCurrentCursor(cursor)
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("Não foi possível carregar os usuários.") } finally { if (!controller.signal.aborted) setPending(false) }
  }

  function search(event: FormEvent) { event.preventDefault(); const bounded = query.trim().slice(0, 100); setActiveQuery(bounded); setCursorHistory([]); void load(bounded, null) }
  function next() { if (!nextCursor) return; setCursorHistory((history) => [...history, currentCursor]); void load(activeQuery, nextCursor) }
  function previous() { const previousCursor = cursorHistory.at(-1) ?? null; setCursorHistory((history) => history.slice(0, -1)); void load(activeQuery, previousCursor) }
  function refresh() { setCursorHistory([]); setCurrentCursor(null); void load(activeQuery, null) }

  return <div className="mx-auto w-full max-w-[1400px] space-y-7">
    <header className="grid gap-5 border-b border-border/80 pb-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><div className="space-y-3"><p className="font-mono text-xs font-medium uppercase tracking-[.18em] text-primary">Controle de acesso</p><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Usuários da empresa</h1><p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">Crie acessos, distribua módulos e suspenda identidades com rastreabilidade administrativa.</p></div></div><Button size="lg" onClick={() => setCreateOpen(true)}><UserPlusIcon />Novo acesso</Button></header>

    <form onSubmit={search} className="grid gap-3 sm:grid-cols-[minmax(0,28rem)_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="company-user-search">Buscar no diretório</Label><div className="relative"><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="company-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Nome ou e-mail" className="h-11 pl-10" /></div></div><Button type="submit" variant="secondary" size="lg" disabled={pending}>Buscar</Button></form>
    <div aria-live="polite" className="min-h-5 text-sm">{error ? <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">{error}</p> : null}{pending ? <p className="text-muted-foreground">Atualizando diretório...</p> : null}</div>

    {users.length === 0 && !pending ? <section className="border-y border-border py-12 text-center"><h2 className="font-medium">{activeQuery ? "Nenhum resultado para esta busca" : "Nenhum acesso cadastrado"}</h2><p className="mt-2 text-sm text-muted-foreground">{activeQuery ? "Revise o nome ou e-mail informado." : "Crie o primeiro acesso para começar."}</p></section> : <>
      <section aria-label="Usuários em cartões" className="divide-y divide-border border-y md:hidden">{users.map((user) => <UserCard key={user.membershipId} user={user} self={user.membershipId === currentMembershipId} onEdit={() => setEditing(user)} onReset={() => setResetting(user)} />)}</section>
      <section aria-label="Tabela de usuários" className="hidden md:block overflow-hidden rounded-xl border border-border"><table className="w-full table-fixed text-left text-sm"><thead className="bg-muted/55 text-xs uppercase tracking-[.1em] text-muted-foreground"><tr><th className="w-[34%] px-5 py-3 font-medium">Identidade</th><th className="w-[18%] px-4 py-3 font-medium">Acesso</th><th className="px-4 py-3 font-medium">Módulos</th><th className="w-36 px-5 py-3 text-right font-medium">Ações</th></tr></thead><tbody className="divide-y divide-border">{users.map((user) => <UserRow key={user.membershipId} user={user} self={user.membershipId === currentMembershipId} onEdit={() => setEditing(user)} onReset={() => setResetting(user)} />)}</tbody></table></section>
    </>}
    <nav aria-label="Paginação do diretório" className="flex justify-between gap-3"><Button variant="ghost" onClick={previous} disabled={pending || cursorHistory.length === 0}>Página anterior</Button><Button variant="outline" onClick={next} disabled={pending || nextCursor === null}>Próxima página</Button></nav>
    <UserForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />
    {editing ? <EditDialog user={editing} self={editing.membershipId === currentMembershipId} onClose={() => setEditing(null)} onSaved={(updated) => { setUsers((items) => items.map((item) => item.membershipId === updated.membershipId ? updated : item)); setEditing(null) }} onConflict={() => { setEditing(null); setError("Este acesso foi alterado em outra sessão. O diretório foi atualizado."); setCursorHistory([]); setCurrentCursor(null); void load(activeQuery, null, true) }} /> : null}
    {resetting ? <ResetPasswordDialog membershipId={resetting.membershipId} displayName={resetting.displayName} onClose={() => setResetting(null)} /> : null}
  </div>
}

function Modules({ modules }: { modules: CompanyUserSummary["modules"] }) { return <div className="flex flex-wrap gap-1.5">{modules.length ? modules.map((item) => <span key={item} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{MODULES.find(([key]) => key === item)?.[1]}</span>) : <span className="text-xs text-muted-foreground">Sem módulos operacionais</span>}</div> }
function Identity({ user }: { user: CompanyUserSummary }) { return <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground"><UserIcon size={18} weight="duotone" /></span><div className="min-w-0"><p className="truncate font-medium">{user.displayName}</p><p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><EnvelopeSimpleIcon /><span className="truncate">{user.email}</span></p></div></div> }
function Actions({ self, onEdit, onReset }: { self: boolean; onEdit: () => void; onReset: () => void }) { return <div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={onEdit} disabled={self} aria-label={self ? "Você não pode alterar o próprio acesso" : "Editar acesso"}><PencilSimpleIcon /></Button><Button variant="ghost" size="icon" onClick={onReset} disabled={self} aria-label={self ? "Você não pode redefinir a própria senha" : "Redefinir senha"}><KeyIcon /></Button></div> }
function UserCard({ user, self, onEdit, onReset }: { user: CompanyUserSummary; self: boolean; onEdit: () => void; onReset: () => void }) { return <article className="space-y-4 py-5"><div className="flex items-start justify-between gap-3"><Identity user={user} /><Actions self={self} onEdit={onEdit} onReset={onReset} /></div><div className="flex items-center gap-2 text-xs"><span className="rounded-full border px-2.5 py-1 font-medium">{ROLE_LABEL[user.role]}</span><span className={user.status === "active" ? "text-primary" : "text-destructive"}>{user.status === "active" ? "Acesso ativo" : "Acesso suspenso"}</span>{self ? <span className="text-muted-foreground">Você</span> : null}</div><Modules modules={user.modules} /></article> }
function UserRow({ user, self, onEdit, onReset }: { user: CompanyUserSummary; self: boolean; onEdit: () => void; onReset: () => void }) { return <tr className="transition-colors hover:bg-muted/25"><td className="px-5 py-4"><Identity user={user} /></td><td className="px-4 py-4"><p className="font-medium">{ROLE_LABEL[user.role]}{self ? " · Você" : ""}</p><p className={user.status === "active" ? "mt-1 text-xs text-primary" : "mt-1 text-xs text-destructive"}>{user.status === "active" ? "Ativo" : "Suspenso"}</p></td><td className="px-4 py-4"><Modules modules={user.modules} /></td><td className="px-5 py-4"><Actions self={self} onEdit={onEdit} onReset={onReset} /></td></tr> }

type EditPayload = { displayName: FormDataEntryValue | null; role: FormDataEntryValue | null; modules: FormDataEntryValue[]; status: "active" | "suspended"; suspensionReason: FormDataEntryValue | null; version: number }
function EditDialog({ user, self, onClose, onSaved, onConflict }: { user: CompanyUserSummary; self: boolean; onClose: () => void; onSaved: (user: CompanyUserSummary) => void; onConflict: () => void }) {
  const [status, setStatus] = useState(user.status); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [reauthOpen, setReauthOpen] = useState(false); const retry = useRef<EditPayload | null>(null); const inFlight = useRef(false)
  function close() { if (!pending && !inFlight.current) { retry.current = null; onClose() } }
  async function perform(payload: EditPayload) { if (inFlight.current) return; inFlight.current = true; const controller = new AbortController(); setPending(true); setError(null); try { const token = await csrf(controller.signal); const response = await fetch(`/api/company/users/${user.membershipId}`, { method: "PATCH", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "x-csrf-token": token }, body: JSON.stringify(payload) }); const body = await response.json() as unknown; if (!response.ok) { const parsed = message(body, "Não foi possível salvar o acesso."); if (parsed.code === "REAUTHENTICATION_REQUIRED") { retry.current = payload; setReauthOpen(true); return } if (parsed.code === "VERSION_CONFLICT") { retry.current = null; onConflict(); return } setError(parsed.text); return } retry.current = null; const updated = body as Omit<CompanyUserSummary, "membershipId" | "createdAt"> & { id: string }; onSaved({ ...user, ...updated, membershipId: updated.id ?? user.membershipId }) } catch { setError("Não foi possível salvar o acesso.") } finally { inFlight.current = false; setPending(false) } }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (self) return; const values = new FormData(event.currentTarget); void perform({ displayName: values.get("displayName"), role: values.get("role"), modules: values.getAll("modules"), status, suspensionReason: status === "suspended" ? values.get("suspensionReason") : null, version: user.version }) }
  return <><DialogPrimitive.Root open onOpenChange={(open) => { if (!open) close() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" /><DialogPrimitive.Content onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} className="fixed bottom-0 left-1/2 z-40 max-h-[96dvh] w-full max-w-xl -translate-x-1/2 overflow-y-auto border border-border bg-card p-5 shadow-2xl outline-none sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-7"><header className="flex justify-between gap-4"><div><DialogPrimitive.Title className="font-semibold">Editar acesso</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{user.email}</DialogPrimitive.Description></div><Button variant="ghost" size="icon" onClick={close} disabled={pending} aria-label="Fechar"><XIcon /></Button></header><form onSubmit={submit} className="mt-6 space-y-5"><fieldset disabled={pending || self} className="space-y-5"><div className="space-y-2"><Label htmlFor="edit-user-name">Nome</Label><Input id="edit-user-name" name="displayName" defaultValue={user.displayName} minLength={2} maxLength={120} required /></div><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="edit-user-role">Papel</Label><select id="edit-user-role" name="role" defaultValue={user.role} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="member">Membro</option><option value="company_admin">Administrador</option></select></div><div className="space-y-2"><Label htmlFor="edit-user-status">Status</Label><select id="edit-user-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></div></div><fieldset><legend className="mb-3 text-sm font-medium">Módulos</legend><div className="grid gap-2 sm:grid-cols-3">{MODULES.map(([value,label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" name="modules" value={value} defaultChecked={user.modules.includes(value)} className="size-4 accent-primary" />{label}</label>)}</div></fieldset>{status === "suspended" ? <div className="space-y-2"><Label htmlFor="suspension-reason">Motivo da suspensão</Label><textarea id="suspension-reason" name="suspensionReason" minLength={10} maxLength={500} required className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm" /></div> : null}</fieldset>{self ? <p role="alert" className="text-sm text-muted-foreground"><ShieldCheckIcon className="mr-1 inline" />Seu próprio acesso não pode ser alterado por esta tela.</p> : null}<div aria-live="polite" className="min-h-5 text-sm">{error ? <p role="alert" className="text-destructive">{error}</p> : null}</div><footer className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || self}>{pending ? "Salvando..." : "Salvar alterações"}</Button></footer></form></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root><ReauthenticationDialog open={reauthOpen} onOpenChange={(open) => { setReauthOpen(open); if (!open) retry.current = null }} onConfirmed={async () => { const payload = retry.current; if (payload) await perform(payload) }} /></>
}
