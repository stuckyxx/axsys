import { expect, test } from "@playwright/test"

test("a raiz redireciona para o login", async ({ baseURL, page, request }) => {
  if (!baseURL) {
    throw new Error("Playwright baseURL must be configured")
  }

  const response = await request.get("/", { maxRedirects: 0 })

  expect(response.status()).toBe(307)
  expect(response.headers().location).toBe("/login")

  await page.goto("/")
  await expect(page).toHaveURL(`${baseURL}/login`)
})
