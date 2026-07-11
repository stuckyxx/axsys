"use client"

import { QueryClient } from "@tanstack/react-query"

export function createBrowserQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: 0 },
      queries: {
        gcTime: 5 * 60_000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 0,
      },
    },
  })
}
