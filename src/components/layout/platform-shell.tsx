"use client"

import type { ReactNode } from "react"
import {
  BuildingsIcon,
  GaugeIcon,
  HeartbeatIcon,
  ScrollIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import {
  ResponsiveNavigation,
  type NavigationItem,
} from "@/components/layout/responsive-navigation"
import { ThemeToggle } from "@/components/theme/theme-toggle"
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
        <ThemeToggle
          initialTheme={context.profile.preferredTheme}
          initialVersion={context.profile.version}
        />
      }
    >
      {children}
    </ResponsiveNavigation>
  )
}
