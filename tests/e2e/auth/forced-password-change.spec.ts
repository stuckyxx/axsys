import { expect, test } from "./local-forced-password-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

test.beforeEach(async ({ page, forcedPasswordIdentity }) => {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": forcedPasswordIdentity.clientIp,
  })
})

test("forces password change before any company route and signs out afterward", async ({
  page,
  forcedPasswordIdentity,
}) => {
  test.setTimeout(45_000)
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(forcedPasswordIdentity.email)
  await page.getByLabel("Senha").fill(forcedPasswordIdentity.temporaryPassword)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/\/change-password$/u)

  await page.goto("/app/dashboard")
  await expect(page).toHaveURL(/\/change-password$/u)
  await expect(
    page.getByRole("heading", { name: "Crie sua senha definitiva" }),
  ).toBeVisible()

  await page
    .getByLabel("Nova senha", { exact: true })
    .fill(forcedPasswordIdentity.permanentPassword)
  await page
    .getByLabel("Confirmar nova senha")
    .fill(forcedPasswordIdentity.permanentPassword)
  await page.getByRole("button", { name: "Salvar nova senha" }).click()
  await expect(page).toHaveURL(/\/login$/u)

  await page.getByLabel("E-mail").fill(forcedPasswordIdentity.email)
  await page.getByLabel("Senha").fill(forcedPasswordIdentity.temporaryPassword)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos." }),
  ).toContainText("E-mail ou senha inválidos.")
  await expect(page).toHaveURL(/\/login$/u)

  await page.getByLabel("Senha").fill(forcedPasswordIdentity.permanentPassword)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/u)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
})
