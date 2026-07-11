"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"

import type { ThemePreference } from "@/modules/auth/domain/access-context"

type ThemeStorageSynchronizerProps = Readonly<{
  theme: ThemePreference
  version: number
}>

export function ThemeStorageSynchronizer({
  theme,
  version,
}: ThemeStorageSynchronizerProps) {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme(theme)
  }, [setTheme, theme, version])

  return null
}
