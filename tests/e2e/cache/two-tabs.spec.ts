import {
  expect,
  test as base,
  type Page,
  type Response,
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
      `two-tabs-${testInfo.project.name}-${testInfo.workerIndex}`,
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

async function login(page: Page, identity: AdversarialIdentity): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": identity.clientIp,
  })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  try {
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page).toHaveURL(/\/app\/dashboard$/u, { timeout: 30_000 })
  } finally {
    await page
      .locator("#login-password")
      .evaluateAll((inputs: HTMLInputElement[]) => {
        for (const input of inputs) input.value = ""
      })
      .catch(() => undefined)
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
}

async function getMe(page: Page): Promise<{
  preferredTheme: unknown
  status: number
  version: unknown
}> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const body = (await response.json()) as {
      profile?: { preferredTheme?: unknown; version?: unknown }
    }
    return {
      preferredTheme: body.profile?.preferredTheme,
      status: response.status,
      version: body.profile?.version,
    }
  })
}

type DocumentIdentity = Readonly<{ marker: string | null; timeOrigin: number }>

async function installDocumentIdentity(page: Page): Promise<DocumentIdentity> {
  return page.evaluate(() => {
    const marker = crypto.randomUUID()
    ;(window as Window & { __axsysTask17Document?: string })
      .__axsysTask17Document = marker
    return { marker, timeOrigin: performance.timeOrigin }
  })
}

async function readDocumentIdentity(page: Page): Promise<DocumentIdentity> {
  return page.evaluate(() => ({
    marker:
      (window as Window & { __axsysTask17Document?: string })
        .__axsysTask17Document ?? null,
    timeOrigin: performance.timeOrigin,
  }))
}

async function visibleSensitiveKinds(
  page: Page,
  sensitiveValues: readonly { kind: string; value: string }[],
): Promise<string[]> {
  return page.locator("body").evaluate(
    (body, values) =>
      values
        .filter(({ value }) => body.textContent?.includes(value) === true)
        .map(({ kind }) => kind),
    sensitiveValues,
  )
}

async function isAuthoritativeLightProfileResponse(
  response: Response,
  minimumVersion: number,
): Promise<boolean> {
  if (
    response.request().method() !== "GET" ||
    new URL(response.url()).pathname !== "/api/auth/me" ||
    response.status() !== 200
  ) {
    return false
  }
  try {
    const body = (await response.json()) as {
      profile?: { preferredTheme?: unknown; version?: unknown }
    }
    return (
      body.profile?.preferredTheme === "light" &&
      typeof body.profile.version === "number" &&
      body.profile.version > minimumVersion
    )
  } catch {
    return false
  }
}

test("synchronizes authoritative profile state and revocation across two tabs without reload", async ({
  adversarialFixture,
  context,
  page: firstTab,
}) => {
  test.setTimeout(120_000)
  const identity = adversarialFixture.memberA
  await login(firstTab, identity)
  const secondTab = await context.newPage()
  await secondTab.goto("/app/dashboard")
  await expect(secondTab.getByRole("heading", { name: "Dashboard" })).toBeVisible()

  await expect(firstTab.locator("html")).toHaveClass(/\bdark\b/u)
  await expect(secondTab.locator("html")).toHaveClass(/\bdark\b/u)
  const before = await getMe(secondTab)
  expect(before).toMatchObject({ preferredTheme: "dark", status: 200 })
  expect(typeof before.version).toBe("number")
  if (typeof before.version !== "number") {
    throw new Error("Task 17 initial profile version is invalid")
  }
  const beforeVersion = before.version
  const documentIdentity = await installDocumentIdentity(secondTab)
  const authoritativeRefetch = secondTab.waitForResponse(
    (response) =>
      isAuthoritativeLightProfileResponse(response, beforeVersion),
    { timeout: 20_000 },
  )

  await firstTab.getByRole("button", { name: "Ativar tema claro" }).click()
  await expect(firstTab.locator("html")).toHaveClass(/\blight\b/u, {
    timeout: 20_000,
  })
  await expect(
    firstTab.getByRole("button", { name: "Ativar tema escuro" }),
  ).toBeVisible()
  await authoritativeRefetch

  await expect(secondTab.locator("html")).toHaveClass(/\blight\b/u, {
    timeout: 20_000,
  })
  await expect(
    secondTab.getByRole("button", { name: "Ativar tema escuro" }),
  ).toBeVisible()
  const after = await getMe(secondTab)
  expect(typeof after.version).toBe("number")
  expect(after.version).toBeGreaterThan(beforeVersion)
  expect(await readDocumentIdentity(secondTab)).toEqual(documentIdentity)

  await adversarialFixture.suspendMembership(identity)
  await firstTab.evaluate(() => window.dispatchEvent(new Event("focus")))

  await expect(firstTab).toHaveURL(/\/login$/u)
  await expect(secondTab).toHaveURL(/\/login$/u)
  for (const tab of [firstTab, secondTab]) {
    await expect(
      tab.getByRole("heading", { name: "Acesse sua conta" }),
    ).toBeVisible()
    expect(
      await visibleSensitiveKinds(tab, [
        { kind: "display-name", value: identity.displayName },
        { kind: "email", value: identity.email },
      ]),
    ).toEqual([])
    await expect(
      tab.locator('nav[aria-label="Navegação da empresa"]'),
    ).toHaveCount(0)
    await tab.goto("/app/dashboard")
    await expect(tab).toHaveURL(/\/login$/u)
  }
})
