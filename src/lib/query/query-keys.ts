export type QueryScope = Readonly<{
  companyId: string | null
  userId: string
}>

export const queryKeys = Object.freeze({
  root: (scope: QueryScope) =>
    ["axsys", scope.userId, scope.companyId ?? "platform"] as const,
  resource: (
    scope: QueryScope,
    resource: string,
    ...parts: readonly unknown[]
  ) => [...queryKeys.root(scope), resource, ...parts] as const,
})

const administrativeRoot = (userId: string, companyId: string) =>
  ["axsys", userId, companyId, "administrative"] as const

export type AdministrativeListKey = Readonly<{
  q?: string
  segment?: string
  status?: string
  archived?: boolean
  itemKind?: "service" | "product"
  clientId?: string
  cursor?: string | null
  limit?: number
}>

export const administrativeKeys = Object.freeze({
  root: administrativeRoot,
  clients: (userId: string, companyId: string) =>
    [...administrativeRoot(userId, companyId), "clients"] as const,
  clientList: (
    userId: string,
    companyId: string,
    filters: AdministrativeListKey,
  ) =>
    [
      ...administrativeKeys.clients(userId, companyId),
      "list",
      filters,
    ] as const,
  client: (userId: string, companyId: string, clientId: string) =>
    [
      ...administrativeRoot(userId, companyId),
      "clients",
      clientId,
    ] as const,
  catalog: (userId: string, companyId: string) =>
    [...administrativeRoot(userId, companyId), "catalog-items"] as const,
  catalogList: (
    userId: string,
    companyId: string,
    filters: AdministrativeListKey,
  ) =>
    [
      ...administrativeKeys.catalog(userId, companyId),
      "list",
      filters,
    ] as const,
  catalogItem: (userId: string, companyId: string, itemId: string) =>
    [
      ...administrativeRoot(userId, companyId),
      "catalog-items",
      itemId,
    ] as const,
  proposals: (userId: string, companyId: string) =>
    [...administrativeRoot(userId, companyId), "proposals"] as const,
  proposalList: (
    userId: string,
    companyId: string,
    filters: AdministrativeListKey,
  ) =>
    [
      ...administrativeKeys.proposals(userId, companyId),
      "list",
      filters,
    ] as const,
  proposal: (userId: string, companyId: string, proposalId: string) =>
    [
      ...administrativeRoot(userId, companyId),
      "proposals",
      proposalId,
    ] as const,
  proposalDocuments: (
    userId: string,
    companyId: string,
    proposalId: string,
  ) =>
    [
      ...administrativeRoot(userId, companyId),
      "proposals",
      proposalId,
      "documents",
    ] as const,
  contracts: (userId: string, companyId: string) =>
    [...administrativeRoot(userId, companyId), "contracts"] as const,
  contractList: (
    userId: string,
    companyId: string,
    filters: AdministrativeListKey,
  ) =>
    [
      ...administrativeKeys.contracts(userId, companyId),
      "list",
      filters,
    ] as const,
  contract: (userId: string, companyId: string, contractId: string) =>
    [
      ...administrativeRoot(userId, companyId),
      "contracts",
      contractId,
    ] as const,
  contractAttachments: (
    userId: string,
    companyId: string,
    contractId: string,
  ) =>
    [
      ...administrativeRoot(userId, companyId),
      "contracts",
      contractId,
      "attachments",
    ] as const,
})
