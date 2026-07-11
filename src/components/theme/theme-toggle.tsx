"use client"

import { useEffect, useRef, useState } from "react"
import { MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { useAuthoritativeThemeCommit } from "@/components/theme/protected-theme-provider"
import type { ThemePreference } from "@/modules/auth/domain/access-context"

const GENERIC_ERROR = "Não foi possível salvar o tema. Tente novamente."
const CONFLICT_ERROR = "Os dados mudaram em outra sessão. Tente novamente."
export const PROFILE_THEME_INVALIDATED_EVENT = "axsys:profile-theme-invalidated"

type ThemeToggleProps = Readonly<{
  initialTheme: ThemePreference
  initialVersion: number
  onProfileInvalidated?: () => void
}>

type ThemeRow = Readonly<{
  preferredTheme: ThemePreference
  version: number
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readThemeRow(value: unknown): ThemeRow | null {
  if (!isRecord(value)) return null
  const { preferredTheme, version } = value
  if (
    (preferredTheme !== "dark" && preferredTheme !== "light") ||
    !Number.isSafeInteger(version) ||
    (version as number) <= 0
  ) {
    return null
  }
  return Object.freeze({
    preferredTheme,
    version: version as number,
  })
}

function readErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null
  const code = value.error.code
  return typeof code === "string" && code.length > 0 && code.length <= 80
    ? code
    : null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function ThemeToggle({
  initialTheme,
  initialVersion,
  onProfileInvalidated,
}: ThemeToggleProps) {
  const { setTheme } = useTheme()
  const commitAuthoritativeTheme = useAuthoritativeThemeCommit()
  const [persistedTheme, setPersistedTheme] = useState(initialTheme)
  const [selectedTheme, setSelectedTheme] = useState(initialTheme)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(initialVersion)
  const csrfToken = useRef<string | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  function publishProfileInvalidation(): void {
    onProfileInvalidated?.()
    window.dispatchEvent(new Event(PROFILE_THEME_INVALIDATED_EVENT))
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestController.current?.abort()
      requestController.current = null
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    if (inFlight.current) return
    version.current = initialVersion
    setPersistedTheme(initialTheme)
    setSelectedTheme(initialTheme)
  }, [initialTheme, initialVersion])

  async function getCsrfToken(signal: AbortSignal): Promise<string> {
    if (csrfToken.current !== null) return csrfToken.current

    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal,
    })
    const body = await readJson(response)
    const token = isRecord(body) ? body.token : null
    if (
      !response.ok ||
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 128 ||
      token !== token.trim()
    ) {
      throw new Error("CSRF_UNAVAILABLE")
    }
    csrfToken.current = token
    return token
  }

  async function toggleTheme(): Promise<void> {
    if (inFlight.current) return

    inFlight.current = true
    const targetTheme: ThemePreference =
      persistedTheme === "dark" ? "light" : "dark"
    const controller = new AbortController()
    requestController.current?.abort()
    requestController.current = controller
    setSelectedTheme(targetTheme)
    setPending(true)
    setError(null)

    try {
      const token = await getCsrfToken(controller.signal)
      const response = await fetch("/api/profile/theme", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ theme: targetTheme, version: version.current }),
        signal: controller.signal,
      })
      const body = await readJson(response)

      if (!response.ok) {
        const code = readErrorCode(body)
        if (code === "CSRF_INVALID") csrfToken.current = null
        if (response.status === 409 && code === "VERSION_CONFLICT" && isRecord(body)) {
          const current = readThemeRow(body.current)
          if (current === null) throw new Error("INVALID_RESPONSE")
          version.current = current.version
          if (!mounted.current || controller.signal.aborted) return
          setPersistedTheme(current.preferredTheme)
          setSelectedTheme(current.preferredTheme)
          setTheme(current.preferredTheme)
          commitAuthoritativeTheme(current.preferredTheme, current.version)
          publishProfileInvalidation()
          setError(CONFLICT_ERROR)
          return
        }
        throw new Error("PERSISTENCE_FAILED")
      }

      const persisted = readThemeRow(body)
      if (persisted === null || persisted.preferredTheme !== targetTheme) {
        throw new Error("INVALID_RESPONSE")
      }

      version.current = persisted.version
      if (!mounted.current || controller.signal.aborted) return
      setPersistedTheme(persisted.preferredTheme)
      setSelectedTheme(persisted.preferredTheme)
      setTheme(persisted.preferredTheme)
      commitAuthoritativeTheme(persisted.preferredTheme, persisted.version)
      publishProfileInvalidation()
    } catch {
      if (controller.signal.aborted || !mounted.current) return
      setSelectedTheme(persistedTheme)
      setError(GENERIC_ERROR)
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
      }
      inFlight.current = false
      if (!controller.signal.aborted && mounted.current) setPending(false)
    }
  }

  const lightSelected = selectedTheme === "light"

  return (
    <div className="relative flex items-center gap-2">
      {error ? (
        <p
          className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-64 rounded-lg border border-destructive/30 bg-popover p-3 text-xs leading-relaxed text-destructive shadow-[0_16px_36px_-24px_oklch(0.08_0.02_252/0.72)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Button
        aria-label={lightSelected ? "Ativar tema escuro" : "Ativar tema claro"}
        className="size-11"
        data-selected-theme={selectedTheme}
        disabled={pending}
        onClick={toggleTheme}
        size="icon"
        title={lightSelected ? "Ativar tema escuro" : "Ativar tema claro"}
        type="button"
        variant="ghost"
      >
        {lightSelected ? (
          <MoonIcon aria-hidden className="size-5" weight="bold" />
        ) : (
          <SunIcon aria-hidden className="size-5" weight="bold" />
        )}
      </Button>
    </div>
  )
}
