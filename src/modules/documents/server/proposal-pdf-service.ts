import "server-only"

import { PDFDocument } from "pdf-lib"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  persistProposalDocument,
  listStoredProposalDocuments,
  proposalDocumentBelongsTo,
} from "@/modules/documents/server/generated-document-repository"
import { renderProposalPdf } from "@/modules/documents/server/proposal-pdf-template"
import {
  acquireDownloadCapacity,
  classifyDownloadBytes,
  createAuditedDownloadResponse,
} from "@/modules/files/server/audited-download-streamer"
import {
  getPrivateDownloadStorage,
  type PrivateDownloadStorage,
} from "@/modules/files/server/file-storage"
import { readVerifiedPrivateBuffer } from "@/modules/files/server/verified-private-buffer"
import { getCompanySettings } from "@/modules/settings/server/company-settings-service"
import {
  buildProposalDocumentSnapshot,
  type ProposalDocumentSnapshot,
} from "@/modules/proposals/server/proposal-snapshot"
import { getProposalDetail } from "@/modules/proposals/server/proposal-repository"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

const MAX_BRANDING_BYTES = 5 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u
const NONCE = /^[A-Za-z0-9_-]{43}$/u
const DOCUMENT_PATH = /^([0-9a-f-]{36})\/generated-documents\/([0-9a-f-]{36})\.pdf$/u
const STORAGE_TIMEOUT_MS = 15_000

const clientSchema = z
  .object({
    legal_name: z.string().min(2).max(200),
    trade_name: z.string().min(2).max(200).nullable(),
    cnpj_normalized: z.string().regex(/^\d{14}$/u),
    email: z.email().max(254).nullable(),
    phone: z.string().nullable(),
    address_street: z.string().nullable(),
    address_number: z.string().nullable(),
    address_complement: z.string().nullable(),
    address_neighborhood: z.string().nullable(),
    municipality: z.string().min(2).max(120),
    state: z.string().regex(/^[A-Z]{2}$/u),
    postal_code: z.string().regex(/^\d{8}$/u).nullable(),
  })
  .strict()

const companySchema = z
  .object({
    legal_name: z.string().min(2).max(160),
    trade_name: z.string().min(2).max(180).nullable(),
    cnpj_normalized: z.string().regex(/^\d{14}$/u),
  })
  .strict()

const brandingFileSchema = z
  .object({
    id: z.uuid(),
    object_path: z.string().min(1).max(1024),
    byte_size: z.int().positive().max(MAX_BRANDING_BYTES),
    sha256: z.string().regex(SHA256),
    detected_mime: z.literal("image/webp"),
    purpose: z.enum(["company_letterhead", "company_signature"]),
  })
  .strict()

function notFound(message = "Documento não encontrado."): ApiError {
  return new ApiError("DOCUMENT_NOT_FOUND", 404, message)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout()
          reject(new Error("Private object unavailable"))
        }, timeoutMs)
        timeout.unref()
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

async function loadBranding(
  context: CompanyContext,
  fileId: string | null,
  purpose: "company_letterhead" | "company_signature",
  storage: PrivateDownloadStorage,
): Promise<Readonly<{ sha256: string | null; bytes: Buffer | null }>> {
  if (fileId === null) return { sha256: null, bytes: null }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("file_objects")
    .select("id,object_path,byte_size,sha256,detected_mime,purpose")
    .eq("company_id", context.companyId)
    .eq("id", fileId)
    .eq("purpose", purpose)
    .eq("status", "ready")
    .eq("scan_status", "clean")
    .maybeSingle()
  if (error || !data) throw new Error("Branding unavailable")
  const file = brandingFileSchema.parse(data)
  if (file.object_path !== `${context.companyId}/${purpose}/${file.id}.webp`) {
    throw new Error("Branding unavailable")
  }
  const abort = new AbortController()
  const source = await withTimeout(
    storage.downloadPrivate(file.object_path, abort.signal),
    STORAGE_TIMEOUT_MS,
    () => abort.abort(),
  )
  return {
    sha256: file.sha256,
    bytes: await withTimeout(
      readVerifiedPrivateBuffer({
        source,
        expectedBytes: file.byte_size,
        expectedSha256: file.sha256,
        maxBytes: MAX_BRANDING_BYTES,
      }),
      STORAGE_TIMEOUT_MS,
      () => abort.abort(),
    ),
  }
}

async function proposalSnapshotSource(
  context: CompanyContext,
  proposalId: string,
  generatedAt: string,
  storage: PrivateDownloadStorage,
): Promise<Readonly<{
  snapshot: ProposalDocumentSnapshot
  letterhead: Buffer | null
  signature: Buffer | null
}>> {
  const detail = await getProposalDetail({ context, proposalId })
  const supabase = await createServerSupabase()
  const [clientResult, companyResult, settings] = await Promise.all([
    supabase
      .from("clients")
      .select("legal_name,trade_name,cnpj_normalized,email,phone,address_street,address_number,address_complement,address_neighborhood,municipality,state,postal_code")
      .eq("company_id", context.companyId)
      .eq("id", detail.proposal.clientId)
      .maybeSingle(),
    supabase
      .from("companies")
      .select("legal_name,trade_name,cnpj_normalized")
      .eq("id", context.companyId)
      .maybeSingle(),
    getCompanySettings(context),
  ])
  if (clientResult.error || companyResult.error || !clientResult.data || !companyResult.data) {
    throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
  }
  const client = clientSchema.parse(clientResult.data)
  const company = companySchema.parse(companyResult.data)
  const [letterhead, signature] = await Promise.all([
    loadBranding(context, settings.letterheadFileId, "company_letterhead", storage),
    loadBranding(context, settings.signatureFileId, "company_signature", storage),
  ])
  const snapshot = buildProposalDocumentSnapshot({
    templateVersion: "proposal-v1",
    generatedAt,
    proposal: {
      number: detail.proposal.number,
      status: detail.proposal.status,
      issuedOn: detail.proposal.issuedOn,
      total: detail.proposal.total,
    },
    items: detail.items.map((item) => ({
      catalogItemId: item.catalogItemId,
      itemKind: item.itemKind,
      position: item.position,
      descriptionSnapshot: item.description,
      months: item.months,
      monthlyAmount: item.monthlyAmount,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
    })),
    client: {
      legalName: client.legal_name,
      tradeName: client.trade_name,
      cnpj: client.cnpj_normalized,
      email: client.email,
      phone: client.phone,
      address: {
        street: client.address_street,
        number: client.address_number,
        complement: client.address_complement,
        neighborhood: client.address_neighborhood,
        municipality: client.municipality,
        state: client.state,
        postalCode: client.postal_code,
      },
    },
    company: {
      legalName: company.legal_name,
      tradeName: company.trade_name,
      cnpj: company.cnpj_normalized,
      consolidatedAddress: settings.consolidatedAddress,
      representativeName: settings.representativeName,
      representativeRole: settings.representativeRole,
      letterheadSha256: letterhead.sha256,
      signatureSha256: signature.sha256,
    },
    author: {
      displayName: context.profile.displayName,
      email: context.profile.email,
    },
  })
  return { snapshot, letterhead: letterhead.bytes, signature: signature.bytes }
}

async function assertPassivePdf(bytes: Buffer): Promise<void> {
  const document = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  })
  if (document.getPageCount() < 1) throw new Error("Invalid PDF")
  const raw = bytes.toString("latin1")
  if (/\/(?:JavaScript|JS|OpenAction|Launch|URI)\b/u.test(raw)) {
    throw new Error("Active PDF action rejected")
  }
}

export async function generateProposalPdf(input: Readonly<{
  context: CompanyContext
  proposalId: string
  correlationId: string
}>) {
  try {
    const source = await proposalSnapshotSource(
      input.context,
      input.proposalId,
      new Date().toISOString(),
      getPrivateDownloadStorage(),
    )
    const bytes = await renderProposalPdf(source)
    await assertPassivePdf(bytes)
    return await persistProposalDocument({
      context: input.context,
      proposalId: input.proposalId,
      bytes,
      snapshot: source.snapshot,
      correlationId: input.correlationId,
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === "PROPOSAL_NOT_FOUND") {
      throw error
    }
    const token = typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : ""
    if (token.includes("PROPOSAL_NOT_FOUND")) {
      throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
    }
    if (token.includes("QUOTA")) {
      throw new ApiError("STORAGE_QUOTA_EXCEEDED", 409, "Limite de armazenamento atingido.")
    }
    throw new ApiError("PDF_GENERATION_FAILED", 503, "Não foi possível gerar o documento.")
  }
}

export async function listProposalDocuments(input: Readonly<{
  context: CompanyContext
  proposalId: string
}>) {
  await getProposalDetail({ context: input.context, proposalId: input.proposalId })
  return listStoredProposalDocuments(input)
}

function validDownloadAuthorization(
  value: Awaited<ReturnType<typeof bffDb.authorizeProposalDocumentDownload>>,
  context: CompanyContext,
): boolean {
  const match = DOCUMENT_PATH.exec(value.path)
  return value.bucket === "axsys-private" &&
    value.mime === "application/pdf" &&
    match?.[1] === context.companyId &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    value.byteSize <= MAX_DOCUMENT_BYTES &&
    SHA256.test(value.sha256) &&
    NONCE.test(value.completionNonce)
}

export async function downloadProposalDocument(input: Readonly<{
  context: CompanyContext
  proposalId: string
  documentId: string
  correlationId: string
}>): Promise<Response> {
  try {
    if (!(await proposalDocumentBelongsTo(input))) throw notFound()
    const authorizationAbort = new AbortController()
    const authorization = await bffDb.authorizeProposalDocumentDownload({
      actorUserId: input.context.userId,
      sessionId: input.context.sessionId,
      documentId: input.documentId,
      correlationId: input.correlationId,
      signal: authorizationAbort.signal,
    })
    if (!validDownloadAuthorization(authorization, input.context)) throw notFound()
    const release = acquireDownloadCapacity()
    let source: ReadableStream<Uint8Array>
    const storageAbort = new AbortController()
    try {
      source = await withTimeout(
        getPrivateDownloadStorage().downloadPrivate(
          authorization.path,
          storageAbort.signal,
        ),
        STORAGE_TIMEOUT_MS,
        () => storageAbort.abort(),
      )
    } catch {
      release()
      await bffDb.completeDownloadAudit({
        attemptId: authorization.attemptId,
        completionNonce: authorization.completionNonce,
        outcome: "stream_failed",
        byteClass: classifyDownloadBytes(authorization.byteSize),
        signal: new AbortController().signal,
      }).catch(() => undefined)
      throw notFound()
    }
    return createAuditedDownloadResponse({
      source,
      expectedBytes: authorization.byteSize,
      expectedSha256: authorization.sha256,
      mimeType: authorization.mime,
      originalName: authorization.downloadName,
      capacityLease: release,
      complete: (result, signal) => bffDb.completeDownloadAudit({
        attemptId: authorization.attemptId,
        completionNonce: authorization.completionNonce,
        ...result,
        signal,
      }),
    })
  } catch {
    throw notFound()
  }
}
