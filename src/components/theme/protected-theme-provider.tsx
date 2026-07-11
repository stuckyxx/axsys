"use client"

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"

import { ThemeStorageSynchronizer } from "@/components/theme/theme-storage-synchronizer"
import { AxsysThemeProvider } from "@/lib/theme/theme-provider"
import type { ThemePreference } from "@/modules/auth/domain/access-context"

type ThemeCommit = (theme: ThemePreference, version: number) => void

const ThemeCommitContext = createContext<ThemeCommit | null>(null)
const NOOP_THEME_COMMIT: ThemeCommit = () => undefined

type ProtectedThemeProviderProps = Readonly<{
  children: ReactNode
  initialTheme: ThemePreference
  initialVersion: number
  nonce: string
  userId: string
}>

type LocalOverride = Readonly<{
  baseVersion: number
  theme: ThemePreference
  version: number
}>

export function ProtectedThemeProvider({
  children,
  initialTheme,
  initialVersion,
  nonce,
  userId,
}: ProtectedThemeProviderProps) {
  const [localOverride, setLocalOverride] = useState<LocalOverride | null>(null)
  const current =
    localOverride?.baseVersion === initialVersion
      ? localOverride
      : { theme: initialTheme, version: initialVersion }
  const commit = useCallback<ThemeCommit>(
    (theme, version) => {
      setLocalOverride({ baseVersion: initialVersion, theme, version })
    },
    [initialVersion],
  )

  return (
    <ThemeCommitContext.Provider value={commit}>
      <AxsysThemeProvider
        forcedTheme={current.theme}
        initialTheme={initialTheme}
        nonce={nonce}
        userId={userId}
      >
        <ThemeStorageSynchronizer
          theme={current.theme}
          version={current.version}
        />
        {children}
      </AxsysThemeProvider>
    </ThemeCommitContext.Provider>
  )
}

export function useAuthoritativeThemeCommit(): ThemeCommit {
  return useContext(ThemeCommitContext) ?? NOOP_THEME_COMMIT
}
