import type { AccessContext } from "@/modules/auth/domain/access-context"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
export type CompanySettingsAccess = "edit" | "read" | "forbidden"

export function companySettingsAccess(
  context: CompanyContext,
): CompanySettingsAccess {
  if (
    context.role === "company_admin" ||
    context.modules.includes("administrative")
  ) {
    return "edit"
  }
  return context.modules.includes("financial") ? "read" : "forbidden"
}
