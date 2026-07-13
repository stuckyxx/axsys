import { expect, test as base, type Page } from "@playwright/test"

import {
  AdversarialLocalFixture,
  type AdversarialIdentity,
} from "../helpers/adversarial-local-fixture"

type Fixtures = Readonly<{ companyFixture: AdversarialLocalFixture }>

const test = base.extend<Fixtures>({
  companyFixture: async ({}, provide, testInfo) => {
    const fixture = new AdversarialLocalFixture(
      `administrative-proposals-${testInfo.project.name}-${testInfo.workerIndex}`,
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

async function login(page: Page, identity: AdversarialIdentity) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": identity.clientIp })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/u, { timeout: 30_000 })
}

async function createPrerequisites(page: Page) {
  await page.goto("/app/administrativo/clientes")
  if (!/\/app\/administrativo\/clientes$/u.test(page.url())) {
    await page.getByRole("link", { name: "Clientes", exact: true }).click()
  }
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Novo cliente" }).click()
  const client = page.getByRole("dialog", { name: "Novo cliente" })
  await client.getByLabel("Razão social").fill("Secretaria de Tecnologia de Fortaleza")
  await client.getByLabel("CNPJ").fill("04.252.011/0001-10")
  await client.getByLabel("Segmento").fill("Tecnologia Pública")
  await client.getByLabel("Município").fill("Fortaleza")
  await client.getByLabel("UF").fill("CE")
  await client.getByRole("button", { name: "Criar cliente" }).click()
  await expect(page.getByText("Cliente criado.")).toBeVisible()

  await page.goto("/app/administrativo/servicos")
  if (!/\/app\/administrativo\/servicos$/u.test(page.url())) {
    await page.getByRole("link", { name: "Serviços", exact: true }).click()
  }
  await expect(page.getByRole("heading", { name: "Serviços e produtos" })).toBeVisible()
  for (const item of [
    {
      kind: "Serviço",
      name: "Operação assistida",
      description: "Operação mensal especializada para sistemas públicos.",
    },
    {
      kind: "Produto",
      name: "Terminal administrativo",
      description: "Terminal homologado para atendimento administrativo.",
    },
  ]) {
    await page.getByRole("button", { name: "Novo item" }).click()
    const form = page.getByRole("dialog", { name: "Novo item do catálogo" })
    await form.getByLabel(item.kind).check()
    await form.getByLabel("Nome").fill(item.name)
    await form.getByLabel("Segmento").fill("Tecnologia Pública")
    await form.getByLabel("Descrição").fill(item.description)
    await form.getByRole("button", { name: "Criar item" }).click()
    await expect(page.getByText("Item criado.")).toBeVisible()
  }
}

async function openNewProposal(page: Page) {
  await page.goto("/app/administrativo/propostas/nova")
  const heading = page.getByRole("heading", { name: "Nova proposta" })
  if (!(await heading.isVisible().catch(() => false))) {
    await page.getByRole("link", { name: "Propostas", exact: true }).click()
    await page.locator('a:visible[href="/app/administrativo/propostas/nova"]').first().click()
  }
  await expect(heading).toBeVisible()
}

test("creates a mixed proposal, generates its PDF and completes the legal lifecycle", async ({
  page,
  companyFixture,
}) => {
  test.setTimeout(180_000)
  await login(page, companyFixture.adminA)
  await createPrerequisites(page)
  await openNewProposal(page)

  await expect(page.getByRole("heading", { name: "Nova proposta" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel("Segmento").fill("Tecnologia Pública")
  await page.getByLabel("Segmento").press("Tab")
  const clientSelect = page.getByLabel("Cliente", { exact: true })
  await expect(clientSelect.locator("option")).toHaveCount(2)
  await clientSelect.selectOption({
    label: "Secretaria de Tecnologia de Fortaleza",
  })

  await page.getByRole("button", { name: "Adicionar serviço" }).click()
  let rows = page.getByRole("group", { name: /Item/u })
  await rows.nth(0).getByLabel("Item do catálogo").selectOption({ label: "Operação assistida" })
  await rows.nth(0).getByLabel("Meses").fill("2")
  await rows.nth(0).getByLabel("Valor mensal").fill("1500.00")

  await page.getByRole("button", { name: "Adicionar produto" }).click()
  rows = page.getByRole("group", { name: /Item/u })
  await rows.nth(1).getByLabel("Item do catálogo").selectOption({ label: "Terminal administrativo" })
  await rows.nth(1).getByLabel("Quantidade").fill("3")
  await rows.nth(1).getByLabel("Valor unitário").fill("500.00")
  await expect(page.getByText("R$ 4.500,00", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Salvar proposta" }).click()

  await expect(page).toHaveURL(
    /\/app\/administrativo\/propostas\/[0-9a-f-]+$/u,
    { timeout: 30_000 },
  )
  await expect(
    page.getByRole("main").getByText("Total confirmado pelo banco").first(),
  ).toBeVisible()
  await expect(page.getByText("R$ 4.500,00", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Gerar PDF" }).click()
  await expect(page.getByText("Versão 1", { exact: true })).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Baixar versão 1" }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/u)
  await page.getByRole("button", { name: "Enviar proposta" }).click()
  await expect(page.getByText("Enviada", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Aprovar proposta" }).click()
  await expect(page.getByText("Aprovada", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("main").getByRole("link", { name: /contrato/iu }),
  ).toHaveCount(0)
})

test("preserves stale proposal fields and displays the current server version", async ({
  context,
  companyFixture,
}) => {
  test.setTimeout(180_000)
  const first = await context.newPage()
  const second = await context.newPage()
  try {
    await login(first, companyFixture.adminA)
    await createPrerequisites(first)
    await openNewProposal(first)
    await first.getByLabel("Segmento").fill("Tecnologia Pública")
    await first.getByLabel("Segmento").press("Tab")
    const firstClientSelect = first.getByLabel("Cliente", { exact: true })
    await expect(firstClientSelect.locator("option")).toHaveCount(2)
    await firstClientSelect.selectOption({ index: 1 })
    await first.getByRole("button", { name: "Adicionar serviço" }).click()
    const line = first.getByRole("group", { name: /Item/u }).first()
    await line.getByLabel("Item do catálogo").selectOption({ index: 1 })
    await line.getByLabel("Meses").fill("1")
    await line.getByLabel("Valor mensal").fill("1000.00")
    await first.getByRole("button", { name: "Salvar proposta" }).click()
    await expect(first).toHaveURL(/\/app\/administrativo\/propostas\/[0-9a-f-]+$/u, { timeout: 30_000 })
    const url = first.url()
    await second.goto(url)
    await first.getByRole("button", { name: "Editar proposta" }).click()
    await second.getByRole("button", { name: "Editar proposta" }).click()
    await second.getByLabel("Data de emissão").fill("2026-08-01")
    await second.getByRole("button", { name: "Salvar alterações" }).click()
    await expect
      .poll(
        () =>
          second.evaluate(async () => {
            const proposalId = window.location.pathname.split("/").at(-1)
            const response = await fetch(
              `/api/administrative/proposals/${proposalId}`,
              {
                cache: "no-store",
              },
            )
            const body = (await response.json()) as {
              proposal?: { issuedOn?: string }
            }
            return body.proposal?.issuedOn
          }),
        { timeout: 30_000 },
      )
      .toBe("2026-08-01")
    await first.getByLabel("Data de emissão").fill("2026-09-15")
    await first.getByRole("button", { name: "Salvar alterações" }).click()
    const conflict = first.getByRole("region", { name: "Conflito de edição da proposta" })
    await expect(conflict).toContainText("2026-09-15")
    await expect(conflict).toContainText("2026-08-01")
    await expect(first.getByLabel("Data de emissão")).toHaveValue("2026-09-15")
  } finally {
    await first.close()
    await second.close()
  }
})
