"use client"

import { useState, type ReactNode } from "react"
import {
  BuildingsIcon,
  GaugeIcon,
  HeartbeatIcon,
  ScrollIcon,
  SignOutIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import {
  ResponsiveNavigation,
  type NavigationItem,
} from "@/components/layout/responsive-navigation"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Button } from "@/components/ui/button"
import type { ProfileSummary } from "@/modules/auth/domain/access-context"

export type PlatformShellContext = Readonly<{
  profile: ProfileSummary
}>

const PLATFORM_ITEMS = Object.freeze([
  { href: "/platform", icon: GaugeIcon, label: "Visão geral" },
  { href: "/platform/empresas", icon: BuildingsIcon, label: "Empresas" },
  {
    href: "/platform/administradores",
    icon: UsersThreeIcon,
    label: "Administradores",
  },
  { href: "/platform/auditoria", icon: ScrollIcon, label: "Auditoria" },
  { href: "/platform/saude", icon: HeartbeatIcon, label: "Saúde" },
] satisfies readonly NavigationItem[])

type PlatformShellProps = Readonly<{
  children: ReactNode
  context: PlatformShellContext
}>

export function PlatformShell({ children, context }: PlatformShellProps) {
  return (
    <ResponsiveNavigation
      displayName={context.profile.displayName}
      email={context.profile.email}
      items={PLATFORM_ITEMS}
      portalLabel="plataforma"
      utility={
        <>
          <ThemeToggle
            initialTheme={context.profile.preferredTheme}
            initialVersion={context.profile.version}
          />
          <PlatformSignOut />
        </>
      }
    >
      {children}
    </ResponsiveNavigation>
  )
}

function PlatformSignOut() {
  const [pending, setPending] = useState(false)

  async function signOut() {
    if (pending) return
    setPending(true)
    try {
      const csrf = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", redirect: "error" })
      const body = (await csrf.json()) as unknown
      const token = typeof body === "object" && body !== null && "token" in body && typeof body.token === "string" ? body.token : null
      if (!csrf.ok || !token) return
      const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "x-csrf-token": token } })
      if (response.ok) window.location.replace("/login")
    } finally {
      setPending(false)
    }
  }

  return <Button aria-label="Sair" className="size-11" disabled={pending} onClick={signOut} size="icon" type="button" variant="ghost"><SignOutIcon aria-hidden className="size-5" weight="bold" /></Button>
}
