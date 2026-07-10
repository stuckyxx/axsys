import { expect, test } from "@playwright/test"

test("a raiz redireciona para o login", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})
