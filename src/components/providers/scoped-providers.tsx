"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { Toaster } from "@/components/ui/sonner"
import { ProtectedThemeProvider } from "@/components/theme/protected-theme-provider"
import { PROFILE_THEME_INVALIDATED_EVENT } from "@/components/theme/theme-toggle"
import {
  getMutationSenderId,
  publishInvalidation,
  useMutationSync,
} from "@/lib/query/mutation-sync"
import { queryKeys, type QueryScope } from "@/lib/query/query-keys"
import { QueryProvider } from "@/lib/query/query-provider"
import { useSessionWatchdog } from "@/lib/query/session-watchdog"
import { settleRealtimeCleanup } from "@/lib/realtime/realtime-lifecycle"
import { getBrowserRealtime } from "@/lib/supabase/browser"
import type { ThemePreference } from "@/modules/auth/domain/access-context"
import { COMPANY_SETTINGS_INVALIDATED_EVENT } from "@/modules/settings/ui/company-settings-events"

type ScopedProvidersProps = Readonly<{
  children: ReactNode
  companyId: string | null
  initialTheme: ThemePreference
  nonce: string
  profileVersion: number
  userId: string
}>

type BaseTableSubscription = Readonly<{
  filter?: string
  table: "companies" | "company_memberships" | "member_modules" | "profiles"
}>

function baseTableSubscriptions(scope: QueryScope): BaseTableSubscription[] {
  const subscriptions: BaseTableSubscription[] = [
    { table: "profiles", filter: `user_id=eq.${scope.userId}` },
  ]

  if (scope.companyId === null) {
    subscriptions.push(
      { table: "companies" },
      { table: "company_memberships" },
      { table: "member_modules" },
    )
    return subscriptions
  }

  subscriptions.push(
    { table: "companies", filter: `id=eq.${scope.companyId}` },
    {
      table: "company_memberships",
      filter: `company_id=eq.${scope.companyId}`,
    },
    { table: "member_modules", filter: `company_id=eq.${scope.companyId}` },
  )
  return subscriptions
}

function ScopedSignalBridge({
  companyId,
  userId,
}: Readonly<{ companyId: string | null; userId: string }>) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [senderId] = useState(getMutationSenderId)
  const scope = useMemo(
    () => Object.freeze({ companyId, userId }),
    [companyId, userId],
  )
  const refreshRoute = useCallback(() => router.refresh(), [router])
  const revalidateSession = useSessionWatchdog(scope, queryClient, {
    refresh: refreshRoute,
    senderId,
  })
  const revalidateFromSignal = useCallback(() => {
    void revalidateSession()
  }, [revalidateSession])
  const handleRealtimeSignal = useCallback(() => {
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.root(scope) })
      .catch(() => undefined)
    revalidateFromSignal()
  }, [queryClient, revalidateFromSignal, scope])

  useMutationSync(scope, queryClient, {
    onInvalidate: revalidateFromSignal,
    senderId,
  })

  useEffect(() => {
    const publishProfileSignal = () => {
      publishInvalidation({
        resources: ["profile"],
        scope,
        senderId,
        type: "invalidate",
      })
    }

    window.addEventListener(
      PROFILE_THEME_INVALIDATED_EVENT,
      publishProfileSignal,
    )
    return () => {
      window.removeEventListener(
        PROFILE_THEME_INVALIDATED_EVENT,
        publishProfileSignal,
      )
    }
  }, [scope, senderId])

  useEffect(() => {
    const publishCompanySettingsSignal = () => {
      publishInvalidation({
        resources: ["company-settings"],
        scope,
        senderId,
        type: "invalidate",
      })
    }
    window.addEventListener(
      COMPANY_SETTINGS_INVALIDATED_EVENT,
      publishCompanySettingsSignal,
    )
    return () => {
      window.removeEventListener(
        COMPANY_SETTINGS_INVALIDATED_EVENT,
        publishCompanySettingsSignal,
      )
    }
  }, [scope, senderId])

  useEffect(() => {
    let realtime: ReturnType<typeof getBrowserRealtime>
    try {
      realtime = getBrowserRealtime()
    } catch {
      return
    }
    let active = true
    let channel = realtime.channel(
      `axsys:scope:${scope.userId}:${scope.companyId ?? "platform"}`,
    )
    let realtimeRecovery: Promise<void> | null = null

    const recoverRealtime = (): Promise<void> => {
      if (!active) return Promise.resolve()
      if (realtimeRecovery !== null) return realtimeRecovery

      const recovery = (async () => {
        try {
          await realtime.refreshAuth()
        } catch {
          // The authoritative session watchdog decides whether to end access.
        }
        if (active) await revalidateSession()
      })().catch(() => undefined)
      realtimeRecovery = recovery
      void recovery.finally(() => {
        if (realtimeRecovery === recovery) realtimeRecovery = null
      })
      return recovery
    }

    for (const subscription of baseTableSubscriptions(scope)) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: subscription.table,
          ...(subscription.filter ? { filter: subscription.filter } : {}),
        },
        handleRealtimeSignal,
      )
    }

    const subscribe = async () => {
      let initialAuthFailed = false
      try {
        await realtime.refreshAuth()
      } catch {
        initialAuthFailed = true
      }
      if (!active) return

      try {
        channel.subscribe((status) => {
          if (!active) return
          if (
            status === "SUBSCRIBED" ||
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            void recoverRealtime()
          }
        })
      } catch {
        await recoverRealtime()
        return
      }
      if (initialAuthFailed) void recoverRealtime()
    }
    void subscribe()

    return () => {
      active = false
      void settleRealtimeCleanup(realtime, channel)
    }
  }, [handleRealtimeSignal, revalidateSession, scope])

  return null
}

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
      <QueryProvider key={scopeKey}>
        <ScopedSignalBridge companyId={companyId} userId={userId} />
        {children}
        <Toaster />
      </QueryProvider>
    </ProtectedThemeProvider>
  )
}
