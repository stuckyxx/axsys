import type { ReactNode } from "react"
import { headers } from "next/headers"

import { CompanyShell } from "@/components/layout/company-shell"
import { ScopedProviders } from "@/components/providers/scoped-providers"
import { requireRequestNonce } from "@/lib/security/request-nonce"
import { requireCompanyContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const context = await requireCompanyContext()
  const nonce = requireRequestNonce((await headers()).get("x-nonce"))
  const shellContext = Object.freeze({
    modules: context.modules,
    profile: context.profile,
    role: context.role,
  })

  return (
    <ScopedProviders
      companyId={context.companyId}
      initialTheme={context.profile.preferredTheme}
      key={`${context.userId}:${context.companyId}`}
      nonce={nonce}
      profileVersion={context.profile.version}
      userId={context.userId}
    >
      <CompanyShell context={shellContext}>{children}</CompanyShell>
    </ScopedProviders>
  )
}
