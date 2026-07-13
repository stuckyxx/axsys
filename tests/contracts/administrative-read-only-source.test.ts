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
  "src/modules/contracts/server/contract-repository.ts",
  "src/modules/contracts/server/contract-service.ts",
] as const

const ADMINISTRATIVE_SCHEMA_MIGRATION =
  "supabase/migrations/20260713003840_administrative_contracts_documents.sql"
const CONTRACT_SEARCH_MIGRATION =
  "supabase/migrations/20260713023333_contract_search_index_view.sql"

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

  it("delegates contract writes to the restricted BFF only", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/modules/contracts/server/contract-repository.ts",
      ),
      "utf8",
    )

    for (const name of [
      "createContract",
      "updateContract",
      "closeContract",
      "deleteContract",
    ]) {
      expect(source).toContain(`bffDb.${name}`)
    }

    expect(source).toContain("mapMutationRecord(result.record")
    expect(source).not.toContain("contractId: result.record.id")
  })

  it("keeps contract prefix and keyset indexes in the frozen schema", async () => {
    const [migration, searchMigration, repository] = await Promise.all([
      readFile(
        path.join(process.cwd(), ADMINISTRATIVE_SCHEMA_MIGRATION),
        "utf8",
      ),
      readFile(path.join(process.cwd(), CONTRACT_SEARCH_MIGRATION), "utf8"),
      readFile(
        path.join(
          process.cwd(),
          "src/modules/contracts/server/contract-repository.ts",
        ),
        "utf8",
      ),
    ])

    for (const index of [
      "contracts_company_ends_cursor_idx",
      "contracts_company_object_prefix_idx",
      "contracts_company_number_prefix_idx",
    ]) {
      expect(migration).toContain(`create index ${index}`)
    }


    expect(searchMigration).toContain(
      "lower(client.trade_name) as client_trade_name_prefix",
    )
    expect(searchMigration).not.toContain(
      "lower(coalesce(client.trade_name, '')) as client_trade_name_prefix",
    )
    expect(searchMigration).toContain("with (security_invoker = true)")
    expect(searchMigration).toContain("lower(contract.number) as number_prefix")
    expect(searchMigration).toContain("lower(contract.object) as object_prefix")
    expect(repository).toContain('.from("contract_search_rows")')
    expect(repository).toContain('.like("number_prefix", prefix)')
    expect(repository).toContain('.like("object_prefix", prefix)')
    expect(repository).not.toContain("number_prefix.like.${prefix}")
    expect(repository).not.toMatch(/number\.ilike|object\.ilike/u)
  })
})
