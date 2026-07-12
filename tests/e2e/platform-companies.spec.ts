import type { Page } from "@playwright/test"

import { expect, test, type PortalIdentity } from "./routing/local-portal-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

async function login(
  page: Page,
  identity: PortalIdentity,
  destination: "company" | "platform",
) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": identity.clientIp })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(
    destination === "platform" ? /\/platform$/u : /\/app\/dashboard$/u,
  )
}

function visiblePlatformNavigation(page: Page) {
  return page.locator(
    'nav[aria-label="Navegação da plataforma"]:visible, nav[aria-label="Menu móvel da plataforma"]:visible',
  )
}

test.describe("Task 9 separate platform portal", () => {
  test("shows only platform destinations and fresh company data", async ({ page, portalIdentities }) => {
    await login(page, portalIdentities.platform, "platform")
    await expect(page.getByRole("heading", { name: "Visão da plataforma" })).toBeVisible()
    if (await page.getByRole("button", { name: "Abrir menu" }).isVisible()) {
      await page.getByRole("button", { name: "Abrir menu" }).click()
    }
    const navigation = visiblePlatformNavigation(page)
    await expect(navigation).toContainText("Empresas")
    await expect(navigation).not.toContainText("Propostas")

    await page.goto("/platform/empresas")
    await expect(page.getByRole("heading", { name: "Empresas" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Fornecedor Task 15/u }),
    ).toBeVisible()
    await expect(page.locator("body")).not.toContainText(portalIdentities.company.password)
  })

  test("keeps bank plaintext out of the DOM after cancellation", async ({ page, portalIdentities }) => {
    await login(page, portalIdentities.platform, "platform")
    await page.goto("/platform/empresas")
    await page.getByRole("link", { name: /Fornecedor Task 15/u }).click()
    await page.getByRole("button", { name: "Nova conta" }).click()
    await page.getByLabel("Agência").fill("1567")
    await page.getByLabel("Conta", { exact: true }).fill("482901")
    await page.getByRole("button", { name: "Cancelar" }).click()
    await expect(page.locator("body")).not.toContainText("482901")
    await expect(page.locator("body")).not.toContainText("1567")
  })

  test("redirects a company identity without exposing the platform shell", async ({ page, portalIdentities }) => {
    await login(page, portalIdentities.company, "company")
    await page.goto("/platform/empresas")
    await expect(page).toHaveURL(/\/app\/dashboard$/u)
    await expect(page.locator("body")).not.toContainText("Portal da plataforma")
  })
})
