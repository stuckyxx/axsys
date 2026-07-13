import { expect, test as base, type Page } from "@playwright/test"

import {
  AdversarialLocalFixture,
  type AdversarialIdentity,
} from "../helpers/adversarial-local-fixture"

type Fixtures = Readonly<{ companyFixture: AdversarialLocalFixture }>

const test = base.extend<Fixtures>({
  companyFixture: async ({}, provide, testInfo) => {
    const fixture = new AdversarialLocalFixture(
      `administrative-clients-${testInfo.project.name}-${testInfo.workerIndex}`,
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
  if (/\/app\/dashboard$/u.test(page.url())) return
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/u)
}

async function toggleArchivedFilter(page: Page, label: "Mostrar arquivados" | "Mostrar ativos") {
  const inline = page.locator("button:visible", { hasText: label })
  if (await inline.count()) {
    await inline.click()
    return
  }
  await page.getByRole("button", { name: "Filtros", exact: true }).click()
  const filters = page.getByRole("dialog", { name: "Filtrar clientes" })
  await filters.getByRole("button", { name: label }).click()
  await filters.getByRole("button", { name: "Aplicar filtros" }).click()
}

test("creates, filters, edits, archives and restores a client responsively", async ({
  page,
  companyFixture,
}) => {
  test.setTimeout(120_000)
  await login(page, companyFixture.adminA)
  await page.goto("/app/administrativo/clientes")

  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole("button", { name: "Novo cliente" }).click()
  const form = page.getByRole("dialog", { name: "Novo cliente" })
  await form.getByLabel("Razão social").fill("Município de Horizonte")
  await form.getByLabel("Nome fantasia").fill("Prefeitura de Horizonte")
  await form.getByLabel("CNPJ").fill("04.252.011/0001-10")
  await form.getByLabel("Segmento").fill("Prefeituras")
  await form.getByLabel("E-mail").fill("compras@horizonte.example")
  await form.getByLabel("Município").fill("Horizonte")
  await form.getByLabel("UF").fill("CE")
  await form.getByRole("button", { name: "Criar cliente" }).click()

  await expect(page.getByText("Cliente criado.")).toBeVisible()
  await page.getByLabel("Buscar clientes").fill("Município")
  await expect(
    page.locator("a:visible", { hasText: "Município de Horizonte" }),
  ).toBeVisible()

  await page.locator("a:visible", { hasText: "Município de Horizonte" }).click()
  await expect(page.getByRole("heading", { name: "Resumo de vínculos" })).toBeVisible()
  await page.getByRole("link", { name: "Voltar para clientes" }).click()

  await page.locator(
    'button:visible[aria-label="Editar Município de Horizonte"]',
  ).click()
  const edit = page.getByRole("dialog", { name: "Editar cliente" })
  await edit.getByLabel("Nome fantasia").fill("Prefeitura Municipal de Horizonte")
  await edit.getByRole("button", { name: "Salvar alterações" }).click()
  await expect(page.getByText("Cliente atualizado.")).toBeVisible()

  await page.locator(
    'button:visible[aria-label="Arquivar Município de Horizonte"]',
  ).click()
  await expect(page.getByText("Cliente arquivado.")).toBeVisible()
  await toggleArchivedFilter(page, "Mostrar arquivados")
  await expect(
    page.locator("span:visible", { hasText: /^Arquivado$/u }),
  ).toBeVisible()
  await page.locator(
    'button:visible[aria-label="Restaurar Município de Horizonte"]',
  ).click()
  await expect(page.getByText("Cliente restaurado.")).toBeVisible()
  await toggleArchivedFilter(page, "Mostrar ativos")
  page.once("dialog", (dialog) => void dialog.accept())
  await page.locator(
    'button:visible[aria-label="Excluir Município de Horizonte"]',
  ).click()
  await expect(page.getByText("Cliente excluído.")).toBeVisible()
})

test("keeps stale local values and presents the current server version", async ({
  context,
  companyFixture,
}) => {
  test.setTimeout(120_000)
  const first = await context.newPage()
  const second = await context.newPage()
  try {
    await login(first, companyFixture.adminA)

    await first.goto("/app/administrativo/clientes")
    await first.getByRole("button", { name: "Novo cliente" }).click()
    const create = first.getByRole("dialog", { name: "Novo cliente" })
    await create.getByLabel("Razão social").fill("Câmara Municipal de Aquiraz")
    await create.getByLabel("CNPJ").fill("11.222.333/0001-81")
    await create.getByLabel("Segmento").fill("Câmaras")
    await create.getByLabel("Município").fill("Aquiraz")
    await create.getByLabel("UF").fill("CE")
    await create.getByRole("button", { name: "Criar cliente" }).click()
    await expect(first.getByText("Cliente criado.")).toBeVisible()

    await second.goto("/app/administrativo/clientes")
    await expect(second.getByRole("heading", { name: "Clientes" })).toBeVisible()
    await first.locator(
      'button:visible[aria-label="Editar Câmara Municipal de Aquiraz"]',
    ).click()
    await second.locator(
      'button:visible[aria-label="Editar Câmara Municipal de Aquiraz"]',
    ).click()

    const firstEdit = first.getByRole("dialog", { name: "Editar cliente" })
    const secondEdit = second.getByRole("dialog", { name: "Editar cliente" })
    await secondEdit.getByLabel("Nome fantasia").fill("Versão do servidor")
    await secondEdit.getByRole("button", { name: "Salvar alterações" }).click()
    await expect(second.getByText("Cliente atualizado.")).toBeVisible()
    await firstEdit.getByLabel("Nome fantasia").fill("Minha edição local")
    await firstEdit.getByRole("button", { name: "Salvar alterações" }).click()

    const comparison = first.getByRole("region", { name: "Conflito de edição" })
    await expect(comparison).toContainText("Minha edição local")
    await expect(comparison).toContainText("Versão do servidor")
    await expect(firstEdit.getByLabel("Nome fantasia")).toHaveValue(
      "Minha edição local",
    )
  } finally {
    await first.close()
    await second.close()
  }
})

async function chooseCatalogFilters(
  page: Page,
  input: Readonly<{
    archived?: boolean
    itemKind?: "product" | "service" | "all"
    segment?: string
  }>,
) {
  const filterButton = page.locator(
    'button:visible[aria-label="Filtros do catálogo"]',
  )
  const mobile = (await filterButton.count()) > 0
  if (mobile) await filterButton.click()
  const scope = mobile
    ? page.getByRole("dialog", { name: "Filtrar catálogo" })
    : page.locator('[data-testid="catalog-inline-filters"]')
  if (input.itemKind) {
    await scope.getByLabel("Tipo de item").selectOption(input.itemKind)
  }
  if (input.segment !== undefined) {
    await scope.getByLabel("Segmento do catálogo").fill(input.segment)
  }
  if (input.archived !== undefined) {
    const toggle = scope.getByRole("button", {
      name: input.archived ? "Mostrar arquivados" : "Mostrar ativos",
    })
    if (await toggle.isVisible()) await toggle.click()
  }
  const apply = scope.getByRole("button", { name: "Aplicar filtros" })
  if (await apply.isVisible()) await apply.click()
}

test("manages service and product catalog items responsively", async ({
  page,
  companyFixture,
}) => {
  test.setTimeout(120_000)
  await login(page, companyFixture.adminA)
  await page.goto("/app/administrativo/servicos")

  await expect(
    page.getByRole("heading", { name: "Serviços e produtos" }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.getByRole("button", { name: "Novo item" }).click()
  let form = page.getByRole("dialog", { name: "Novo item do catálogo" })
  await form.getByLabel("Serviço").check()
  await form.getByLabel("Nome").fill("Suporte técnico especializado")
  await form.getByLabel("Segmento").fill("Tecnologia")
  await form
    .getByLabel("Descrição")
    .fill("Atendimento técnico para ambientes administrativos públicos.")
  await form.getByRole("button", { name: "Criar item" }).click()
  await expect(page.getByText("Item criado.")).toBeVisible()

  await page.getByRole("button", { name: "Novo item" }).click()
  form = page.getByRole("dialog", { name: "Novo item do catálogo" })
  await form.getByLabel("Produto").check()
  await form.getByLabel("Nome").fill("Notebook corporativo")
  await form.getByLabel("Segmento").fill("Equipamentos")
  await form
    .getByLabel("Descrição")
    .fill("Equipamento para uso administrativo com garantia de fábrica.")
  await form.getByRole("button", { name: "Criar item" }).click()
  await expect(page.getByText("Item criado.")).toBeVisible()

  await page.getByLabel("Buscar no catálogo").fill("Suporte")
  await expect(
    page.locator("*:visible", { hasText: /^Suporte técnico especializado$/u }),
  ).toBeVisible()
  await page.getByLabel("Buscar no catálogo").fill("")
  await chooseCatalogFilters(page, {
    itemKind: "product",
    segment: "Equipamentos",
  })
  await expect(
    page.locator("*:visible", { hasText: /^Notebook corporativo$/u }),
  ).toBeVisible()
  await expect(
    page.locator("*:visible", { hasText: /^Suporte técnico especializado$/u }),
  ).toHaveCount(0)

  await page.locator(
    'button:visible[aria-label="Editar Notebook corporativo"]',
  ).click()
  const edit = page.getByRole("dialog", { name: "Editar item do catálogo" })
  await edit
    .getByLabel("Descrição")
    .fill("Equipamento administrativo atualizado, com garantia estendida.")
  await edit.getByRole("button", { name: "Salvar alterações" }).click()
  await expect(page.getByText("Item atualizado.")).toBeVisible()

  await page.locator(
    'button:visible[aria-label="Arquivar Notebook corporativo"]',
  ).click()
  await expect(page.getByText("Item arquivado.")).toBeVisible()
  await chooseCatalogFilters(page, { archived: true })
  await page.locator(
    'button:visible[aria-label="Restaurar Notebook corporativo"]',
  ).click()
  await expect(page.getByText("Item restaurado.")).toBeVisible()
  await chooseCatalogFilters(page, { archived: false })
  page.once("dialog", (dialog) => void dialog.accept())
  await page.getByRole("button", {
    name: "Abrir ações perigosas de Notebook corporativo",
  }).click()
  await page.getByRole("menuitem", {
    name: "Excluir Notebook corporativo",
  }).click()
  await expect(page.getByText("Item excluído.")).toBeVisible()
})

test("preserves a stale catalog edit and compares the current item", async ({
  context,
  companyFixture,
}) => {
  test.setTimeout(120_000)
  const first = await context.newPage()
  const second = await context.newPage()
  try {
    await login(first, companyFixture.adminA)
    await first.goto("/app/administrativo/servicos")
    await first.getByRole("button", { name: "Novo item" }).click()
    const create = first.getByRole("dialog", {
      name: "Novo item do catálogo",
    })
    await create.getByLabel("Serviço").check()
    await create.getByLabel("Nome").fill("Consultoria de conformidade")
    await create.getByLabel("Segmento").fill("Consultoria")
    await create
      .getByLabel("Descrição")
      .fill("Descrição inicial para o teste de concorrência.")
    await create.getByRole("button", { name: "Criar item" }).click()
    await expect(first.getByText("Item criado.")).toBeVisible()

    await second.goto("/app/administrativo/servicos")
    await expect(
      second.getByRole("heading", { name: "Serviços e produtos" }),
    ).toBeVisible()
    await first.locator(
      'button:visible[aria-label="Editar Consultoria de conformidade"]',
    ).click()
    await second.locator(
      'button:visible[aria-label="Editar Consultoria de conformidade"]',
    ).click()

    const firstEdit = first.getByRole("dialog", {
      name: "Editar item do catálogo",
    })
    const secondEdit = second.getByRole("dialog", {
      name: "Editar item do catálogo",
    })
    await secondEdit
      .getByLabel("Descrição")
      .fill("Descrição atual gravada pela segunda aba.")
    await secondEdit.getByRole("button", { name: "Salvar alterações" }).click()
    await expect(second.getByText("Item atualizado.")).toBeVisible()
    await firstEdit
      .getByLabel("Descrição")
      .fill("Descrição local que deve permanecer no formulário.")
    await firstEdit.getByRole("button", { name: "Salvar alterações" }).click()

    const comparison = first.getByRole("region", {
      name: "Conflito de edição do catálogo",
    })
    await expect(comparison).toContainText(
      "Descrição local que deve permanecer no formulário.",
    )
    await expect(comparison).toContainText(
      "Descrição atual gravada pela segunda aba.",
    )
    await expect(firstEdit.getByLabel("Descrição")).toHaveValue(
      "Descrição local que deve permanecer no formulário.",
    )
  } finally {
    await first.close()
    await second.close()
  }
})
