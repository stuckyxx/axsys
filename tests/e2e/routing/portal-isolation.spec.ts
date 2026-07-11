import type { Page } from "@playwright/test"

import {
  expect,
  test,
  type PortalIdentity,
} from "./local-portal-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

async function login(page: Page, identity: PortalIdentity): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": identity.clientIp,
  })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
}

test.describe("Task 15 portal isolation", () => {
  test("redirects anonymous direct URLs to the single login", async ({ page }) => {
    await page.goto("/platform")
    await expect(page).toHaveURL(/\/login$/u)

    await page.goto("/app/dashboard")
    await expect(page).toHaveURL(/\/login$/u)
  })

  test("keeps the platform identity in its separate restricted portal", async ({
    page,
    portalIdentities,
  }) => {
    await login(page, portalIdentities.platform)

    await expect(page).toHaveURL(/\/platform$/u)
    await expect(
      page.getByRole("heading", { name: "Visão geral da plataforma" }),
    ).toBeVisible()
    await expect(page.getByText("Portal da plataforma")).toBeVisible()
    await expect(
      page.locator('nav[aria-label="Navegação da plataforma"]'),
    ).toContainText("Empresas")
    await expect(page.locator("body")).not.toContainText("Financeiro")

    await page.goto("/app/dashboard")
    await expect(page).toHaveURL(/\/platform$/u)
    await expect(page.locator("body")).not.toContainText(
      portalIdentities.company.email,
    )
  })

  test("routes a forced-password session away from both direct portals", async ({
    page,
    portalIdentities,
  }) => {
    await login(page, portalIdentities.forcedPassword)
    await expect(page).toHaveURL(/\/change-password$/u)

    await page.goto("/platform")
    await expect(page).toHaveURL(/\/change-password$/u)
    await page.goto("/app/dashboard")
    await expect(page).toHaveURL(/\/change-password$/u)
  })

  test("keeps the company identity and DB-derived modules out of platform", async ({
    page,
    portalIdentities,
  }) => {
    await login(page, portalIdentities.company)

    await expect(page).toHaveURL(/\/app\/dashboard$/u)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    const companyNavigation = page.locator(
      'nav[aria-label="Navegação da empresa"]',
    )
    await expect(companyNavigation).toContainText("Administrativo")
    await expect(companyNavigation).toContainText("Financeiro")
    await expect(companyNavigation).toContainText("Certidões")
    await expect(page.locator("body")).not.toContainText("Portal da plataforma")

    await page.goto("/platform")
    await expect(page).toHaveURL(/\/app\/dashboard$/u)
    await expect(page.locator("body")).not.toContainText(
      portalIdentities.platform.email,
    )
  })

  test("keeps every company destination reachable in a short mobile viewport", async ({
    page,
    portalIdentities,
  }) => {
    await page.setViewportSize({ width: 568, height: 320 })
    await login(page, portalIdentities.company)
    await expect(page).toHaveURL(/\/app\/dashboard$/u)

    const trigger = page.getByRole("button", { name: "Abrir menu" })
    await trigger.click()
    const dialog = page.getByRole("dialog")
    const navigation = dialog.getByRole("navigation", {
      name: "Menu móvel da empresa",
    })
    await expect(dialog).toBeVisible()
    await expect(navigation).toHaveCSS("overflow-y", "auto")

    const companyLink = navigation.getByRole("link", { name: "Empresa" })
    await companyLink.scrollIntoViewIfNeeded()
    await expect(companyLink).toBeVisible()
    const box = await dialog.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(320)

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
