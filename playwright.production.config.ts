import { defineConfig, devices } from "@playwright/test"

const isCI = Boolean(process.env.CI)
const port = Number(process.env.PLAYWRIGHT_PRODUCTION_PORT || 3200)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "**/security/foundation-production.spec.ts",
    "**/theme/theme.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: isCI,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-production",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/favicon.ico`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
    env: {
      APP_ORIGIN: baseURL,
      TRUST_PROXY: "true",
    },
  },
})
