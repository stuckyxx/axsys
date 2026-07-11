import { readFile } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  assertAuthSession: vi.fn(),
  createServerSupabase: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({
  bffDb: { assertAuthSession: mocks.assertAuthSession },
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}))

import {
  getAccessContext,
  type AccessResolution,
} from "@/modules/auth/server/get-access-context"

const NOW = new Date("2026-07-11T12:00:00.000Z")
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000)
const USER_ID = "11111111-1111-4111-8111-111111111111"
const SESSION_ID = "22222222-2222-4222-8222-222222222222"
const COMPANY_ID = "33333333-3333-4333-8333-333333333333"
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444"

type TableName =
  | "profiles"
  | "platform_roles"
  | "company_memberships"
  | "companies"
  | "member_modules"

type QueryResult = { data: unknown; error: unknown }
type QueryRecord = {
  table: TableName
  columns?: string
  filters: Array<[column: string, value: unknown]>
}

const PROFILE = {
  email: "user@example.test",
  display_name: "Pessoa Teste",
  preferred_theme: "dark",
  must_change_password: false,
  temporary_password_expires_at: null,
  is_active: true,
  version: 3,
}

const PLATFORM_ROLE = { role: "super_admin", is_active: true }
const MEMBERSHIP = {
  id: MEMBERSHIP_ID,
  company_id: COMPANY_ID,
  role: "company_admin",
  status: "active",
}

function result(data: unknown, error: unknown = null): QueryResult {
  return { data, error }
}

function claimsResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      claims: {
        sub: USER_ID,
        session_id: SESSION_ID,
        amr: [{ method: "password", timestamp: NOW_SECONDS - 30 }],
        ...overrides,
      },
    },
    error: null,
  }
}

function createClient(options?: {
  claims?: unknown
  tables?: Partial<Record<TableName, QueryResult>>
}) {
  const tableResults: Record<TableName, QueryResult> = {
    profiles: result(PROFILE),
    platform_roles: result(PLATFORM_ROLE),
    company_memberships: result(MEMBERSHIP),
    companies: result({ status: "active" }),
    member_modules: result([{ module: "financial" }]),
    ...options?.tables,
  }
  const queries: QueryRecord[] = []
  const getClaims = vi
    .fn()
    .mockResolvedValue(options?.claims ?? claimsResponse())
  const from = vi.fn((table: TableName) => {
    const query: QueryRecord = { table, filters: [] }
    queries.push(query)

    const builder = {
      select(columns: string) {
        query.columns = columns
        return builder
      },
      eq(column: string, value: unknown) {
        query.filters.push([column, value])
        return builder
      },
      maybeSingle: vi.fn(async () => tableResults[table]),
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(tableResults[table]).then(onfulfilled, onrejected)
      },
    }

    return builder
  })
  const client = { auth: { getClaims }, from }
  mocks.createServerSupabase.mockResolvedValue(client)

  return { client, getClaims, queries }
}

function expectAnonymous(resolution: AccessResolution) {
  expect(resolution).toEqual({ status: "anonymous" })
}

describe("getAccessContext", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mocks.assertAuthSession.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("has a zero-argument, cookie-bound production contract", async () => {
    expectTypeOf<Parameters<typeof getAccessContext>>().toEqualTypeOf<[]>()
    expect(getAccessContext).toHaveLength(0)

    const source = await readFile(
      new URL(
        "../../../src/modules/auth/server/get-access-context.ts",
        import.meta.url,
      ),
      "utf8",
    )
    expect(source).not.toMatch(/providedClient|createAdminSupabase|service[_-]role/i)
  })

  it("fails closed if the cookie-bound client cannot be created", async () => {
    mocks.createServerSupabase.mockRejectedValueOnce(new Error("cookies unavailable"))

    expectAnonymous(await getAccessContext())
    expect(mocks.assertAuthSession).not.toHaveBeenCalled()
  })

  it.each([
    ["claim verification error", { data: null, error: { message: "invalid JWT" } }],
    [
      "malformed claim error sentinel",
      { data: claimsResponse().data, error: undefined },
    ],
    ["missing claims", { data: { claims: null }, error: null }],
    ["invalid subject UUID", claimsResponse({ sub: "not-a-uuid" })],
    ["invalid session UUID", claimsResponse({ session_id: "not-a-uuid" })],
    ["anonymous Auth user", claimsResponse({ is_anonymous: true })],
    ["malformed anonymous flag", claimsResponse({ is_anonymous: "false" })],
  ])("treats %s as anonymous before database access", async (_name, claims) => {
    const { client } = createClient({ claims })

    expectAnonymous(await getAccessContext())
    expect(mocks.assertAuthSession).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it("fails closed when getClaims throws", async () => {
    const { getClaims, client } = createClient()
    getClaims.mockRejectedValueOnce(new Error("Auth unavailable"))

    expectAnonymous(await getAccessContext())
    expect(mocks.assertAuthSession).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it.each([
    "pending activation",
    "revoked session",
    "absolute expiry",
    "inactivity cutoff",
    "Auth/session mismatch",
    "deleted control row",
  ])("maps a failed BFF attestation (%s) to anonymous", async () => {
    const { client } = createClient()
    mocks.assertAuthSession.mockResolvedValueOnce(false)

    expectAnonymous(await getAccessContext())
    expect(mocks.assertAuthSession).toHaveBeenCalledWith(SESSION_ID, USER_ID)
    expect(client.from).not.toHaveBeenCalled()
  })

  it("fails closed when BFF attestation throws", async () => {
    const { client } = createClient()
    mocks.assertAuthSession.mockRejectedValueOnce(new Error("BFF unavailable"))

    expectAnonymous(await getAccessContext())
    expect(client.from).not.toHaveBeenCalled()
  })

  it("requires an exact boolean true BFF attestation", async () => {
    const { client } = createClient()
    mocks.assertAuthSession.mockResolvedValueOnce(
      "true" as unknown as boolean,
    )

    expectAnonymous(await getAccessContext())
    expect(client.from).not.toHaveBeenCalled()
  })

  it("rechecks the BFF session on every resolution without caching revocation", async () => {
    const { getClaims } = createClient()
    mocks.assertAuthSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(getAccessContext()).resolves.toMatchObject({
      status: "authenticated",
    })
    expectAnonymous(await getAccessContext())
    expect(getClaims).toHaveBeenCalledTimes(2)
    expect(mocks.assertAuthSession).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["query error", result(null, { code: "PGRST500" })],
    ["malformed error sentinel", { data: PROFILE, error: undefined }],
    ["missing row", result(null)],
    ["array/cardinality mismatch", result([PROFILE])],
    ["inactive profile", result({ ...PROFILE, is_active: false })],
    ["invalid theme", result({ ...PROFILE, preferred_theme: "system" })],
    ["invalid version", result({ ...PROFILE, version: 1.5 })],
    ["invalid email", result({ ...PROFILE, email: "not-an-email" })],
  ])("rejects a profile with %s", async (_name, profileResult) => {
    createClient({ tables: { profiles: profileResult } })
    expectAnonymous(await getAccessContext())
  })

  it.each([
    [null, true],
    ["not-a-date", true],
    ["2026-07-11T11:59:59.999Z", true],
    ["2026-07-11T12:00:00.000Z", true],
    ["2026-07-11T12:00:00.001Z", false],
  ])(
    "derives forced-password expiry solely from the profile value %s",
    async (temporaryPasswordExpiresAt, expired) => {
      const { client } = createClient({
        claims: claimsResponse({
          must_change_password: false,
          temporary_password_expires_at: "2099-01-01T00:00:00Z",
        }),
        tables: {
          profiles: result({
            ...PROFILE,
            must_change_password: true,
            temporary_password_expires_at: temporaryPasswordExpiresAt,
          }),
        },
      })

      await expect(getAccessContext()).resolves.toEqual({
        status: "password_change",
        userId: USER_ID,
        expired,
      })
      expect(client.from).toHaveBeenCalledTimes(1)
      expect(client.from).toHaveBeenCalledWith("profiles")
    },
  )

  it("fails closed when forced-password expiry cannot read the runtime clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.NaN)
    createClient({
      tables: {
        profiles: result({
          ...PROFILE,
          must_change_password: true,
          temporary_password_expires_at: "2099-01-01T00:00:00.000Z",
        }),
      },
    })

    await expect(getAccessContext()).resolves.toEqual({
      status: "password_change",
      userId: USER_ID,
      expired: true,
    })
  })

  it("builds and deeply freezes a platform context from validated rows", async () => {
    const { queries } = createClient()

    const resolution = await getAccessContext()
    expect(resolution).toEqual({
      status: "authenticated",
      context: {
        kind: "platform",
        userId: USER_ID,
        sessionId: SESSION_ID,
        authenticatedAt: NOW_SECONDS - 30,
        profile: {
          displayName: "Pessoa Teste",
          email: "user@example.test",
          preferredTheme: "dark",
          version: 3,
        },
      },
    })
    expect(Object.isFrozen(resolution)).toBe(true)
    if (resolution.status === "authenticated") {
      expect(Object.isFrozen(resolution.context)).toBe(true)
      expect(Object.isFrozen(resolution.context.profile)).toBe(true)
    }
    expect(queries).toEqual([
      {
        table: "profiles",
        columns:
          "email,display_name,preferred_theme,must_change_password,temporary_password_expires_at,is_active,version",
        filters: [["user_id", USER_ID]],
      },
      {
        table: "platform_roles",
        columns: "role,is_active",
        filters: [["user_id", USER_ID]],
      },
    ])
  })

  it.each([
    ["missing AMR", undefined, 0],
    ["string AMR", "password", 0],
    ["wrong method", [{ method: "oauth", timestamp: NOW_SECONDS - 1 }], 0],
    ["missing method", [{ timestamp: NOW_SECONDS - 1 }], 0],
    ["string timestamp", [{ method: "password", timestamp: `${NOW_SECONDS}` }], 0],
    ["fractional timestamp", [{ method: "password", timestamp: NOW_SECONDS - 0.5 }], 0],
    ["negative timestamp", [{ method: "password", timestamp: -1 }], 0],
    ["infinite timestamp", [{ method: "password", timestamp: Number.POSITIVE_INFINITY }], 0],
    ["far-future timestamp", [{ method: "password", timestamp: NOW_SECONDS + 61 }], 0],
    ["future within skew", [{ method: "password", timestamp: NOW_SECONDS + 60 }], NOW_SECONDS],
    [
      "latest valid password entry",
      [
        { method: "password", timestamp: NOW_SECONDS - 50 },
        { method: "oauth", timestamp: NOW_SECONDS - 1 },
        { method: "password", timestamp: NOW_SECONDS - 10 },
      ],
      NOW_SECONDS - 10,
    ],
  ])("derives authentication time from %s", async (_name, amr, expected) => {
    createClient({
      claims: claimsResponse({ amr, authenticatedAt: NOW_SECONDS + 10_000 }),
    })

    const resolution = await getAccessContext()
    expect(resolution).toMatchObject({
      status: "authenticated",
      context: { authenticatedAt: expected },
    })
  })

  it("fails closed when AMR recency cannot read the runtime clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.NaN)
    createClient()

    const resolution = await getAccessContext()
    expect(resolution).toMatchObject({
      status: "authenticated",
      context: { authenticatedAt: 0 },
    })
  })

  it("derives company, role, and sorted unique modules only from RLS rows", async () => {
    const { queries } = createClient({
      claims: claimsResponse({
        company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "super_admin",
        modules: ["administrative"],
        app_metadata: {
          companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "super_admin",
        },
        user_metadata: { modules: ["administrative"] },
      }),
      tables: {
        platform_roles: result(null),
        member_modules: result([
          { module: "certificates" },
          { module: "financial" },
          { module: "administrative" },
          { module: "financial" },
        ]),
      },
    })

    const resolution = await getAccessContext()
    expect(resolution).toMatchObject({
      status: "authenticated",
      context: {
        kind: "company",
        companyId: COMPANY_ID,
        membershipId: MEMBERSHIP_ID,
        role: "company_admin",
        modules: ["administrative", "financial", "certificates"],
      },
    })
    if (resolution.status === "authenticated" && resolution.context.kind === "company") {
      expect(Object.isFrozen(resolution)).toBe(true)
      expect(Object.isFrozen(resolution.context)).toBe(true)
      expect(Object.isFrozen(resolution.context.modules)).toBe(true)
      expect(Object.isFrozen(resolution.context.profile)).toBe(true)
    }

    expect(queries).toContainEqual({
      table: "member_modules",
      columns: "module",
      filters: [
        ["company_id", COMPANY_ID],
        ["membership_id", MEMBERSHIP_ID],
      ],
    })
  })

  it.each([
    ["platform role query", { platform_roles: result(null, { code: "PGRST500" }) }],
    ["membership query", { platform_roles: result(null), company_memberships: result(null, { code: "PGRST500" }) }],
    ["company query", { platform_roles: result(null), companies: result(null, { code: "PGRST500" }) }],
    ["module query", { platform_roles: result(null), member_modules: result(null, { code: "PGRST500" }) }],
    [
      "platform role malformed error sentinel",
      { platform_roles: { data: PLATFORM_ROLE, error: undefined } },
    ],
    [
      "membership malformed error sentinel",
      {
        platform_roles: result(null),
        company_memberships: { data: MEMBERSHIP, error: undefined },
      },
    ],
    [
      "company malformed error sentinel",
      {
        platform_roles: result(null),
        companies: { data: { status: "active" }, error: undefined },
      },
    ],
    [
      "module malformed error sentinel",
      {
        platform_roles: result(null),
        member_modules: {
          data: [{ module: "financial" }],
          error: undefined,
        },
      },
    ],
  ])("fails closed on a %s error", async (_name, tables) => {
    createClient({ tables })
    expectAnonymous(await getAccessContext())
  })

  it.each([
    ["inactive platform row", { platform_roles: result({ ...PLATFORM_ROLE, is_active: false }) }],
    ["malformed platform row", { platform_roles: result({ role: "owner", is_active: true }) }],
    ["missing membership", { platform_roles: result(null), company_memberships: result(null) }],
    ["suspended membership", { platform_roles: result(null), company_memberships: result({ ...MEMBERSHIP, status: "suspended" }) }],
    ["malformed membership role", { platform_roles: result(null), company_memberships: result({ ...MEMBERSHIP, role: "owner" }) }],
    ["archived company", { platform_roles: result(null), companies: result({ status: "archived" }) }],
    ["malformed module row", { platform_roles: result(null), member_modules: result([{ module: "root" }]) }],
  ])("fails closed for %s", async (_name, tables) => {
    createClient({ tables })
    expectAnonymous(await getAccessContext())
  })

  it.each([
    ["platform role", { platform_roles: result([PLATFORM_ROLE]) }],
    [
      "membership",
      {
        platform_roles: result(null),
        company_memberships: result([MEMBERSHIP]),
      },
    ],
    [
      "company",
      {
        platform_roles: result(null),
        companies: result([{ status: "active" }]),
      },
    ],
    [
      "module collection",
      {
        platform_roles: result(null),
        member_modules: result({ module: "financial" }),
      },
    ],
  ])("fails closed on a %s cardinality mismatch", async (_name, tables) => {
    createClient({ tables })
    expectAnonymous(await getAccessContext())
  })
})
