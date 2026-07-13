import { describe, expect, it } from "vitest"

import {
  administrativeKeys,
  queryKeys,
  type QueryScope,
} from "@/lib/query/query-keys"

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

  it("freezes administrative list and detail roots under user and tenant", () => {
    expect(administrativeKeys.clients(USER_A, COMPANY_A)).toEqual([
      "axsys",
      USER_A,
      COMPANY_A,
      "administrative",
      "clients",
    ])
    expect(administrativeKeys.client(USER_A, COMPANY_A, "client-7")).toEqual([
      "axsys",
      USER_A,
      COMPANY_A,
      "administrative",
      "clients",
      "client-7",
    ])
    expect(administrativeKeys.catalog(USER_A, COMPANY_A)).toEqual([
      "axsys",
      USER_A,
      COMPANY_A,
      "administrative",
      "catalog-items",
    ])
    expect(administrativeKeys.clientList(USER_A, COMPANY_A, {
      q: "Horizonte",
      cursor: "cursor-a",
      limit: 25,
    })).toEqual([
      "axsys",
      USER_A,
      COMPANY_A,
      "administrative",
      "clients",
      "list",
      { q: "Horizonte", cursor: "cursor-a", limit: 25 },
    ])
    expect(administrativeKeys.clientList(USER_A, COMPANY_A, {
      q: "Horizonte",
      cursor: "cursor-b",
      limit: 25,
    })).not.toEqual(administrativeKeys.clientList(USER_A, COMPANY_A, {
      q: "Horizonte",
      cursor: "cursor-a",
      limit: 25,
    }))
  })
})
