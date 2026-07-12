import { render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyClientInvalidation,
  publishInvalidation,
  useMutationSync,
} from "@/lib/query/mutation-sync"
import { queryKeys, type QueryScope } from "@/lib/query/query-keys"
import {
  INVALIDATION_CHANNEL,
  type ClientInvalidation,
} from "@/lib/realtime/invalidation-channel"
import { createTestQueryClient } from "../../helpers/query-client"

const USER_A = "10000000-0000-4000-8000-000000000001"
const USER_B = "20000000-0000-4000-8000-000000000002"
const COMPANY_A = "30000000-0000-4000-8000-000000000003"
const COMPANY_B = "40000000-0000-4000-8000-000000000004"
const SCOPE: QueryScope = { userId: USER_A, companyId: COMPANY_A }

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

function MutationSyncProbe({
  client,
  onInvalidate,
  scope,
}: Readonly<{
  client: ReturnType<typeof createTestQueryClient>
  onInvalidate?: () => void
  scope: QueryScope
}>) {
  useMutationSync(scope, client, { onInvalidate })
  return null
}

function invalidation(
  overrides: Partial<ClientInvalidation> = {},
): ClientInvalidation {
  return {
    type: "invalidate",
    scope: SCOPE,
    resources: ["clients", "client-detail", "client-count", "dashboard"],
    senderId: "tab-a",
    ...overrides,
  }
}

beforeEach(() => {
  FakeBroadcastChannel.instances = []
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Task 16 mutation synchronization", () => {
  it("publishes only a validated scoped signal and closes the transient channel", () => {
    const event = invalidation()

    publishInvalidation(event)

    expect(FakeBroadcastChannel.instances).toHaveLength(1)
    const channel = FakeBroadcastChannel.instances[0]
    expect(channel.name).toBe(INVALIDATION_CHANNEL)
    expect(channel.messages).toEqual([event])
    expect(channel.closed).toBe(true)
    expect(JSON.stringify(channel.messages)).not.toMatch(
      /accessToken|permission|row|total/iu,
    )
  })

  it("does not fail a completed mutation when opening BroadcastChannel is denied", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("Denied", "SecurityError")
        }
      },
    )

    expect(() => publishInvalidation(invalidation())).not.toThrow()
  })

  it("does not tear down the protected provider when its listener is denied", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("Denied", "SecurityError")
        }
      },
    )
    const client = createTestQueryClient()

    expect(() =>
      render(<MutationSyncProbe client={client} scope={SCOPE} />),
    ).not.toThrow()
  })

  it("rejects an outgoing object that smuggles a business payload", () => {
    const unsafe = {
      ...invalidation(),
      payload: { legalName: "Empresa sigilosa" },
    } as unknown as ClientInvalidation

    expect(() => publishInvalidation(unsafe)).toThrow("Invalid invalidation signal")
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
  })

  it.each([
    [
      "sparse holes",
      () => {
        const resources = new Array<string>(1)
        return resources
      },
    ],
    [
      "enumerable non-index properties",
      () => Object.assign(["clients"], { row: "forbidden" }),
    ],
    [
      "hidden non-index properties",
      () => {
        const resources = ["clients"]
        Object.defineProperty(resources, "payload", {
          value: "forbidden",
        })
        return resources
      },
    ],
    [
      "a sparse hole masked by an extra property",
      () => {
        const resources = new Array<string>(2)
        resources[0] = "clients"
        return Object.assign(resources, { extra: "dashboard" })
      },
    ],
  ])("rejects a resources array with %s", (_case, createResources) => {
    const unsafe = invalidation({ resources: createResources() })

    expect(() => publishInvalidation(unsafe)).toThrow(
      "Invalid invalidation signal",
    )
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
  })

  it("invalidates every matching resource prefix without writing payload data", async () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, "invalidateQueries")
    const setQueryData = vi.spyOn(client, "setQueryData")
    const { unmount } = render(<MutationSyncProbe client={client} scope={SCOPE} />)
    const channel = FakeBroadcastChannel.instances[0]

    channel.emit(invalidation())

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4))
    for (const resource of [
      "clients",
      "client-detail",
      "client-count",
      "dashboard",
    ]) {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.resource(SCOPE, resource),
      })
    }
    expect(setQueryData).not.toHaveBeenCalled()

    unmount()
    expect(channel.closed).toBe(true)
    expect(channel.listeners.size).toBe(0)
  })

  it("ignores another user, another company, and malformed payload-bearing messages", () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, "invalidateQueries")
    render(<MutationSyncProbe client={client} scope={SCOPE} />)
    const channel = FakeBroadcastChannel.instances[0]

    channel.emit(
      invalidation({ scope: { userId: USER_B, companyId: COMPANY_A } }),
    )
    channel.emit(
      invalidation({ scope: { userId: USER_A, companyId: COMPANY_B } }),
    )
    channel.emit({
      ...invalidation(),
      payload: { tradeName: "Não pode atravessar abas" },
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it("notifies the protected shell only for a valid same-scope refresh signal", async () => {
    const client = createTestQueryClient()
    const onInvalidate = vi.fn()
    render(
      <MutationSyncProbe
        client={client}
        onInvalidate={onInvalidate}
        scope={SCOPE}
      />,
    )
    const channel = FakeBroadcastChannel.instances[0]

    channel.emit(invalidation())
    await waitFor(() => expect(onInvalidate).toHaveBeenCalledOnce())

    channel.emit(
      invalidation({ scope: { userId: USER_A, companyId: COMPANY_B } }),
    )
    expect(onInvalidate).toHaveBeenCalledOnce()
  })

  it("clears a matching ended session and replaces browser history with login", () => {
    const client = createTestQueryClient()
    const clear = vi.spyOn(client, "clear")
    const replace = vi.fn()
    const stopDocument = vi.fn()

    applyClientInvalidation(
      invalidation({ type: "session-ended", resources: [] }),
      SCOPE,
      client,
      replace,
      undefined,
      stopDocument,
    )

    expect(clear).toHaveBeenCalledTimes(1)
    expect(stopDocument).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith("/login")
    expect(stopDocument.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0]!,
    )
  })
})
