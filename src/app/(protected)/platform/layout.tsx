import type { ReactNode } from "react"
import { headers } from "next/headers"

import { PlatformShell } from "@/components/layout/platform-shell"
import { ScopedProviders } from "@/components/providers/scoped-providers"
import { requireRequestNonce } from "@/lib/security/request-nonce"
import { requirePlatformContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

export default async function PlatformLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const context = await requirePlatformContext()
  const nonce = requireRequestNonce((await headers()).get("x-nonce"))
  const shellContext = Object.freeze({ profile: context.profile })

  return (
    <ScopedProviders
      companyId={null}
      initialTheme={context.profile.preferredTheme}
      key={`${context.userId}:platform`}
      nonce={nonce}
      profileVersion={context.profile.version}
      userId={context.userId}
    >
      <PlatformShell context={shellContext}>{children}</PlatformShell>
    </ScopedProviders>
  )
}
