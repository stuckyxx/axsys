import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type PlaywrightConfigShape = {
  failOnFlakyTests?: boolean
  retries?: number
  use?: { baseURL?: string }
  webServer?: {
    command?: string
    env?: Record<string, string>
    gracefulShutdown?: { signal: string; timeout: number }
    reuseExistingServer?: boolean
    url?: string
  }
  workers?: number
}

async function loadPlaywrightConfig() {
  vi.resetModules()
  const loadedModule = await import("../../../playwright.config")
  return loadedModule.default as PlaywrightConfigShape
}

describe("Playwright server isolation", () => {
  beforeEach(() => {
    vi.stubEnv("CI", "")
    vi.stubEnv("PLAYWRIGHT_PORT", "")
    vi.stubEnv("PLAYWRIGHT_REUSE_EXISTING_SERVER", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("binds an owned server to the dedicated default port", async () => {
    const config = await loadPlaywrightConfig()

    expect(config.use?.baseURL).toBe("http://127.0.0.1:3000")
    expect(config.webServer).toMatchObject({
      command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
      env: { APP_ORIGIN: "http://127.0.0.1:3000" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: false,
      url: "http://127.0.0.1:3000/favicon.ico",
    })
    expect(config.failOnFlakyTests).toBe(false)
  })

  it("derives URLs and command from the configured port with explicit local reuse", async () => {
    vi.stubEnv("PLAYWRIGHT_PORT", "3201")
    vi.stubEnv("PLAYWRIGHT_REUSE_EXISTING_SERVER", "1")

    const config = await loadPlaywrightConfig()

    expect(config.use?.baseURL).toBe("http://127.0.0.1:3201")
    expect(config.webServer).toMatchObject({
      command: "npm run dev -- --hostname 127.0.0.1 --port 3201",
      env: { APP_ORIGIN: "http://127.0.0.1:3201" },
      reuseExistingServer: true,
      url: "http://127.0.0.1:3201/favicon.ico",
    })
  })

  it("never reuses a server in CI and fails on flaky tests", async () => {
    vi.stubEnv("CI", "1")
    vi.stubEnv("PLAYWRIGHT_REUSE_EXISTING_SERVER", "1")

    const config = await loadPlaywrightConfig()

    expect(config.webServer).toMatchObject({ reuseExistingServer: false })
    expect(config.failOnFlakyTests).toBe(true)
    expect(config.retries).toBe(2)
    expect(config.workers).toBe(1)
  })
})
