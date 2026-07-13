import "server-only"

import { randomUUID } from "node:crypto"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import { sha256Hex } from "@/lib/security/sha256"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { getGeneratedDocumentStorage } from "@/modules/files/server/file-storage"
import {
  proposalDocumentSnapshotSchema,
  type ProposalDocumentSnapshot,
} from "@/modules/proposals/server/proposal-snapshot"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

const MAX_GENERATED_DOCUMENT_BYTES = 25 * 1024 * 1024
const PDF_HEADER = Buffer.from("%PDF-", "ascii")

export type ProposalDocumentSummary = Readonly<{
  documentId: string
  version: number
  checksumSha256: string
  templateVersion: "proposal-v1"
  createdAt: string
}>

export type GeneratedDocumentDependencies = Readonly<{
  upload(path: string, bytes: Buffer): Promise<void>
  remove(path: string): Promise<void>
  store(input: {
    actorUserId: string
    sessionId: string
    proposalId: string
    objectPath: string
    contentType: "application/pdf"
    byteSize: number
    sha256: string
    snapshot: Record<string, unknown>
    templateVersion: "proposal-v1"
    correlationId: string
  }): ReturnType<typeof bffDb.storeProposalDocument>
  recordOrphan(input: {
    actorUserId: string
    sessionId: string
    proposalId: string
    objectPath: string
    sha256: string
    correlationId: string
  }): Promise<unknown>
}>

function defaultDependencies(): GeneratedDocumentDependencies {
  const storage = getGeneratedDocumentStorage()
  return {
    upload: (path, bytes) => storage.uploadPdf(path, bytes),
    remove: (path) => storage.removePrivate(path),
    store: (input) => bffDb.storeProposalDocument(input),
    recordOrphan: (input) =>
      bffDb.recordGeneratedDocumentOrphanCleanup(input),
  }
}

function assertPdf(bytes: Buffer): void {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length <= PDF_HEADER.length ||
    bytes.length > MAX_GENERATED_DOCUMENT_BYTES ||
    !bytes.subarray(0, PDF_HEADER.length).equals(PDF_HEADER)
  ) {
    throw new ApiError(
      "PDF_GENERATION_FAILED",
      503,
      "Não foi possível gerar o documento.",
    )
  }
}

export async function persistProposalDocument(
  input: Readonly<{
    context: CompanyContext
    proposalId: string
    bytes: Buffer
    snapshot: ProposalDocumentSnapshot
    correlationId: string
  }>,
  dependencies: GeneratedDocumentDependencies = defaultDependencies(),
) {
  assertPdf(input.bytes)
  const snapshot = proposalDocumentSnapshotSchema.parse(input.snapshot)
  const sha256 = sha256Hex(input.bytes)
  const objectPath = `${input.context.companyId}/generated-documents/${randomUUID()}.pdf`

  await dependencies.upload(objectPath, input.bytes)
  try {
    return await dependencies.store({
      actorUserId: input.context.userId,
      sessionId: input.context.sessionId,
      proposalId: input.proposalId,
      objectPath,
      contentType: "application/pdf",
      byteSize: input.bytes.length,
      sha256,
      snapshot: snapshot as unknown as Record<string, unknown>,
      templateVersion: "proposal-v1",
      correlationId: input.correlationId,
    })
  } catch (error) {
    try {
      await dependencies.remove(objectPath)
    } catch {
      await dependencies.recordOrphan({
        actorUserId: input.context.userId,
        sessionId: input.context.sessionId,
        proposalId: input.proposalId,
        objectPath,
        sha256,
        correlationId: input.correlationId,
      }).catch(() => undefined)
    }
    throw error
  }
}

export async function listStoredProposalDocuments(input: Readonly<{
  context: CompanyContext
  proposalId: string
}>): Promise<readonly ProposalDocumentSummary[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("generated_documents")
    .select("id,version,checksum_sha256,template_version,created_at")
    .eq("company_id", input.context.companyId)
    .eq("proposal_id", input.proposalId)
    .eq("kind", "proposal")
    .order("version", { ascending: false })
  if (error) throw new Error("Proposal document list unavailable")
  return z
    .array(
      z
        .object({
          id: z.uuid(),
          version: z.int().positive(),
          checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
          template_version: z.literal("proposal-v1"),
          created_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
    )
    .parse(data)
    .map((row) => ({
      documentId: row.id,
      version: row.version,
      checksumSha256: row.checksum_sha256,
      templateVersion: row.template_version,
      createdAt: row.created_at,
    }))
}

export async function proposalDocumentBelongsTo(input: Readonly<{
  context: CompanyContext
  proposalId: string
  documentId: string
}>): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("generated_documents")
    .select("id")
    .eq("company_id", input.context.companyId)
    .eq("proposal_id", input.proposalId)
    .eq("id", input.documentId)
    .eq("kind", "proposal")
    .maybeSingle()
  if (error) throw new Error("Proposal document unavailable")
  return data !== null
}
