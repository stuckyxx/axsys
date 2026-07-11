import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }))

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(20)}`,
} as const

function stubPublicEnv(): void {
  for (const [name, value] of Object.entries(PUBLIC_ENV)) vi.stubEnv(name, value)
}

describe("browser Supabase capability", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("is build-safe and resolves public environment only when requested", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")

    const browser = await import("@/lib/supabase/browser")

    expect(createClientMock).not.toHaveBeenCalled()
    expect(() => browser.getBrowserRealtime()).toThrow()
  })

  it("creates one disposable realtime capability per protected mount", async () => {
    stubPublicEnv()
    const rawClients = ["scope-a", "scope-b"].map((scope) => ({
      scope,
      channel: vi.fn(function (this: object, topic: string) {
        return { owner: this, topic }
      }),
      removeChannel: vi.fn().mockResolvedValue("ok"),
      removeAllChannels: vi.fn().mockResolvedValue([]),
      realtime: {
        setAuth: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      },
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {},
      auth: {},
    }))
    let clientIndex = 0
    createClientMock.mockImplementation(
      (_url: string, _key: string, options: { accessToken: () => Promise<string> }) => {
        const client = rawClients[clientIndex]
        clientIndex += 1
        client.realtime.setAuth.mockImplementation(async () => {
          await options.accessToken()
        })
        return client
      },
    )
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({ accessToken: `realtime-access-token-${fetchMock.mock.calls.length}` }),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { getBrowserRealtime } = await import("@/lib/supabase/browser")

    const first = getBrowserRealtime()
    const second = getBrowserRealtime()
    expect(first).not.toBe(second)
    expect(Object.keys(first).sort()).toEqual([
      "channel",
      "dispose",
      "refreshAuth",
      "removeChannel",
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(first).not.toHaveProperty("from")
    expect(first).not.toHaveProperty("rpc")
    expect(first).not.toHaveProperty("storage")
    expect(first).not.toHaveProperty("auth")
    expect(first).not.toHaveProperty("accessToken")
    expect(first.channel("updates")).toEqual({
      owner: rawClients[0],
      topic: "updates",
    })

    expect(createClientMock).toHaveBeenCalledTimes(2)
    const [url, key, options] = createClientMock.mock.calls[0]
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    })
    await expect(options.accessToken()).resolves.toBe("realtime-access-token-1")
    await expect(options.accessToken()).resolves.toBe("realtime-access-token-2")
    await first.refreshAuth()
    expect(rawClients[0].realtime.setAuth).toHaveBeenCalledWith()
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/auth/realtime-token", {
      credentials: "same-origin",
      cache: "no-store",
    })

    await first.dispose()
    expect(rawClients[0].removeAllChannels).toHaveBeenCalledOnce()
    expect(rawClients[0].realtime.disconnect).toHaveBeenCalledOnce()
    expect(rawClients[1].removeAllChannels).not.toHaveBeenCalled()
  })

  it.each([
    new Response(null, { status: 401 }),
    Response.json({ accessToken: "" }),
    Response.json({ accessToken: "   " }),
    Response.json({ accessToken: " token-with-whitespace " }),
    Response.json({ accessToken: 42 }),
  ])("rejects an unusable realtime token with one generic error", async (response) => {
    stubPublicEnv()
    createClientMock.mockReturnValue({
      channel: vi.fn(),
      removeChannel: vi.fn(),
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
    const { getBrowserRealtime } = await import("@/lib/supabase/browser")
    getBrowserRealtime()
    const options = createClientMock.mock.calls[0][2]

    await expect(options.accessToken()).rejects.toThrow(
      "Realtime authorization failed",
    )
  })

  it("contains no raw browser data, auth, or storage capability", () => {
    const source = readFileSync(resolve("src/lib/supabase/browser.ts"), "utf8")

    expect(source).not.toMatch(/export\s+(?:const|let|var).*SupabaseClient/gu)
    expect(source).not.toContain(".from(")
    expect(source).not.toContain(".rpc(")
    expect(source).not.toContain(".storage")
    expect(source).not.toContain("persistSession: true")
    expect(source).not.toContain("autoRefreshToken: true")
    expect(source).not.toMatch(/let\s+realtime(?:Client|Capability)/u)
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/iu)
  })
})
