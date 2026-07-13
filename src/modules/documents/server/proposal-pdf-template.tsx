import "server-only"

/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no HTML alt prop. */

import { createHash } from "node:crypto"

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer"

import {
  proposalDocumentSnapshotSchema,
  type ProposalDocumentSnapshot,
} from "@/modules/proposals/server/proposal-snapshot"

const MAX_BRANDING_BYTES = 5 * 1_024 * 1_024
const MAX_BRANDING_PIXELS = 40_000_000
const ALLOWED_BRANDING_FORMATS = new Set(["jpeg", "png", "webp"])

export const MISSING_SIGNATURE_LABEL = "Sem assinatura cadastrada"

export type ProposalPdfInput = Readonly<{
  snapshot: ProposalDocumentSnapshot
  letterhead?: Buffer | null
  signature?: Buffer | null
}>

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#172033",
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.45,
    paddingBottom: 48,
    paddingHorizontal: 42,
    paddingTop: 38,
  },
  letterhead: {
    height: 62,
    marginBottom: 12,
    objectFit: "contain",
    objectPosition: "left center",
    width: "100%",
  },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: 17 },
  companyMeta: { color: "#526078", fontSize: 8, marginTop: 3 },
  rule: { borderBottomColor: "#cbd3df", borderBottomWidth: 1, marginVertical: 14 },
  titleRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  proposalMeta: { color: "#344258", fontSize: 9, textAlign: "right" },
  section: { marginTop: 18 },
  sectionTitle: {
    color: "#2563a9",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  clientName: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  muted: { color: "#526078" },
  table: { borderColor: "#cbd3df", borderWidth: 1, marginTop: 7 },
  tableHeader: {
    backgroundColor: "#eaf0f8",
    borderBottomColor: "#cbd3df",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  tableHeaderText: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  tableRow: {
    borderBottomColor: "#dfe5ee",
    borderBottomWidth: 0.6,
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  itemHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  itemHeadingLabel: { fontFamily: "Helvetica-Bold", width: "75%" },
  itemDescription: { width: "100%" },
  itemCalculation: { color: "#526078", marginTop: 6 },
  descriptionColumn: { paddingRight: 8, width: "75%" },
  amountColumn: { textAlign: "right", width: "25%" },
  totalRow: {
    alignItems: "center",
    backgroundColor: "#f6f8fb",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", marginRight: 12 },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  representative: { borderTopColor: "#cbd3df", borderTopWidth: 1, marginTop: 24, paddingTop: 12 },
  signature: { height: 58, marginBottom: 7, objectFit: "contain", objectPosition: "left bottom", width: 180 },
  missingSignature: { color: "#66758d", fontFamily: "Helvetica-Oblique", marginBottom: 9 },
  author: { color: "#66758d", fontSize: 7.5, marginTop: 18 },
  footer: {
    color: "#66758d",
    fontSize: 7,
    left: 42,
    position: "absolute",
    right: 42,
    textAlign: "center",
    top: 812,
  },
})

function formatCnpj(value: string): string {
  return value.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/u,
    "$1.$2.$3/$4-$5",
  )
}

function formatPostalCode(value: string | null): string | null {
  return value?.replace(/^(\d{5})(\d{3})$/u, "$1-$2") ?? null
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

function clientAddress(snapshot: ProposalDocumentSnapshot): string {
  const address = snapshot.client.address
  const street = [address.street, address.number].filter(Boolean).join(", ")
  const locality = `${address.municipality}/${address.state}`
  const postalCode = formatPostalCode(address.postalCode)
  return [street, address.complement, address.neighborhood, locality, postalCode ? `CEP ${postalCode}` : null]
    .filter(Boolean)
    .join(" · ")
}

function lineDetail(item: ProposalDocumentSnapshot["items"][number]): string {
  return item.itemKind === "service"
    ? `${item.months} mês(es) × R$ ${item.monthlyAmount}`
    : `${item.quantity} × R$ ${item.unitAmount}`
}

async function validatedBrandingImage(
  value: unknown,
  expectedSha256: string | null,
): Promise<Buffer | null> {
  if (value === undefined || value === null) {
    if (expectedSha256 !== null) throw new Error("BRANDING_BUFFER_REQUIRED")
    return null
  }
  if (!Buffer.isBuffer(value)) throw new Error("INVALID_BRANDING_BUFFER")
  if (value.length === 0 || value.length > MAX_BRANDING_BYTES) {
    throw new Error("INVALID_BRANDING_BUFFER")
  }
  const checksum = createHash("sha256").update(value).digest("hex")
  if (expectedSha256 === null || checksum !== expectedSha256) {
    throw new Error("BRANDING_SHA256_MISMATCH")
  }

  try {
    const { default: sharp } = await import("sharp")
    const image = sharp(value, {
      animated: true,
      failOn: "warning",
      limitInputPixels: MAX_BRANDING_PIXELS,
    })
    const metadata = await image.metadata()
    if (
      metadata.format === undefined ||
      !ALLOWED_BRANDING_FORMATS.has(metadata.format) ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > MAX_BRANDING_PIXELS / metadata.height ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("INVALID_BRANDING_IMAGE")
    }
    return await sharp(value, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_BRANDING_PIXELS,
    })
      .png()
      .toBuffer()
  } catch {
    throw new Error("INVALID_BRANDING_IMAGE")
  }
}

function ProposalPdfDocument({
  letterhead,
  signature,
  snapshot,
}: Readonly<{
  letterhead: Buffer | null
  signature: Buffer | null
  snapshot: ProposalDocumentSnapshot
}>) {
  return (
    <Document author={snapshot.company.legalName} creator="Axsys" subject={`Proposta ${snapshot.proposal.number}`} title={`Proposta ${snapshot.proposal.number}`}>
      <Page size="A4" style={styles.page} wrap>
        <Text fixed render={({ pageNumber, totalPages }) => `Proposta ${snapshot.proposal.number} · Página ${pageNumber} de ${totalPages}`} style={styles.footer} />
        {letterhead ? <Image src={{ data: letterhead, format: "png" }} style={styles.letterhead} /> : null}
        <View>
          <Text style={styles.companyName}>{snapshot.company.legalName}</Text>
          {snapshot.company.tradeName ? <Text style={styles.companyMeta}>{snapshot.company.tradeName}</Text> : null}
          <Text style={styles.companyMeta}>CNPJ {formatCnpj(snapshot.company.cnpj)}</Text>
          {snapshot.company.consolidatedAddress ? <Text style={styles.companyMeta}>{snapshot.company.consolidatedAddress}</Text> : null}
        </View>

        <View style={styles.rule} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>PROPOSTA COMERCIAL</Text>
          <View>
            <Text style={styles.proposalMeta}>Nº {snapshot.proposal.number}</Text>
            <Text style={styles.proposalMeta}>Emissão {formatDate(snapshot.proposal.issuedOn)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cliente</Text>
          <Text style={styles.clientName}>{snapshot.client.legalName}</Text>
          {snapshot.client.tradeName ? <Text style={styles.muted}>{snapshot.client.tradeName}</Text> : null}
          <Text style={styles.muted}>CNPJ {formatCnpj(snapshot.client.cnpj)}</Text>
          <Text style={styles.muted}>{clientAddress(snapshot)}</Text>
          {snapshot.client.email ? <Text style={styles.muted}>{snapshot.client.email}</Text> : null}
          {snapshot.client.phone ? <Text style={styles.muted}>{snapshot.client.phone}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Itens da proposta</Text>
          <View style={styles.table}>
            <View fixed style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.descriptionColumn]}>Item e descrição</Text>
              <Text style={[styles.tableHeaderText, styles.amountColumn]}>Subtotal</Text>
            </View>
            {snapshot.items.map((item) => (
              <View key={`${item.position}:${item.catalogItemId}`} style={styles.tableRow}>
                <View style={styles.itemHeading} wrap={false}>
                  <Text style={styles.itemHeadingLabel}>Item {item.position} · {item.itemKind === "service" ? "Serviço" : "Produto"}</Text>
                  <Text style={styles.amountColumn}>R$ {item.lineTotal}</Text>
                </View>
                <Text orphans={2} style={styles.itemDescription} widows={2}>{item.description}</Text>
                <Text style={styles.itemCalculation}>Cálculo: {lineDetail(item)}</Text>
              </View>
            ))}
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={styles.totalValue}>R$ {snapshot.proposal.total}</Text>
            </View>
          </View>
        </View>

        <View style={styles.representative} wrap={false}>
          <Text style={styles.sectionTitle}>Representante</Text>
          {signature ? (
            <Image src={{ data: signature, format: "png" }} style={styles.signature} />
          ) : (
            <Text style={styles.missingSignature}>{MISSING_SIGNATURE_LABEL}</Text>
          )}
          <Text>{snapshot.company.representative.name ?? "Representante não informado"}</Text>
          {snapshot.company.representative.role ? <Text style={styles.muted}>{snapshot.company.representative.role}</Text> : null}
        </View>

        <Text style={styles.author}>Gerado por {snapshot.author.displayName} ({snapshot.author.email}) em {snapshot.generatedAt}</Text>
      </Page>
    </Document>
  )
}

export async function renderProposalPdf(input: ProposalPdfInput): Promise<Buffer> {
  const snapshot = proposalDocumentSnapshotSchema.parse(input.snapshot)
  const [letterhead, signature] = await Promise.all([
    validatedBrandingImage(input.letterhead, snapshot.company.branding.letterheadSha256),
    validatedBrandingImage(input.signature, snapshot.company.branding.signatureSha256),
  ])
  const bytes = await renderToBuffer(
    <ProposalPdfDocument letterhead={letterhead} signature={signature} snapshot={snapshot} />,
  )
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("INVALID_PDF_OUTPUT")
  }
  return Buffer.from(bytes)
}
