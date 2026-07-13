import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/db/bff.ts", "utf8");
const migration = [
  "supabase/migrations/20260713004222_administrative_rls.sql",
  "supabase/migrations/20260713015131_proposal_total_mismatch_security_event.sql",
].map((file) => readFileSync(file, "utf8")).join("\n");

const routines = [
  "create_client",
  "update_client",
  "archive_client",
  "restore_client",
  "delete_client",
  "create_catalog_item",
  "update_catalog_item",
  "archive_catalog_item",
  "restore_catalog_item",
  "delete_catalog_item",
  "create_proposal",
  "update_draft_proposal",
  "save_proposal_items",
  "transition_proposal_status",
  "delete_draft_proposal",
  "create_contract",
  "update_contract",
  "close_contract",
  "delete_contract",
  "version_contract_attachment",
  "write_proposal_total_mismatch_security_event",
] as const;

const methods = [
  "createClient",
  "updateClient",
  "archiveClient",
  "restoreClient",
  "deleteClient",
  "createCatalogItem",
  "updateCatalogItem",
  "archiveCatalogItem",
  "restoreCatalogItem",
  "deleteCatalogItem",
  "createProposal",
  "updateDraftProposal",
  "saveProposalItems",
  "transitionProposalStatus",
  "deleteDraftProposal",
  "createContract",
  "updateContract",
  "closeContract",
  "deleteContract",
  "versionContractAttachment",
  "writeProposalTotalMismatchSecurityEvent",
] as const;

describe("administrative BFF boundary", () => {
  it.each(routines)("keeps private.%s BFF-only", (routine) => {
    expect(migration).toContain(`private.${routine}`);
    expect(migration).toMatch(
      new RegExp(`grant execute[\\s\\S]*private\\.${routine}\\(`, "u"),
    );
  });

  it.each(methods)("maps %s one-to-one", (method) => {
    expect(source).toMatch(new RegExp(`async ${method}\\(`, "u"));
  });

  it("does not expose a public proposal writer", () => {
    expect(migration).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.create_proposal/iu,
    );
  });

  it("keeps recursively strict response decoders", () => {
    expect(source).toContain("clientMutationRecordSchema");
    expect(source).toContain("proposalWithItemsMutationRecordSchema");
    expect(source).toContain("attachmentMutationRecordSchema");
    expect(source.match(/\.strict\(\)/gu)?.length ?? 0).toBeGreaterThan(20);
  });
});
