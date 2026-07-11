import { randomUUID } from "node:crypto"

import type { Page } from "@playwright/test"

import { expect, test } from "./local-platform-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

test.beforeEach(async ({ page, platformIdentity }) => {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": platformIdentity.clientIp,
  })
})

async function focusEmailWithKeyboard(page: Page) {
  await page.keyboard.press("Tab")
  const email = page.getByLabel("E-mail")
  await expect(email).toBeFocused()
}

test.describe("Axsys login", () => {
  test("does not overflow vertically at the 768px breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto("/login")

    const dimensions = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }))
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight)
  })

  test("completes platform login using only the keyboard", async ({
    page,
    platformIdentity,
  }) => {
    await page.goto("/login")
    await focusEmailWithKeyboard(page)
    await page.keyboard.type(platformIdentity.email)
    await page.keyboard.press("Tab")
    const forgotPassword = page.getByRole("link", {
      name: "Esqueci minha senha",
    })
    await expect(forgotPassword).toBeFocused()
    const forgotPasswordBox = await forgotPassword.boundingBox()
    expect(forgotPasswordBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    await page.keyboard.press("Tab")
    await expect(page.getByLabel("Senha")).toBeFocused()
    await page.keyboard.type(platformIdentity.password)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("checkbox", { name: "Manter conectado" })).toBeFocused()
    await page.keyboard.press("Space")
    await page.keyboard.press("Tab")

    const submit = page.getByRole("button", { name: "Entrar" })
    await expect(submit).toBeFocused()
    const submitBox = await submit.boundingBox()
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    await page.keyboard.press("Enter")

    await expect(page).toHaveURL(/\/platform$/u)
  })

  test("shows the same generic invalid-credentials error", async ({
    page,
    platformIdentity,
  }) => {
    const unknownEmail = `unknown-${randomUUID()}@example.test`
    platformIdentity.trackRejectedAccount(unknownEmail)

    await page.goto("/login")
    await focusEmailWithKeyboard(page)
    await page.keyboard.type(unknownEmail)
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await page.keyboard.type("credencial-incorreta")
    await page.keyboard.press("Enter")

    await expect(
      page.getByRole("alert").filter({
        hasText: "E-mail ou senha inválidos.",
      }),
    ).toContainText("E-mail ou senha inválidos.")
    await expect(page).toHaveURL(/\/login$/u)
  })
})
