"use client"

import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"

type AxsysThemeProviderProps = {
  children: ReactNode
  userId: string
  initialTheme?: "dark" | "light"
}

export function AxsysThemeProvider({
  children,
  userId,
  initialTheme = "dark",
}: AxsysThemeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={initialTheme}
      enableSystem={false}
      key={userId}
      storageKey={`axsys-theme:${userId}`}
    >
      {children}
    </ThemeProvider>
  )
}
