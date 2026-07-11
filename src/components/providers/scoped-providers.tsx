"use client"

import type { ReactNode } from "react"

import { Toaster } from "@/components/ui/sonner"
import { ProtectedThemeProvider } from "@/components/theme/protected-theme-provider"
import type { ThemePreference } from "@/modules/auth/domain/access-context"

type ScopedProvidersProps = Readonly<{
  children: ReactNode
  companyId: string | null
  initialTheme: ThemePreference
  nonce: string
  profileVersion: number
  userId: string
}>

export function ScopedProviders({
  children,
  companyId,
  initialTheme,
  nonce,
  profileVersion,
  userId,
}: ScopedProvidersProps) {
  const scopeKey = `${userId}:${companyId ?? "platform"}`

  return (
    <ProtectedThemeProvider
      initialTheme={initialTheme}
      initialVersion={profileVersion}
      key={scopeKey}
      nonce={nonce}
      userId={userId}
    >
      {children}
      <Toaster />
    </ProtectedThemeProvider>
  )
}
