import { render, waitFor } from "@testing-library/react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { queryKeys, type QueryScope } from "@/lib/query/query-keys"
import {
  SESSION_WATCHDOG_INTERVAL_MS,
  SESSION_WATCHDOG_TIMEOUT_MS,
  useSessionWatchdog,
} from "@/lib/query/session-watchdog"
import { createTestQueryClient } from "../../helpers/query-client"

const USER_ID = "10000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000002"
const COMPANY_ID = "30000000-0000-4000-8000-000000000003"
const OTHER_COMPANY_ID = "40000000-0000-4000-8000-000000000004"
const SCOPE: QueryScope = { userId: USER_ID, companyId: COMPANY_ID }

class FakeBroadcastChannel {
  static messages: unknown[] = []

  constructor(readonly name: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
  postMessage(message: unknown) {
    FakeBroadcastChannel.messages.push(message)
  }
}

function validCompanyContext(overrides: Record<string, unknown> = {}) {
  return {
    kind: "company",
    userId: USER_ID,
    companyId: COMPANY_ID,
    role: "company_admin",
    modules: ["administrative", "financial"],
    profile: {
      displayName: "Empresa A",
      email: "admin-a@example.test",
      preferredTheme: "dark",
      version: 7,
    },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

function WatchdogProbe({
  client,
  refresh,
  replace,
  scope = SCOPE,
  stopDocument,
}: Readonly<{
  client: ReturnType<typeof createTestQueryClient>
  refresh: () => void
  replace?: (path: string) => void
  scope?: QueryScope
  stopDocument?: () => void
}>) {
  useSessionWatchdog(scope, client, {
    refresh,
    senderId: "watchdog-tab-a",
    ...(replace ? { replaceLocation: replace } : {}),
    ...(stopDocument ? { stopDocument } : {}),
  })
  return null
}

beforeEach(() => {
  FakeBroadcastChannel.messages = []
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Task 16 authenticated session watchdog", () => {
  it("reauthorizes no-store on mount, focus, online, and a bounded interval", async () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, "invalidateQueries")
    const refresh = vi.fn()
    const replace = vi.fn()
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(validCompanyContext())))
    vi.stubGlobal("fetch", fetchMock)
    const interval = vi.spyOn(window, "setInterval")
    const view = render(
      <WatchdogProbe client={client} refresh={refresh} replace={replace} />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.root(SCOPE),
    })

    act(() => window.dispatchEvent(new Event("focus")))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    act(() => window.dispatchEvent(new Event("online")))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3))

    expect(SESSION_WATCHDOG_INTERVAL_MS).toBeGreaterThan(0)
    expect(SESSION_WATCHDOG_INTERVAL_MS).toBeLessThanOrEqual(60_000)
    const intervalCall = interval.mock.calls.find(
      ([, delay]) => delay === SESSION_WATCHDOG_INTERVAL_MS,
    )
    expect(intervalCall).toBeDefined()
    await act(async () => {
      const callback = intervalCall?.[0]
      if (typeof callback === "function") callback()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    expect(replace).not.toHaveBeenCalled()
    view.unmount()
  })

  it.each([
    ["401", jsonResponse({ error: { code: "AUTH_REQUIRED" } }, 401)],
    ["forced password", jsonResponse({ error: { code: "PASSWORD_CHANGE_REQUIRED" } }, 403)],
    ["other user", jsonResponse(validCompanyContext({ userId: OTHER_USER_ID }))],
    [
      "other company",
      jsonResponse(validCompanyContext({ companyId: OTHER_COMPANY_ID })),
    ],
    ["extra field", jsonResponse(validCompanyContext({ accessToken: "forbidden" }))],
    [
      "invalid profile",
      jsonResponse(
        validCompanyContext({
          profile: {
            ...validCompanyContext().profile,
            refreshToken: "forbidden",
          },
        }),
      ),
    ],
  ])("ends the local and cross-tab session for %s", async (_case, response) => {
    const client = createTestQueryClient()
    const clear = vi.spyOn(client, "clear")
    const refresh = vi.fn()
    const replace = vi.fn()
    const stopDocument = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

    render(
      <WatchdogProbe
        client={client}
        refresh={refresh}
        replace={replace}
        stopDocument={stopDocument}
      />,
    )

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(stopDocument).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
    expect(FakeBroadcastChannel.messages).toEqual([
      {
        resources: [],
        scope: SCOPE,
        senderId: "watchdog-tab-a",
        type: "session-ended",
      },
    ])
  })

  it("does not destroy the session for a transient server failure", async () => {
    const client = createTestQueryClient()
    const clear = vi.spyOn(client, "clear")
    const replace = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "INTERNAL" } }, 500)),
    )

    render(
      <WatchdogProbe client={client} refresh={vi.fn()} replace={replace} />,
    )

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(clear).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(FakeBroadcastChannel.messages).toEqual([])
  })

  it("abandons a hung read and permits the next focus reauthorization", async () => {
    const client = createTestQueryClient()
    const refresh = vi.fn()
    const replace = vi.fn()
    const hung = new Promise<Response>(() => undefined)
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(hung)
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(validCompanyContext())),
      )
    vi.stubGlobal("fetch", fetchMock)
    const timeout = vi.spyOn(window, "setTimeout")
    const view = render(
      <WatchdogProbe client={client} refresh={refresh} replace={replace} />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(SESSION_WATCHDOG_TIMEOUT_MS).toBeGreaterThan(0)
    expect(SESSION_WATCHDOG_TIMEOUT_MS).toBeLessThan(SESSION_WATCHDOG_INTERVAL_MS)
    const timeoutCall = timeout.mock.calls.find(
      ([, delay]) => delay === SESSION_WATCHDOG_TIMEOUT_MS,
    )
    expect(timeoutCall).toBeDefined()

    await act(async () => {
      const callback = timeoutCall?.[0]
      if (typeof callback === "function") callback()
      await Promise.resolve()
    })
    act(() => window.dispatchEvent(new Event("focus")))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(replace).not.toHaveBeenCalled()
    view.unmount()
  })

  it("does not restart the mount watchdog when default navigation is rerendered", async () => {
    const client = createTestQueryClient()
    const refresh = vi.fn()
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(validCompanyContext())))
    vi.stubGlobal("fetch", fetchMock)
    const view = render(<WatchdogProbe client={client} refresh={refresh} />)

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    view.rerender(<WatchdogProbe client={client} refresh={refresh} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    view.unmount()
  })
})
