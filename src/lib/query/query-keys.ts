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
