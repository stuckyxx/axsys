export type ContractStatus = "closed" | "expired" | "expiring" | "active";

export type ContractAttachmentDTO = Readonly<{
  id: string;
  contractId: string;
  fileObjectId: string;
  attachmentGroupId: string;
  version: number;
  originalName: string;
  mime: string;
  byteSize: number;
  isCurrent: boolean;
  createdAt: string;
}>;
