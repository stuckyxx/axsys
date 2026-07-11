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

  it("returns only frozen channel lifecycle methods from one non-persistent client", async () => {
    stubPublicEnv()
    const rawClient = {
      channel: vi.fn(function (this: object, topic: string) {
        return { owner: this, topic }
      }),
      removeChannel: vi.fn(function (this: object, channel: object) {
        return Promise.resolve({ owner: this, channel })
      }),
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {},
      auth: {},
    }
    createClientMock.mockReturnValue(rawClient)
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ accessToken: "realtime-access-token" }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { getBrowserRealtime } = await import("@/lib/supabase/browser")

    const capability = getBrowserRealtime()
    expect(getBrowserRealtime()).toBe(capability)
    expect(Object.keys(capability).sort()).toEqual(["channel", "removeChannel"])
    expect(Object.isFrozen(capability)).toBe(true)
    expect(capability).not.toHaveProperty("from")
    expect(capability).not.toHaveProperty("rpc")
    expect(capability).not.toHaveProperty("storage")
    expect(capability).not.toHaveProperty("auth")
    expect(capability.channel("updates")).toEqual({
      owner: rawClient,
      topic: "updates",
    })

    expect(createClientMock).toHaveBeenCalledOnce()
    const [url, key, options] = createClientMock.mock.calls[0]
    expect(url).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_URL)
    expect(key).toBe(PUBLIC_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    })
    await expect(options.accessToken()).resolves.toBe("realtime-access-token")
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/realtime-token", {
      credentials: "same-origin",
      cache: "no-store",
    })
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
  })
})
