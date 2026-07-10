import { defineConfig, devices } from "@playwright/test"

const isCI = Boolean(process.env.CI)
const port = Number(process.env.PLAYWRIGHT_PORT || 3100)
const baseURL = `http://127.0.0.1:${port}`
const reuseExistingServer =
  !isCI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  failOnFlakyTests: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    // Use a stable static 200 for readiness, independent of login route content.
    url: `${baseURL}/favicon.ico`,
    reuseExistingServer,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
})
