import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import {
  AdversarialLocalFixture,
  type AdversarialIdentity,
} from "../../helpers/adversarial-local-fixture"

type AdversarialFixtures = Readonly<{
  adversarialFixture: AdversarialLocalFixture
}>

const test = base.extend<AdversarialFixtures>({
  adversarialFixture: async ({}, provide, testInfo) => {
    const fixture = new AdversarialLocalFixture(
      `cross-tenant-${testInfo.project.name}-${testInfo.workerIndex}`,
    )
    try {
      await fixture.create()
      await provide(fixture)
    } finally {
      await fixture.cleanup()
    }
  },
})

test.use({ trace: "off", screenshot: "off", video: "off" })

class JsonResponseCapture {
  readonly bodies: string[] = []
  private readonly pending: Promise<void>[] = []

  attach(page: Page): void {
    page.on("response", (response) => {
      if (!response.headers()["content-type"]?.includes("application/json")) {
        return
      }
      const reading = response
        .text()
        .then((body) => {
          this.bodies.push(body)
        })
        .catch(() => undefined)
      this.pending.push(reading)
    })
  }

  async text(): Promise<string> {
    await Promise.all(this.pending)
    return this.bodies.join("\n")
  }

  reset(): void {
    this.bodies.length = 0
    this.pending.length = 0
  }
}

function monitorConsole(page: Page, messages: string[]): void {
  page.on("console", (message) => {
    messages.push(`${message.type()}: ${message.text()}`)
  })
  page.on("pageerror", (error) => messages.push(error.message))
}

async function login(page: Page, identity: AdversarialIdentity): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": identity.clientIp,
  })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  try {
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page).toHaveURL(/\/(?:platform|app\/dashboard)$/u, {
      timeout: 30_000,
    })
  } finally {
    await page
      .locator("#login-password")
      .evaluateAll((inputs: HTMLInputElement[]) => {
        for (const input of inputs) input.value = ""
      })
      .catch(() => undefined)
  }
}

async function logout(page: Page): Promise<void> {
  const controlPage = await page.context().newPage()
  try {
    await controlPage.goto("/forgot-password")
    const logoutResponse = controlPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/logout" &&
        response.request().method() === "POST",
    )
    const [response, browserResult] = await Promise.all([
      logoutResponse,
      controlPage.evaluate(async () => {
        const csrfResponse = await fetch("/api/auth/csrf", {
          cache: "no-store",
          credentials: "same-origin",
        })
        const body = (await csrfResponse.json().catch(() => null)) as unknown
        if (
          !csrfResponse.ok ||
          typeof body !== "object" ||
          body === null ||
          !("token" in body) ||
          typeof body.token !== "string"
        ) {
          return { phase: "csrf", status: csrfResponse.status }
        }
        const result = await fetch("/api/auth/logout", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-csrf-token": body.token },
          method: "POST",
        })
        return { phase: "logout", status: result.status }
      }),
    ])
    expect(response.status()).toBe(204)
    expect(browserResult).toEqual({ phase: "logout", status: 204 })
  } finally {
    await controlPage.close()
  }

  let focusError: unknown
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  } catch (error) {
    focusError = error
  }
  try {
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/\/login$/u)
  } catch (error) {
    if (focusError !== undefined) throw focusError
    throw error
  }
  await expect(page).toHaveURL(/\/login$/u, { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible()
}

async function getMe(page: Page, companyId: string): Promise<{
  companyId: unknown
  hasCompanyId: boolean
  hasMembershipId: boolean
  hasRole: boolean
  kind: unknown
  modules: unknown
  status: number
  userId: unknown
}> {
  return page.evaluate(async (tenant) => {
    const response = await fetch(
      `/api/auth/me?companyId=${encodeURIComponent(tenant)}`,
      { cache: "no-store", credentials: "same-origin" },
    )
    const rawBody = (await response.json()) as unknown
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as Record<string, unknown>)
        : {}
    return {
      companyId: body.companyId,
      hasCompanyId: Object.hasOwn(body, "companyId"),
      hasMembershipId: Object.hasOwn(body, "membershipId"),
      hasRole: Object.hasOwn(body, "role"),
      kind: body.kind,
      modules: body.modules,
      status: response.status,
      userId: body.userId,
    }
  }, companyId)
}

function detectedSensitiveKinds(
  haystack: string,
  sensitiveValues: readonly { kind: string; value: string }[],
): string[] {
  return sensitiveValues
    .filter(({ value }) => haystack.includes(value))
    .map(({ kind }) => kind)
}

async function closeLoggedContext(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  try {
    await logout(page)
  } finally {
    await context.close()
  }
}

test("keeps direct tenant and portal attacks neutral across an A to B account switch", async ({
  adversarialFixture,
  browser,
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const identityA = adversarialFixture.memberA
  const identityB = adversarialFixture.adminB
  await login(page, identityA)
  await expect(page).toHaveURL(/\/app\/dashboard$/u)

  const network = new JsonResponseCapture()
  const consoleMessages: string[] = []
  network.attach(page)
  monitorConsole(page, consoleMessages)

  await page.goto(
    `/app/dashboard?companyId=${encodeURIComponent(adversarialFixture.companyBId)}`,
  )
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  const meA = await getMe(page, adversarialFixture.companyBId)
  expect(meA).toMatchObject({
    companyId: adversarialFixture.companyAId,
    hasCompanyId: true,
    hasMembershipId: false,
    hasRole: true,
    kind: "company",
    status: 200,
    userId: identityA.userId,
  })

  const directTenantResponse = await page.goto(
    `/app/${encodeURIComponent(adversarialFixture.companyBId)}/dashboard`,
  )
  expect(directTenantResponse?.status()).toBe(404)
  expect(
    detectedSensitiveKinds(await page.locator("body").innerText(), [
      { kind: "company-name", value: adversarialFixture.companyBName },
    ]),
  ).toEqual([])
  await page.goto(
    `/platform?companyId=${encodeURIComponent(adversarialFixture.companyBId)}`,
  )
  await expect(page).toHaveURL(/\/app\/dashboard$/u)

  const sensitiveB = [
    { kind: "company-id", value: adversarialFixture.companyBId },
    { kind: "company-name", value: adversarialFixture.companyBName },
    { kind: "user-id", value: identityB.userId },
    { kind: "display-name", value: identityB.displayName },
    { kind: "email", value: identityB.email },
  ] as const
  expect(
    detectedSensitiveKinds(await page.locator("body").innerText(), sensitiveB),
  ).toEqual([])
  expect(detectedSensitiveKinds(await network.text(), sensitiveB)).toEqual([])
  expect(detectedSensitiveKinds(consoleMessages.join("\n"), sensitiveB)).toEqual([])

  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== "string") {
    throw new Error("Task 17 Playwright base URL is unavailable")
  }
  const platformContext = await browser.newContext({ baseURL })
  const platformPage = await platformContext.newPage()
  await login(platformPage, adversarialFixture.platform)
  await expect(platformPage).toHaveURL(/\/platform$/u)
  await platformPage.goto(
    `/app/dashboard?companyId=${encodeURIComponent(adversarialFixture.companyAId)}`,
  )
  await expect(platformPage).toHaveURL(/\/platform$/u)
  const platformMe = await getMe(platformPage, adversarialFixture.companyAId)
  expect(platformMe).toMatchObject({
    hasCompanyId: false,
    hasMembershipId: false,
    hasRole: false,
    kind: "platform",
    modules: [],
    status: 200,
    userId: adversarialFixture.platform.userId,
  })
  await closeLoggedContext(platformContext, platformPage)

  await logout(page)
  network.reset()
  consoleMessages.length = 0
  await login(page, identityB)
  await expect(page).toHaveURL(/\/app\/dashboard$/u)
  await page.goto(
    `/app/dashboard?companyId=${encodeURIComponent(adversarialFixture.companyAId)}`,
  )
  const meB = await getMe(page, adversarialFixture.companyAId)
  expect(meB).toMatchObject({
    companyId: adversarialFixture.companyBId,
    hasCompanyId: true,
    hasMembershipId: false,
    hasRole: true,
    kind: "company",
    status: 200,
    userId: identityB.userId,
  })

  const sensitiveA = [
    { kind: "company-id", value: adversarialFixture.companyAId },
    { kind: "company-name", value: adversarialFixture.companyAName },
    { kind: "user-id", value: identityA.userId },
    { kind: "display-name", value: identityA.displayName },
    { kind: "email", value: identityA.email },
  ] as const
  expect(
    detectedSensitiveKinds(await page.locator("body").innerText(), sensitiveA),
  ).toEqual([])
  expect(detectedSensitiveKinds(await network.text(), sensitiveA)).toEqual([])
  expect(detectedSensitiveKinds(consoleMessages.join("\n"), sensitiveA)).toEqual([])
  await logout(page)
})
