import type { AccessContext } from "@/modules/auth/domain/access-context"

type PlatformContext = Extract<AccessContext, { kind: "platform" }>
type CompanyContext = Extract<AccessContext, { kind: "company" }>

// Unix epoch seconds for 2026-07-10T11:59:00Z, one minute before the fixed test clock.
export const FIXTURE_AUTHENTICATED_AT_SECONDS = 1_783_684_740

export function createPlatformContext(): PlatformContext {
  return Object.freeze({
    kind: "platform",
    userId: "10000000-0000-4000-8000-000000000001",
    sessionId: "90000000-0000-4000-8000-000000000001",
    authenticatedAt: FIXTURE_AUTHENTICATED_AT_SECONDS,
    profile: Object.freeze({
      displayName: "Admin da Plataforma",
      email: "platform@example.test",
      preferredTheme: "dark",
      version: 1,
    }),
  })
}

export function createCompanyContext(): CompanyContext {
  return Object.freeze({
    kind: "company",
    userId: "20000000-0000-4000-8000-000000000001",
    sessionId: "90000000-0000-4000-8000-000000000002",
    authenticatedAt: FIXTURE_AUTHENTICATED_AT_SECONDS,
    companyId: "30000000-0000-4000-8000-000000000001",
    membershipId: "40000000-0000-4000-8000-000000000001",
    role: "company_admin",
    modules: Object.freeze(["administrative", "financial", "certificates"] as const),
    profile: Object.freeze({
      displayName: "Admin Empresa A",
      email: "admin-a@example.test",
      preferredTheme: "dark",
      version: 1,
    }),
  })
}

export const platformContext: AccessContext = createPlatformContext()
export const companyContext: AccessContext = createCompanyContext()
