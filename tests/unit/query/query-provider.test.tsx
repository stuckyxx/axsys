import { QueryClient, useQueryClient } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { createBrowserQueryClient } from "@/lib/query/query-client"
import { QueryProvider } from "@/lib/query/query-provider"

function ClientProbe({ observe }: Readonly<{ observe: (client: QueryClient) => void }>) {
  observe(useQueryClient())
  return null
}

function MountedProvider({
  children,
  identity,
}: Readonly<{ children: ReactNode; identity: string }>) {
  return <QueryProvider key={identity}>{children}</QueryProvider>
}

describe("Task 16 ephemeral query provider", () => {
  it("uses fresh focus/reconnect reads and no mutation retries", () => {
    const client = createBrowserQueryClient()

    expect(client.getDefaultOptions()).toMatchObject({
      queries: {
        gcTime: 5 * 60_000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 0,
      },
      mutations: { retry: 0 },
    })
  })

  it("owns one client per mount and clears it across identity changes and unmount", () => {
    const clear = vi.spyOn(QueryClient.prototype, "clear")
    let current: QueryClient | null = null
    const observe = (client: QueryClient) => {
      current = client
    }
    const { rerender, unmount } = render(
      <MountedProvider identity="user-a:company-a">
        <ClientProbe observe={observe} />
      </MountedProvider>,
    )
    const first = current

    rerender(
      <MountedProvider identity="user-a:company-a">
        <ClientProbe observe={observe} />
      </MountedProvider>,
    )
    expect(current).toBe(first)
    expect(clear).not.toHaveBeenCalled()

    rerender(
      <MountedProvider identity="user-b:company-b">
        <ClientProbe observe={observe} />
      </MountedProvider>,
    )
    expect(current).not.toBe(first)
    expect(clear).toHaveBeenCalledTimes(1)

    unmount()
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it("does not import or address persistent browser cache storage", () => {
    const source = [
      "src/lib/query/query-client.ts",
      "src/lib/query/query-provider.tsx",
    ]
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n")

    expect(source).not.toMatch(
      /persistQueryClient|createSyncStoragePersister|localStorage|sessionStorage|indexedDB/iu,
    )
  })
})
