export type CompanyRole = "company_admin" | "member"
export type ModuleKey = "administrative" | "financial" | "certificates"
export type ThemePreference = "dark" | "light"

export type ProfileSummary = Readonly<{
  displayName: string
  email: string
  preferredTheme: ThemePreference
  version: number
}>

export type AccessContext =
  | Readonly<{
      kind: "platform"
      userId: string
      sessionId: string
      authenticatedAt: number
      profile: ProfileSummary
    }>
  | Readonly<{
      kind: "company"
      userId: string
      sessionId: string
      authenticatedAt: number
      companyId: string
      membershipId: string
      role: CompanyRole
      modules: readonly ModuleKey[]
      profile: ProfileSummary
    }>
