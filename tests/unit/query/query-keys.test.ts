import { describe, expect, it } from "vitest"

import { queryKeys, type QueryScope } from "@/lib/query/query-keys"

const USER_A = "10000000-0000-4000-8000-000000000001"
const USER_B = "20000000-0000-4000-8000-000000000002"
const COMPANY_A = "30000000-0000-4000-8000-000000000003"
const COMPANY_B = "40000000-0000-4000-8000-000000000004"

describe("Task 16 scoped query keys", () => {
  it("isolates users, companies, and the platform root", () => {
    const companyA: QueryScope = { userId: USER_A, companyId: COMPANY_A }
    const companyB: QueryScope = { userId: USER_A, companyId: COMPANY_B }
    const otherUser: QueryScope = { userId: USER_B, companyId: COMPANY_A }
    const platform: QueryScope = { userId: USER_A, companyId: null }

    expect(queryKeys.root(companyA)).toEqual(["axsys", USER_A, COMPANY_A])
    expect(queryKeys.root(companyB)).not.toEqual(queryKeys.root(companyA))
    expect(queryKeys.root(otherUser)).not.toEqual(queryKeys.root(companyA))
    expect(queryKeys.root(platform)).toEqual(["axsys", USER_A, "platform"])
  })

  it("keeps a resource and all detail parts under its authenticated root", () => {
    const scope: QueryScope = { userId: USER_A, companyId: COMPANY_A }

    expect(queryKeys.resource(scope, "clients", "detail", "client-7")).toEqual([
      "axsys",
      USER_A,
      COMPANY_A,
      "clients",
      "detail",
      "client-7",
    ])
  })
})
