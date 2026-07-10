import type { AccessContext } from "@/modules/auth/domain/access-context"

export const platformContext: AccessContext = {
  kind: "platform",
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "90000000-0000-4000-8000-000000000001",
  authenticatedAt: 1_788_000_000,
  profile: {
    displayName: "Admin da Plataforma",
    email: "platform@example.test",
    preferredTheme: "dark",
    version: 1,
  },
}

export const companyContext: AccessContext = {
  kind: "company",
  userId: "20000000-0000-4000-8000-000000000001",
  sessionId: "90000000-0000-4000-8000-000000000002",
  authenticatedAt: 1_788_000_000,
  companyId: "30000000-0000-4000-8000-000000000001",
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "company_admin",
  modules: ["administrative", "financial", "certificates"],
  profile: {
    displayName: "Admin Empresa A",
    email: "admin-a@example.test",
    preferredTheme: "dark",
    version: 1,
  },
}
