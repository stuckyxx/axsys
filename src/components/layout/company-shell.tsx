"use client"

import type { ReactNode } from "react"
import {
  BuildingsIcon,
  BriefcaseIcon,
  CertificateIcon,
  CurrencyCircleDollarIcon,
  FileTextIcon,
  HandshakeIcon,
  HouseIcon,
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

const ADMINISTRATIVE_ITEMS = [
  {
    href: "/app/administrativo/clientes",
    icon: UsersThreeIcon,
    label: "Clientes",
  },
  {
    href: "/app/administrativo/servicos",
    icon: BriefcaseIcon,
    label: "Serviços",
  },
  {
    href: "/app/administrativo/propostas",
    icon: FileTextIcon,
    label: "Propostas",
  },
  {
    href: "/app/administrativo/contratos",
    icon: HandshakeIcon,
    label: "Contratos",
  },
] as const satisfies readonly NavigationItem[]

const MODULE_ITEMS: Record<ModuleKey, readonly NavigationItem[]> = {
  financial: [{
    href: "/app/financeiro",
    icon: CurrencyCircleDollarIcon,
    label: "Financeiro",
  }],
  certificates: [{
    href: "/app/certidoes",
    icon: CertificateIcon,
    label: "Certidões",
  }],
  administrative: ADMINISTRATIVE_ITEMS,
}

type CompanyShellProps = Readonly<{
  children: ReactNode
  context: CompanyShellContext
}>

export function CompanyShell({ children, context }: CompanyShellProps) {
  const items: NavigationItem[] = [
    { href: "/app/dashboard", icon: HouseIcon, label: "Dashboard" },
    ...context.modules.flatMap((module) => MODULE_ITEMS[module]),
  ]

  if (context.role === "company_admin") {
    items.push({
      href: "/app/usuarios",
      icon: IdentificationCardIcon,
      label: "Usuários",
    })
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
      label: "Configurações",
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
