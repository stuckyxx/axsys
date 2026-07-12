export type FilePurpose =
  | "profile_avatar"
  | "company_letterhead"
  | "company_signature"
  | "contract_attachment"
  | "payment_invoice"
  | "certificate"
  | "generated_document"

export type EnabledImagePurpose = Extract<
  FilePurpose,
  "profile_avatar" | "company_letterhead" | "company_signature"
>

export type FileScanStatus = "pending" | "clean" | "infected" | "failed"
export type FileStatus = "ready" | "rejected" | "archived"

export type FileObject = Readonly<{
  id: string
  companyId: string
  ownerUserId: string | null
  purpose: FilePurpose
  bucket: "axsys-private"
  objectPath: string
  originalName: string
  detectedMime: string
  byteSize: number
  sha256: string
  scanStatus: FileScanStatus
  status: FileStatus
  createdBy: string
  createdAt: string
  promotedAt: string | null
}>

export type FinalizableUploadIntent = Readonly<{
  id: string
  companyId: string
  actorUserId: string
  purpose: EnabledImagePurpose
  quarantinePath: string
  declaredName: string
  declaredMime: string
  declaredSize: number
  cleanupNotBefore: string
}>

export type FileFinalizationState =
  | Readonly<{ kind: "ready"; file: FileObject }>
  | Readonly<{ kind: "finalizing"; intent: FinalizableUploadIntent }>

export type UploadReservationDTO = Readonly<{
  intentId: string
  quarantinePath: string
  declaredSize: number
}>

export type UploadPolicy = Readonly<{
  maxBytes: number
  declaredMimeTypes: readonly string[]
  detectedMimeTypes: readonly string[]
  detectedExtensions: readonly string[]
  transform: "reencode-image" | "preserve-validated-bytes"
  outputMime: string
  outputExtension: string
}>

export type ValidatedFile = Readonly<{
  detectedMime: string
  extension: string
  byteSize: number
  sha256: string
}>
