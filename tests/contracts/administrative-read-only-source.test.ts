import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOTS = [
  "src/modules/administrative/server/client-repository.ts",
  "src/modules/administrative/server/client-service.ts",
  "src/modules/administrative/server/catalog-item-repository.ts",
  "src/modules/administrative/server/catalog-item-service.ts",
  "src/modules/proposals/server/proposal-repository.ts",
  "src/modules/proposals/server/proposal-service.ts",
  "src/modules/documents/server/generated-document-repository.ts",
  "src/modules/documents/server/proposal-pdf-service.ts",
] as const

describe("administrative mutation boundary", () => {
  it.each(ROOTS)("keeps %s free from direct table writes", async (file) => {
    const source = await readFile(path.join(process.cwd(), file), "utf8")

    expect(source).not.toMatch(/\.(?:insert|update|upsert|delete)\s*\(/u)
  })

  it("delegates every client and catalog mutation to the restricted BFF", async () => {
    const [clients, catalog] = await Promise.all([
      readFile(
        path.join(
          process.cwd(),
          "src/modules/administrative/server/client-service.ts",
        ),
        "utf8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "src/modules/administrative/server/catalog-item-service.ts",
        ),
        "utf8",
      ),
    ])

    for (const name of [
      "createClient",
      "updateClient",
      "archiveClient",
      "restoreClient",
      "deleteClient",
    ]) {
      expect(clients).toContain(`bffDb.${name}`)
    }
    for (const name of [
      "createCatalogItem",
      "updateCatalogItem",
      "archiveCatalogItem",
      "restoreCatalogItem",
      "deleteCatalogItem",
    ]) {
      expect(catalog).toContain(`bffDb.${name}`)
    }
  })

  it("delegates proposal writes to the restricted BFF only", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/modules/proposals/server/proposal-repository.ts",
      ),
      "utf8",
    )

    for (const name of [
      "createProposal",
      "updateDraftProposal",
      "saveProposalItems",
      "transitionProposalStatus",
      "deleteDraftProposal",
    ]) {
      expect(source).toContain(`bffDb.${name}`)
    }
  })
})
