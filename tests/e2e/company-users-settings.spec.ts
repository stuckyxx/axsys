import { randomBytes, randomUUID } from "node:crypto"

import { expect, test as base, type BrowserContext, type Page } from "@playwright/test"

import {
  AdversarialLocalFixture,
  type AdversarialIdentity,
} from "../helpers/adversarial-local-fixture"
import { createUniqueLocalFixtureClientIp } from "./auth/local-platform-ip"

type Fixtures = Readonly<{
  companyFixture: AdversarialLocalFixture
}>

const test = base.extend<Fixtures>({
  companyFixture: async ({}, provide, testInfo) => {
    const fixture = new AdversarialLocalFixture(
      `company-users-${testInfo.project.name}-${testInfo.workerIndex}`,
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
  const destination = identity.companyId === null ? /\/platform$/u : /\/app\/dashboard$/u
  if (destination.test(page.url())) return
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(destination)
}

async function authenticatedPage(
  context: BrowserContext,
  identity: AdversarialIdentity,
): Promise<Page> {
  const page = await context.newPage()
  await login(page, identity)
  return page
}

function visibleCompanyNavigation(page: Page) {
  return page.locator('nav[aria-label="Navegação da empresa"]:visible, nav[aria-label="Menu móvel da empresa"]:visible')
}

type PlatformAdmin = Readonly<{
  displayName: string
  membershipId: string
  modules: readonly ("administrative" | "financial" | "certificates")[]
  role: "company_admin"
  status: "active" | "suspended"
  version: number
}>

async function readPlatformAdmin(
  page: Page,
  fixture: AdversarialLocalFixture,
): Promise<PlatformAdmin> {
  const result = await page.evaluate(async (companyId) => {
    const response = await fetch(`/api/platform/companies/${companyId}/admins`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    return {
      body: await response.json() as { items: PlatformAdmin[] },
      status: response.status,
    }
  }, fixture.companyAId)
  expect(result.status).toBe(200)
  const body = result.body
  const admin = body.items.find(
    ({ membershipId }) => membershipId === fixture.adminA.membershipId,
  )
  if (!admin) throw new Error("Task 10 platform admin fixture is unavailable")
  return admin
}

async function patchPlatformAdmin(
  page: Page,
  admin: PlatformAdmin,
  patch: Partial<Pick<PlatformAdmin, "modules" | "status">> & {
    suspensionReason?: string | null
  },
): Promise<{ body: { error?: { message?: string } }; status: number }> {
  return page.evaluate(async ({ admin, patch }) => {
    const csrfResponse = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const csrfBody = await csrfResponse.json() as { token: string }
    const response = await fetch(`/api/platform/admins/${admin.membershipId}`, {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfBody.token,
      },
      body: JSON.stringify({
        displayName: admin.displayName,
        role: admin.role,
        modules: patch.modules ?? admin.modules,
        status: patch.status ?? admin.status,
        suspensionReason: patch.suspensionReason ?? null,
        version: admin.version,
      }),
    })
    return {
      body: await response.json() as { error?: { message?: string } },
      status: response.status,
    }
  }, { admin, patch })
}

async function removeAdminOperationalModules(
  context: BrowserContext,
  fixture: AdversarialLocalFixture,
): Promise<void> {
  const platformPage = await authenticatedPage(context, fixture.platform)
  try {
    const admin = await readPlatformAdmin(platformPage, fixture)
    const updated = await patchPlatformAdmin(platformPage, admin, { modules: [] })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)
  } finally {
    await platformPage.close()
  }
}

test("admin without modules creates Finance member, changes it to Certificates, and preserves the last admin", async ({
  browser,
  companyFixture,
}) => {
  test.setTimeout(120_000)
  const adminContext = await browser.newContext()
  const memberContext = await browser.newContext()
  const platformContext = await browser.newContext()
  try {
    await removeAdminOperationalModules(platformContext, companyFixture)
    const adminPage = await authenticatedPage(adminContext, companyFixture.adminA)

    await adminPage.goto("/app/usuarios")
    await expect(
      adminPage.getByRole("heading", { name: "Usuários da empresa" }),
    ).toBeVisible()
    if (await adminPage.getByRole("button", { name: "Abrir menu" }).isVisible()) {
      await adminPage.getByRole("button", { name: "Abrir menu" }).click()
    }
    const adminNavigation = visibleCompanyNavigation(adminPage)
    await expect(adminNavigation.getByRole("link", { name: "Usuários" })).toBeVisible()
    await expect(
      adminNavigation.getByRole("link", { name: "Configurações" }),
    ).toBeVisible()
    await expect(adminNavigation.getByRole("link", { name: "Administrativo" })).toHaveCount(0)
    await expect(adminNavigation.getByRole("link", { name: "Financeiro" })).toHaveCount(0)
    await expect(adminNavigation.getByRole("link", { name: "Certidões" })).toHaveCount(0)
    if (await adminPage.getByRole("dialog").isVisible()) {
      await adminPage.keyboard.press("Escape")
    }

    const memberEmail = `task10-${randomUUID()}@example.test`
    const temporaryPassword = `Axsys-${randomBytes(24).toString("base64url")}!8a`
    const permanentPassword = `Definitiva-${randomBytes(24).toString("base64url")}!9b`
    await adminPage.getByRole("button", { name: "Novo acesso" }).click()
    const createDialog = adminPage.getByRole("dialog", { name: "Novo acesso" })
    await createDialog.getByLabel("Nome completo").fill("Membro Financeiro Task 10")
    await createDialog.getByLabel("E-mail").fill(memberEmail)
    await createDialog.getByLabel("Senha", { exact: true }).fill(temporaryPassword)
    await createDialog.getByLabel("Confirmação").fill(temporaryPassword)
    await createDialog.getByLabel("Financeiro").check()
    await createDialog.getByRole("button", { name: "Criar acesso" }).click()
    await expect(createDialog).toBeHidden()

    const provisioned = await companyFixture.adoptProvisionedCompanyIdentity({
      clientIp: createUniqueLocalFixtureClientIp(),
      email: memberEmail,
      password: permanentPassword,
    })
    const memberPage = await memberContext.newPage()
    await memberPage.context().setExtraHTTPHeaders({
      "x-forwarded-for": provisioned.clientIp,
    })
    await memberPage.goto("/login")
    await memberPage.getByLabel("E-mail").fill(memberEmail)
    await memberPage.getByLabel("Senha").fill(temporaryPassword)
    await memberPage.getByRole("button", { name: "Entrar" }).click()
    await expect(memberPage).toHaveURL(/\/change-password$/u)
    await memberPage.getByLabel("Nova senha", { exact: true }).fill(permanentPassword)
    await memberPage.getByLabel("Confirmar nova senha").fill(permanentPassword)
    await memberPage.getByRole("button", { name: "Salvar nova senha" }).click()
    await expect(memberPage).toHaveURL(/\/login$/u)
    await login(memberPage, provisioned)
    if (await memberPage.getByRole("button", { name: "Abrir menu" }).isVisible()) {
      await memberPage.getByRole("button", { name: "Abrir menu" }).click()
    }
    await expect(
      visibleCompanyNavigation(memberPage).getByRole("link", { name: "Financeiro" }),
    ).toBeVisible()

    const memberEntry = adminPage.locator("article:visible, tr:visible").filter({
      hasText: memberEmail,
    })
    await expect(memberEntry).toBeVisible()
    await memberEntry.getByRole("button", { name: "Editar acesso" }).click()
    const editDialog = adminPage.getByRole("dialog", { name: "Editar acesso" })
    await editDialog.getByLabel("Administrativo").uncheck()
    await editDialog.getByLabel("Financeiro").uncheck()
    await editDialog.getByLabel("Certidões").check()
    await editDialog.getByRole("button", { name: "Salvar alterações" }).click()
    await expect(editDialog).toBeHidden()

    if (await memberPage.getByRole("button", { name: "Abrir menu" }).isVisible()) {
      await memberPage.getByRole("button", { name: "Abrir menu" }).click()
    }
    const memberNavigation = visibleCompanyNavigation(memberPage)
    await expect(memberNavigation.getByRole("link", { name: "Certidões" })).toBeVisible({
      timeout: 20_000,
    })
    await expect(memberNavigation.getByRole("link", { name: "Financeiro" })).toHaveCount(0)
    await expect(memberNavigation.getByRole("link", { name: "Administrativo" })).toHaveCount(0)
    await expect(memberNavigation.getByRole("link", { name: "Usuários" })).toHaveCount(0)
    await expect(memberNavigation.getByRole("link", { name: "Configurações" })).toHaveCount(0)

    const platformPage = await authenticatedPage(platformContext, companyFixture.platform)
    const soleAdmin = await readPlatformAdmin(platformPage, companyFixture)
    const lastAdminAttempt = await patchPlatformAdmin(platformPage, soleAdmin, {
      status: "suspended",
      suspensionReason: "Validação normativa do último administrador ativo.",
    })
    expect(lastAdminAttempt.status).toBe(409)
    expect(lastAdminAttempt.body.error?.message).toBe(
      "A empresa precisa manter ao menos um administrador ativo.",
    )
  } finally {
    await adminContext.close()
    await memberContext.close()
    await platformContext.close()
  }
})

test("common member receives a neutral forbidden response for direct user management", async ({
  page,
  companyFixture,
}) => {
  await login(page, companyFixture.memberA)

  const response = await page.goto("/app/usuarios")

  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole("heading", {
      name: "Você não tem permissão para acessar esta área.",
    }),
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "Usuários da empresa" })).toHaveCount(0)
  const apiResult = await page.evaluate(async () => {
    const response = await fetch("/api/company/users", {
      cache: "no-store",
      credentials: "same-origin",
    })
    return { status: response.status }
  })
  expect(apiResult.status).toBe(403)
})

test("mobile admin navigation exposes management independently from operational modules", async ({
  browser,
  page,
  companyFixture,
}) => {
  const platformContext = await browser.newContext()
  await removeAdminOperationalModules(platformContext, companyFixture)
  await platformContext.close()
  await page.setViewportSize({ width: 390, height: 640 })
  await login(page, companyFixture.adminA)
  await page.getByRole("button", { name: "Abrir menu" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  const navigation = dialog.getByRole("navigation", {
    name: "Menu móvel da empresa",
  })
  await expect(navigation.getByRole("link", { name: "Usuários" })).toBeVisible()
  await expect(
    navigation.getByRole("link", { name: "Configurações" }),
  ).toBeVisible()
  const touchTargets = [
    navigation.getByRole("link", { name: "Usuários" }),
    navigation.getByRole("link", { name: "Configurações" }),
    dialog.getByRole("button", { name: "Fechar menu" }),
  ]
  for (const target of touchTargets) {
    const box = await target.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    expect(box?.width).toBeGreaterThanOrEqual(44)
  }
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused()
})

test("password reset remains scrollable and its footer reachable at 200% zoom", async ({
  page,
  companyFixture,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await login(page, companyFixture.adminA)
  await page.goto("/app/usuarios")
  const memberCard = page.locator("article:visible").filter({
    hasText: companyFixture.memberA.email,
  })
  await memberCard.getByRole("button", { name: "Redefinir senha" }).click()
  const dialog = page.getByRole("dialog", { name: "Redefinir senha" })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%"
  })

  const submit = dialog.getByRole("button", { name: "Redefinir senha" })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeVisible()
  await expect(submit).toBeInViewport()
  const box = await submit.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
})
