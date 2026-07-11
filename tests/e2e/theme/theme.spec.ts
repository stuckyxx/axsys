import type { Page } from "@playwright/test"

import {
  expect,
  monitorPageConsole,
  test,
  type PortalIdentity,
} from "../routing/local-portal-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

type ApiResult = Readonly<{
  body: unknown
  cacheControl: string | null
  status: number
}>

async function login(page: Page, identity: PortalIdentity): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": identity.clientIp,
  })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
}

async function getMe(page: Page): Promise<ApiResult> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
    return {
      body: (await response.json()) as unknown,
      cacheControl: response.headers.get("cache-control"),
      status: response.status,
    }
  })
}

async function patchTheme(
  page: Page,
  theme: "dark" | "light",
  version: number,
): Promise<ApiResult> {
  const csrfBody = await page.evaluate(async () => {
    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    })
    return {
      body: (await response.json()) as unknown,
      ok: response.ok,
    }
  })
  if (
    !csrfBody.ok ||
    typeof csrfBody.body !== "object" ||
    csrfBody.body === null ||
    !("token" in csrfBody.body) ||
    typeof csrfBody.body.token !== "string"
  ) {
    throw new Error("Theme E2E CSRF unavailable")
  }

  const cookieHeader = (await page.context().cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ")
  const response = await page.context().request.patch("/api/profile/theme", {
    data: { theme, version },
    headers: {
      cookie: cookieHeader,
      origin: new URL(page.url()).origin,
      "x-csrf-token": csrfBody.body.token,
    },
  })

  return {
    body: (await response.json()) as unknown,
    cacheControl: response.headers()["cache-control"] ?? null,
    status: response.status(),
  }
}

function profileVersion(result: ApiResult): number {
  if (
    result.status !== 200 ||
    typeof result.body !== "object" ||
    result.body === null ||
    !("profile" in result.body) ||
    typeof result.body.profile !== "object" ||
    result.body.profile === null ||
    !("version" in result.body.profile) ||
    typeof result.body.profile.version !== "number"
  ) {
    throw new Error("Theme E2E profile unavailable")
  }
  return result.body.profile.version
}

test("persists an authoritative theme per user with conflict and protected CSP proof", async ({
  browser,
  page,
  portalIdentities,
}, testInfo) => {
  const platformKey = `axsys-theme:${portalIdentities.platform.userId}`
  await page.addInitScript((key) => {
    localStorage.setItem(key, "light")
  }, platformKey)
  await login(page, portalIdentities.platform)
  await expect(page).toHaveURL(/\/platform$/u)

  await expect(page.locator("html")).toHaveClass(/\bdark\b/u)
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), platformKey))
    .toBe("dark")
  const before = await getMe(page)
  expect(before.status).toBe(200)
  expect(before.cacheControl).toContain("no-store")
  const staleVersion = profileVersion(before)

  await page.getByRole("button", { name: "Ativar tema claro" }).click()
  await expect(page.locator("html")).toHaveClass(/\blight\b/u)
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), platformKey))
    .toBe("light")
  const persisted = await getMe(page)
  expect(persisted.body).toMatchObject({
    profile: { preferredTheme: "light" },
  })

  const stale = await patchTheme(page, "dark", staleVersion)
  expect(stale.status, JSON.stringify(stale.body)).toBe(409)
  expect(stale.cacheControl).toContain("no-store")
  expect(stale.body).toMatchObject({
    error: { code: "VERSION_CONFLICT" },
    current: {
      preferredTheme: "light",
      version: profileVersion(persisted),
    },
  })

  const secondTab = await page.context().newPage()
  const protectedResponse = await secondTab.goto("/platform")
  await expect(secondTab.locator("html")).toHaveClass(/\blight\b/u)

  expect(protectedResponse).not.toBeNull()
  const csp = protectedResponse?.headers()["content-security-policy"] ?? ""
  const nonce = csp.match(/'nonce-([^']+)'/u)?.[1]
  expect(nonce).toMatch(/^[A-Za-z0-9+/_=-]{1,128}$/u)
  const executableScripts = await secondTab.evaluate(() =>
    Array.from(document.scripts)
      .filter((script) =>
        ["", "application/javascript", "module", "text/javascript"].includes(
          script.type.trim().toLowerCase(),
        ),
      )
      .map((script) => ({
        nonce: script.nonce,
        source: script.src.length > 0 ? script.src : "inline",
        text: script.src.length > 0 ? "" : (script.textContent ?? ""),
      })),
  )
  expect(executableScripts.length).toBeGreaterThan(0)
  const themeBootstrap = executableScripts.find(
    (script) =>
      script.source === "inline" && script.text.includes(platformKey),
  )
  expect(themeBootstrap, "next-themes bootstrap must be present").toBeDefined()
  expect(themeBootstrap?.nonce).toBe(nonce)
  expect(
    executableScripts
      .filter(
        (script) =>
          script.source === "inline" &&
          script.text.trim().length > 0 &&
          script.nonce !== nonce,
      )
      .map((script) => script.text.slice(0, 80)),
    "every executable inline script must carry the request nonce",
  ).toEqual([])

  if (!csp.includes("'unsafe-eval'")) {
    expect(
      executableScripts
        .filter(
          (script) =>
            (script.source !== "inline" || script.text.trim().length > 0) &&
            script.nonce !== nonce,
        )
        .map((script) => script.source),
      "production must nonce every executable script",
    ).toEqual([])
  }

  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== "string") throw new Error("Theme E2E base URL unavailable")
  const companyContext = await browser.newContext({ baseURL })
  const companyProblems: string[] = []
  try {
    const companyPage = await companyContext.newPage()
    monitorPageConsole(companyPage, companyProblems)
    await login(companyPage, portalIdentities.company)
    await expect(companyPage).toHaveURL(/\/app\/dashboard$/u)
    await expect(companyPage.locator("html")).toHaveClass(/\bdark\b/u)
    await expect
      .poll(() =>
        companyPage.evaluate(
          ({ companyKey, otherKey }) => ({
            company: localStorage.getItem(companyKey),
            platform: localStorage.getItem(otherKey),
          }),
          {
            companyKey: `axsys-theme:${portalIdentities.company.userId}`,
            otherKey: platformKey,
          },
        ),
      )
      .toEqual({ company: "dark", platform: null })
    expect(companyProblems).toEqual([])
  } finally {
    await companyContext.close()
  }
})
