"use client"

import { useRef, useState } from "react"
import { CameraIcon, UserCircleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { ThemeToggle, PROFILE_THEME_INVALIDATED_EVENT } from "@/components/theme/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OwnProfileSnapshot } from "@/lib/db/bff"
import { ImageUploadField } from "@/modules/files/ui/image-upload-field"

type Props = Readonly<{
  initialProfile: OwnProfileSnapshot
  allowAvatar: boolean
}>

type ErrorBody = Readonly<{
  error?: { code?: string; message?: string }
  current?: OwnProfileSnapshot
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorBody(value: unknown): ErrorBody {
  if (!isRecord(value)) return {}
  return value as ErrorBody
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function ProfileForm({ initialProfile, allowAvatar }: Props) {
  const router = useRouter()
  const [profile, setProfile] = useState(initialProfile)
  const [displayName, setDisplayName] = useState(initialProfile.displayName)
  const [pending, setPending] = useState(false)
  const [avatarPending, setAvatarPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const csrf = useRef<string | null>(null)

  async function csrfToken(signal: AbortSignal): Promise<string> {
    if (csrf.current) return csrf.current
    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal,
    })
    const body = await readBody(response)
    const token = isRecord(body) && typeof body.token === "string" ? body.token : null
    if (!response.ok || !token) throw new Error("CSRF unavailable")
    csrf.current = token
    return token
  }

  function invalidateProfile(next: OwnProfileSnapshot) {
    setProfile(next)
    window.dispatchEvent(new Event(PROFILE_THEME_INVALIDATED_EVENT))
    router.refresh()
  }

  async function mutate(
    endpoint: "/api/profile" | "/api/profile/avatar",
    method: "PATCH" | "POST",
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<OwnProfileSnapshot | null> {
    const token = await csrfToken(signal)
    const response = await fetch(endpoint, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify(payload),
      signal,
    })
    const body = await readBody(response)
    if (!response.ok) {
      const parsed = errorBody(body)
      if (parsed.error?.code === "CSRF_INVALID") csrf.current = null
      if (response.status === 409 && parsed.error?.code === "VERSION_CONFLICT") {
        if (parsed.current?.version) {
          setProfile((current) => ({ ...current, version: parsed.current!.version }))
        }
        setError("O perfil foi alterado em outra sessão. Sua edição foi preservada.")
        return null
      }
      throw new Error("Profile mutation unavailable")
    }
    if (!isRecord(body)) throw new Error("Invalid profile response")
    return body as OwnProfileSnapshot
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const normalized = displayName.trim()
    if (normalized.length < 2 || normalized.length > 120) {
      setError("Informe um nome entre 2 e 120 caracteres.")
      return
    }
    const controller = new AbortController()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const next = await mutate(
        "/api/profile",
        "PATCH",
        { displayName: normalized, version: profile.version },
        controller.signal,
      )
      if (next) {
        setDisplayName(next.displayName)
        invalidateProfile(next)
        setMessage("Perfil atualizado.")
      }
    } catch {
      setError("Não foi possível salvar o perfil.")
    } finally {
      setPending(false)
    }
  }

  async function attachAvatar(file: { id: string }) {
    if (avatarPending) return
    const controller = new AbortController()
    setAvatarPending(true)
    setError(null)
    setMessage(null)
    try {
      const next = await mutate(
        "/api/profile/avatar",
        "POST",
        { fileId: file.id, version: profile.version },
        controller.signal,
      )
      if (next) {
        invalidateProfile(next)
        setMessage("Avatar atualizado.")
      }
    } catch {
      setError("Não foi possível vincular o avatar verificado.")
    } finally {
      setAvatarPending(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[12rem_minmax(0,1fr)]" aria-labelledby="profile-identity-title">
        <div>
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card text-muted-foreground">
            {profile.avatarFileId && allowAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- protected no-store file route.
              <img alt="Avatar atual" className="size-full object-cover" src={`/api/files/${profile.avatarFileId}/download`} />
            ) : <UserCircleIcon aria-hidden className="size-12" weight="duotone" />}
          </div>
          <p className="mt-3 font-mono text-xs text-muted-foreground">Versão {profile.version}</p>
        </div>
        <form className="space-y-5" onSubmit={save}>
          <div><h2 className="text-lg font-semibold" id="profile-identity-title">Identidade</h2><p className="mt-1 text-sm text-muted-foreground">O nome aparece nos registros e nas áreas protegidas.</p></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="profile-name">Nome completo</Label><Input id="profile-name" maxLength={120} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} /></div>
            <div className="space-y-2"><Label htmlFor="profile-email">E-mail</Label><Input disabled id="profile-email" type="email" value={profile.email} /><p className="text-xs text-muted-foreground">A alteração de e-mail ainda não está disponível.</p></div>
          </div>
          <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/95 py-4 backdrop-blur-sm"><Button className="min-h-11" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar perfil"}</Button></div>
        </form>
      </section>

      {allowAvatar ? <section className="space-y-4" aria-labelledby="profile-avatar-title"><div className="flex items-center gap-2"><CameraIcon aria-hidden className="size-5 text-primary" weight="duotone" /><h2 className="text-lg font-semibold" id="profile-avatar-title">Avatar</h2></div><ImageUploadField description="A imagem passa por quarentena, verificação e normalização antes de ser vinculada." label="Avatar do perfil" onReady={attachAvatar} purpose="profile_avatar" />{avatarPending ? <p className="text-sm text-muted-foreground">Vinculando avatar verificado…</p> : null}</section> : null}

      <section className="flex flex-col gap-4 border-t border-border pt-7 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="profile-theme-title"><div><h2 className="text-lg font-semibold" id="profile-theme-title">Aparência</h2><p className="mt-1 text-sm text-muted-foreground">Escolha o tema aplicado aos seus dispositivos.</p></div><ThemeToggle initialTheme={profile.preferredTheme} initialVersion={profile.version} /></section>

      <div aria-live="polite" className="min-h-6 text-sm">{error ? <p className="border-l-2 border-destructive pl-3 text-destructive" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}</div>
    </div>
  )
}
