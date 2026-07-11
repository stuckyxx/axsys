"use client"

import type { ReactNode } from "react"
import {
  BuildingsIcon,
  CertificateIcon,
  CurrencyCircleDollarIcon,
  GaugeIcon,
  IdentificationCardIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import {
  ResponsiveNavigation,
  type NavigationItem,
} from "@/components/layout/responsive-navigation"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import type {
  CompanyRole,
  ModuleKey,
  ProfileSummary,
} from "@/modules/auth/domain/access-context"

export type CompanyShellContext = Readonly<{
  modules: readonly ModuleKey[]
  profile: ProfileSummary
  role: CompanyRole
}>

const MODULE_ITEMS = {
  administrative: {
    href: "/app/administrativo/clientes",
    icon: IdentificationCardIcon,
    label: "Administrativo",
  },
  financial: {
    href: "/app/financeiro",
    icon: CurrencyCircleDollarIcon,
    label: "Financeiro",
  },
  certificates: {
    href: "/app/certidoes",
    icon: CertificateIcon,
    label: "Certidões",
  },
} as const satisfies Record<ModuleKey, NavigationItem>

type CompanyShellProps = Readonly<{
  children: ReactNode
  context: CompanyShellContext
}>

export function CompanyShell({ children, context }: CompanyShellProps) {
  const items: NavigationItem[] = [
    { href: "/app/dashboard", icon: GaugeIcon, label: "Dashboard" },
    ...context.modules.map((module) => MODULE_ITEMS[module]),
  ]

  if (context.role === "company_admin") {
    items.push({ href: "/app/usuarios", icon: UsersThreeIcon, label: "Usuários" })
  }

  items.push({
    href: "/app/configuracoes/perfil",
    icon: UserCircleIcon,
    label: "Perfil",
  })

  if (context.role === "company_admin") {
    items.push({
      href: "/app/configuracoes/empresa",
      icon: BuildingsIcon,
      label: "Empresa",
    })
  }

  return (
    <ResponsiveNavigation
      displayName={context.profile.displayName}
      email={context.profile.email}
      items={items}
      portalLabel="empresa"
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
