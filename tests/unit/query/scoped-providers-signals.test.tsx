import { QueryClient } from "@tanstack/react-query"
import { act, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ScopedProviders } from "@/components/providers/scoped-providers"
import { PROFILE_THEME_INVALIDATED_EVENT } from "@/components/theme/theme-toggle"
import { queryKeys } from "@/lib/query/query-keys"
import { INVALIDATION_CHANNEL } from "@/lib/realtime/invalidation-channel"

const mocks = vi.hoisted(() => ({
  getBrowserRealtime: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserRealtime: mocks.getBrowserRealtime,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}))

const USER_ID = "10000000-0000-4000-8000-000000000001"
const COMPANY_ID = "30000000-0000-4000-8000-000000000003"
const NONCE = "223e4567e89b42d3a456426614174000"

type RealtimeHandler = Readonly<{
  callback: (payload?: unknown) => void
  filter: Record<string, string>
  type: string
}>

type MessageListener = (event: MessageEvent<unknown>) => void

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []

  readonly listeners = new Set<MessageListener>()
  readonly messages: unknown[] = []
  closed = false

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") this.listeners.add(listener as MessageListener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") this.listeners.delete(listener as MessageListener)
  }

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  close() {
    this.closed = true
  }

  emit(data: unknown) {
    const event = new MessageEvent("message", { data })
    for (const listener of this.listeners) listener(event)
  }
}

function realtimeMock() {
  const handlers: RealtimeHandler[] = []
  const statusCallbacks: Array<(status: string) => void> = []
  const channel = {
    on: vi.fn(
      (
        type: string,
        filter: Record<string, string>,
        callback: (payload?: unknown) => void,
      ) => {
        handlers.push({ callback, filter, type })
        return channel
      },
    ),
    subscribe: vi.fn((callback?: (status: string) => void) => {
      if (callback) statusCallbacks.push(callback)
      return channel
    }),
  }
  const capability = {
    channel: vi.fn(() => channel),
    dispose: vi.fn().mockResolvedValue(undefined),
    refreshAuth: vi.fn().mockResolvedValue(undefined),
    removeChannel: vi.fn().mockResolvedValue("ok"),
  }
  return { capability, channel, handlers, statusCallbacks }
}

function meContext(companyId: string | null) {
  const profile = {
    displayName: "Usuário verificado",
    email: "verified@example.test",
    preferredTheme: "dark",
    version: 1,
  }
  return companyId === null
    ? { kind: "platform", userId: USER_ID, modules: [], profile }
    : {
        kind: "company",
        userId: USER_ID,
        companyId,
        role: "company_admin",
        modules: ["administrative"],
        profile,
      }
}

function stubMe(companyId: string | null) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(meContext(companyId)), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    ),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderScoped(companyId: string | null) {
  return render(
    <ScopedProviders
      companyId={companyId}
      initialTheme="dark"
      nonce={NONCE}
      profileVersion={1}
      userId={USER_ID}
    >
      <p>Conteúdo protegido</p>
    </ScopedProviders>,
  )
}

beforeEach(() => {
  FakeBroadcastChannel.instances = []
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
  mocks.routerRefresh.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Task 16 protected provider signals", () => {
  it("filters company subscriptions, discards payloads, and removes every channel", async () => {
    const realtime = realtimeMock()
    const fetchMock = stubMe(COMPANY_ID)
    mocks.getBrowserRealtime.mockReturnValue(realtime.capability)
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, "invalidateQueries")
      .mockResolvedValue()
    const setQueryData = vi.spyOn(QueryClient.prototype, "setQueryData")
    const view = renderScoped(COMPANY_ID)

    await waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce())
    expect(realtime.capability.refreshAuth).toHaveBeenCalledOnce()
    expect(realtime.capability.refreshAuth.mock.invocationCallOrder[0]).toBeLessThan(
      realtime.channel.subscribe.mock.invocationCallOrder[0],
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce())
    expect(realtime.capability.channel).toHaveBeenCalledWith(
      `axsys:scope:${USER_ID}:${COMPANY_ID}`,
    )
    expect(realtime.handlers.map(({ filter }) => filter)).toEqual([
      {
        event: "*",
        filter: `user_id=eq.${USER_ID}`,
        schema: "public",
        table: "profiles",
      },
      {
        event: "*",
        filter: `id=eq.${COMPANY_ID}`,
        schema: "public",
        table: "companies",
      },
      {
        event: "*",
        filter: `company_id=eq.${COMPANY_ID}`,
        schema: "public",
        table: "company_memberships",
      },
      {
        event: "*",
        filter: `company_id=eq.${COMPANY_ID}`,
        schema: "public",
        table: "member_modules",
      },
    ])

    act(() => {
      realtime.handlers[1].callback({
        new: { legal_name: "Payload empresarial que deve ser descartado" },
      })
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.root({ userId: USER_ID, companyId: COMPANY_ID }),
      }),
    )
    expect(setQueryData).not.toHaveBeenCalled()
    expect(JSON.stringify(invalidateQueries.mock.calls)).not.toContain(
      "Payload empresarial",
    )

    act(() => realtime.statusCallbacks[0]("SUBSCRIBED"))
    await waitFor(() =>
      expect(realtime.capability.refreshAuth).toHaveBeenCalledTimes(2),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(3))

    const receivingChannel = FakeBroadcastChannel.instances.find(
      (channel) => channel.listeners.size > 0,
    )
    act(() =>
      receivingChannel?.emit({
        resources: ["profile"],
        scope: { userId: USER_ID, companyId: COMPANY_ID },
        senderId: "other-tab",
        type: "invalidate",
      }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(4))

    act(() => window.dispatchEvent(new Event(PROFILE_THEME_INVALIDATED_EVENT)))
    const published = FakeBroadcastChannel.instances.find(
      (channel) => channel.messages.length > 0,
    )
    expect(published?.name).toBe(INVALIDATION_CHANNEL)
    expect(published?.messages).toEqual([
      {
        resources: ["profile"],
        scope: { userId: USER_ID, companyId: COMPANY_ID },
        senderId: expect.any(String),
        type: "invalidate",
      },
    ])

    view.unmount()
    await waitFor(() =>
      expect(realtime.capability.removeChannel).toHaveBeenCalledWith(
        realtime.channel,
      ),
    )
    await waitFor(() => expect(realtime.capability.dispose).toHaveBeenCalledOnce())
    expect(
      FakeBroadcastChannel.instances.filter((channel) => !channel.closed),
    ).toEqual([])
  })

  it("keeps platform base-table subscriptions constrained by RLS and user profile", async () => {
    const realtime = realtimeMock()
    stubMe(null)
    mocks.getBrowserRealtime.mockReturnValue(realtime.capability)
    const view = renderScoped(null)

    await waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce())
    expect(realtime.handlers.map(({ filter }) => filter)).toEqual([
      {
        event: "*",
        filter: `user_id=eq.${USER_ID}`,
        schema: "public",
        table: "profiles",
      },
      { event: "*", schema: "public", table: "companies" },
      { event: "*", schema: "public", table: "company_memberships" },
      { event: "*", schema: "public", table: "member_modules" },
    ])

    view.unmount()
    expect(realtime.capability.removeChannel).toHaveBeenCalledOnce()
  })

  it("coalesces Realtime error statuses into one fresh authorization read", async () => {
    const realtime = realtimeMock()
    mocks.getBrowserRealtime.mockReturnValue(realtime.capability)
    let resolveRecovery!: (response: Response) => void
    const recovery = new Promise<Response>((resolve) => {
      resolveRecovery = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json(meContext(COMPANY_ID))),
      )
      .mockReturnValueOnce(recovery)
    vi.stubGlobal("fetch", fetchMock)
    const view = renderScoped(COMPANY_ID)

    await waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce())
    act(() => {
      realtime.statusCallbacks[0]("CHANNEL_ERROR")
      realtime.statusCallbacks[0]("TIMED_OUT")
      realtime.statusCallbacks[0]("CLOSED")
    })

    await waitFor(() =>
      expect(realtime.capability.refreshAuth).toHaveBeenCalledTimes(2),
    )
    expect(realtime.capability.refreshAuth).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    resolveRecovery(Response.json(meContext(COMPANY_ID)))
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(2))

    view.unmount()
  })

  it("invalidates the scoped root even when the watchdog read is unavailable", async () => {
    const realtime = realtimeMock()
    mocks.getBrowserRealtime.mockReturnValue(realtime.capability)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          Response.json({ error: { code: "UNAVAILABLE" } }, { status: 500 }),
        ),
      ),
    )
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, "invalidateQueries")
      .mockResolvedValue()
    const setQueryData = vi.spyOn(QueryClient.prototype, "setQueryData")
    const view = renderScoped(COMPANY_ID)

    await waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce())
    invalidateQueries.mockClear()
    act(() => {
      realtime.handlers[0].callback({
        new: { display_name: "payload must stay ignored" },
      })
    })

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.root({ userId: USER_ID, companyId: COMPANY_ID }),
      }),
    )
    expect(setQueryData).not.toHaveBeenCalled()
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
    view.unmount()
  })

  it("subscribes and schedules recovery after an initial token refresh failure", async () => {
    const realtime = realtimeMock()
    realtime.capability.refreshAuth
      .mockRejectedValueOnce(new Error("token endpoint unavailable"))
      .mockResolvedValueOnce(undefined)
    mocks.getBrowserRealtime.mockReturnValue(realtime.capability)
    stubMe(COMPANY_ID)
    const view = renderScoped(COMPANY_ID)

    await waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(realtime.capability.refreshAuth).toHaveBeenCalledTimes(2),
    )
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalled())

    view.unmount()
  })

  it("keeps protected content usable when optional signal transports are unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )
    mocks.getBrowserRealtime.mockImplementation(() => {
      throw new Error("Realtime unavailable")
    })

    let view: ReturnType<typeof renderScoped> | undefined
    expect(() => {
      view = renderScoped(COMPANY_ID)
    }).not.toThrow()
    expect(view?.getByText("Conteúdo protegido")).toBeVisible()
    expect(() => {
      act(() =>
        window.dispatchEvent(new Event(PROFILE_THEME_INVALIDATED_EVENT)),
      )
    }).not.toThrow()

    view?.unmount()
  })
})
