import { expect, test } from "./local-password-recovery-fixture"

test.use({ trace: "off", screenshot: "off", video: "off" })

test.beforeEach(async ({ page, passwordRecoveryIdentity }) => {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": passwordRecoveryIdentity.clientIp,
  })
})

test("recovers a platform password once through real email and rejects replay", async ({
  page,
  passwordRecoveryIdentity,
}) => {
  test.setTimeout(60_000)

  await page.goto("/login")
  await page.getByRole("link", { name: "Esqueci minha senha" }).click()
  await expect(page).toHaveURL(/\/forgot-password$/u)
  await expect(
    page.getByRole("heading", { name: "Recupere seu acesso" }),
  ).toBeVisible()

  await page.getByLabel("E-mail").fill(passwordRecoveryIdentity.email)
  await page.getByRole("button", { name: "Enviar instruções" }).click()
  await expect(page.getByRole("status")).toContainText(
    "Se o e-mail estiver cadastrado, enviaremos as instruções.",
  )

  await expect
    .poll(() => passwordRecoveryIdentity.latestRecoveryLink(), {
      timeout: 15_000,
    })
    .not.toBeNull()
  const recoveryLink = await passwordRecoveryIdentity.latestRecoveryLink()
  if (!recoveryLink) throw new Error("Task 13 E2E recovery link unavailable")

  await page.goto(recoveryLink)
  await expect(page).toHaveURL(/\/reset-password$/u)
  await expect(
    page.getByRole("heading", { name: "Defina uma nova senha" }),
  ).toBeVisible()

  await page
    .getByLabel("Nova senha", { exact: true })
    .fill(passwordRecoveryIdentity.newPassword)
  await page
    .getByLabel("Confirmar nova senha")
    .fill(passwordRecoveryIdentity.newPassword)
  await page.getByRole("button", { name: "Salvar nova senha" }).click()
  await expect(page).toHaveURL(/\/login$/u)

  await expect
    .poll(() => passwordRecoveryIdentity.recoveryState())
    .toEqual({
      operationStatus: "completed",
      grantUnusable: true,
      auditCount: 2,
    })

  await page.getByLabel("E-mail").fill(passwordRecoveryIdentity.email)
  await page.getByLabel("Senha").fill(passwordRecoveryIdentity.oldPassword)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos." }),
  ).toContainText("E-mail ou senha inválidos.")
  await expect(page).toHaveURL(/\/login$/u)

  await page.getByLabel("Senha").fill(passwordRecoveryIdentity.newPassword)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/\/platform$/u)
  await expect(
    page.getByRole("heading", { name: "Visão geral da plataforma" }),
  ).toBeVisible()

  const context = page.context()
  await context.clearCookies()
  await page.close()
  const replayPage = await context.newPage()
  await replayPage.goto(recoveryLink)
  await expect(replayPage).toHaveURL((url) => {
    return (
      url.pathname === "/login" &&
      url.searchParams.get("recovery") === "invalid" &&
      url.hash.includes("error_code=otp_expired")
    )
  })
  await expect(
    replayPage.getByRole("heading", { name: "Acesse sua conta" }),
  ).toBeVisible()
})
