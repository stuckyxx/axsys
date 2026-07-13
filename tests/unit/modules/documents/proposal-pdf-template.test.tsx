import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { act } from "@testing-library/react"
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  MISSING_SIGNATURE_LABEL,
  renderProposalPdf,
} from "@/modules/documents/server/proposal-pdf-template"
import {
  buildProposalDocumentSnapshot,
  type ProposalSnapshotSource,
} from "@/modules/proposals/server/proposal-snapshot"

const LONG_DESCRIPTION = (
  "Descrição de implantação com ação, órgão público e informações técnicas. " +
  "<script>alert(1)</script> <img src=x onerror=alert(2)> " +
  "javascript:alert(document.domain) " +
  "conteúdo técnico com acentuação çãõ. ".repeat(80)
).slice(0, 2_000)

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

function decodedPageContent(pdf: PDFDocument, pageIndex: number): string {
  const contents = pdf.getPages()[pageIndex]?.node.Contents()
  if (!contents) return ""
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) =>
        contents.lookup(index, PDFRawStream),
      )
    : [contents as PDFRawStream]
  return Buffer.concat(
    streams.map((stream) => Buffer.from(decodePDFRawStream(stream).decode())),
  ).toString("latin1")
}

function snapshotSource(): ProposalSnapshotSource {
  return {
    proposal: { number: 1042, status: "draft", issuedOn: "2026-07-13", total: "11253.60" },
    items: Array.from({ length: 3 }, (_, index) => ({
      catalogItemId: crypto.randomUUID(),
      itemKind: "service",
      position: index + 1,
      descriptionSnapshot: LONG_DESCRIPTION,
      months: 3,
      monthlyAmount: "1250.40",
      quantity: null,
      unitAmount: null,
      lineTotal: "3751.20",
    })),
    client: {
      legalName: "Cliente São José Ltda", tradeName: "São José",
      cnpj: "11222333000181", email: "financeiro@cliente.test", phone: null,
      address: {
        street: "Rua da Constituição", number: "100", complement: null,
        neighborhood: "Centro", municipality: "Fortaleza", state: "CE",
        postalCode: "60000000",
      },
    },
    company: {
      legalName: "Axsys Tecnologia Ltda", tradeName: "Axsys",
      cnpj: "04252011000110",
      consolidatedAddress: "Rua Central, 100 · Fortaleza/CE · CEP 60000-000",
      representativeName: "Márcia Araújo", representativeRole: "Diretora Executiva",
      letterheadSha256: null, signatureSha256: null,
    },
    author: { displayName: "João D'Ávila", email: "joao@axsys.test" },
    templateVersion: "proposal-v1",
    generatedAt: "2026-07-13T12:30:00.000Z",
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("proposal PDF template", () => {
  it("renders a loadable real PDF without active actions or network access", async () => {
    const nativeFetch = globalThis.fetch
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : String(input)
      if (/^https?:/u.test(target)) throw new Error("NETWORK_FORBIDDEN")
      return nativeFetch(input, init)
    })
    vi.stubGlobal("fetch", fetchMock)
    let bytes: Buffer | undefined
    await act(async () => {
      bytes = await renderProposalPdf({
        snapshot: buildProposalDocumentSnapshot(snapshotSource()),
      })
    })

    expect(bytes).toBeDefined()
    expect(bytes!.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    const pdf = await PDFDocument.load(new Uint8Array(bytes!))
    expect(pdf.getPageCount()).toBeGreaterThan(0)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
    expect(decodedPageContent(pdf, 1)).toContain("636f6e7465fa646f")
    const objectGraph = [
      bytes!.toString("latin1"),
      ...[...pdf.context.enumerateIndirectObjects()].map(
        ([reference, object]) => `${reference.toString()} ${object.toString()}`,
      ),
    ].join("\n")
    expect(objectGraph).not.toMatch(/\/(?:JavaScript|JS|OpenAction|Launch|URI)\b/u)
    expect(fetchMock.mock.calls.every(([input]) => {
      const target = input instanceof Request ? input.url : String(input)
      return !/^https?:/u.test(target)
    })).toBe(true)
    expect(MISSING_SIGNATURE_LABEL).toBe("Sem assinatura cadastrada")
  }, 20_000)

  it("accepts validated in-memory images and rejects URL or malformed sources", async () => {
    const checksum = createHash("sha256").update(TINY_PNG).digest("hex")
    const source = snapshotSource()
    const snapshot = buildProposalDocumentSnapshot({
      ...source,
      company: {
        ...source.company,
        letterheadSha256: checksum,
        signatureSha256: checksum,
      },
    })
    let rendered: Buffer | undefined
    await act(async () => {
      rendered = await renderProposalPdf({ snapshot, letterhead: TINY_PNG, signature: TINY_PNG })
    })
    expect(rendered).toEqual(expect.any(Buffer))
    await expect(renderProposalPdf({ snapshot, letterhead: TINY_PNG, signature: "https://storage.test/signature.png" as unknown as Buffer })).rejects.toThrow("INVALID_BRANDING_BUFFER")
    const malformed = Buffer.from("not-an-image")
    const malformedSource = snapshotSource()
    const malformedSnapshot = buildProposalDocumentSnapshot({
      ...malformedSource,
      company: {
        ...malformedSource.company,
        letterheadSha256: createHash("sha256").update(malformed).digest("hex"),
      },
    })
    await expect(renderProposalPdf({ snapshot: malformedSnapshot, letterhead: malformed })).rejects.toThrow("INVALID_BRANDING_IMAGE")
  }, 20_000)

  it("contains no URL prop or network primitive in the renderer source", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/modules/documents/server/proposal-pdf-template.tsx"),
      "utf8",
    )
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    expect(source).not.toMatch(/\burl\??\s*:/iu)
    expect(source).toContain("MISSING_SIGNATURE_LABEL")
  })
})
