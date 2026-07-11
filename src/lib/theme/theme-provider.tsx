"use client"

import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"

type AxsysThemeProviderProps = {
  children: ReactNode
  forcedTheme?: "dark" | "light"
  nonce?: string
  userId: string
  initialTheme?: "dark" | "light"
}

export function AxsysThemeProvider({
  children,
  forcedTheme,
  nonce,
  userId,
  initialTheme = "dark",
}: AxsysThemeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={initialTheme}
      enableSystem={false}
      forcedTheme={forcedTheme}
      key={userId}
      nonce={nonce}
      storageKey={`axsys-theme:${userId}`}
    >
      {children}
    </ThemeProvider>
  )
}
