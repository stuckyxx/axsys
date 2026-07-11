"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"

import { createBrowserQueryClient } from "@/lib/query/query-client"

type QueryProviderProps = Readonly<{ children: ReactNode }>

export function QueryProvider({ children }: QueryProviderProps) {
  const [client] = useState(createBrowserQueryClient)

  useEffect(
    () => () => {
      client.clear()
    },
    [client],
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
