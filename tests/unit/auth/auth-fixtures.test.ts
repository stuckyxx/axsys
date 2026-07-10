import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  AccessContext,
  ProfileSummary,
} from "@/modules/auth/domain/access-context"
import * as authFixtures from "../../helpers/auth"

type PlatformContext = Extract<AccessContext, { kind: "platform" }>
type CompanyContext = Extract<AccessContext, { kind: "company" }>
type AuthFixtureModule = typeof authFixtures & {
  createPlatformContext: () => PlatformContext
  createCompanyContext: () => CompanyContext
}

const fixtures = authFixtures as AuthFixtureModule
const TEST_CLOCK = new Date("2026-07-10T12:00:00.000Z")
const EXPECTED_AUTHENTICATED_AT_SECONDS = 1_783_684_740

function assertReadonlyContract(context: AccessContext, profile: ProfileSummary) {
  // @ts-expect-error Access context identity is immutable.
  context.userId = "changed"
  // @ts-expect-error Authentication time is immutable.
  context.authenticatedAt = 0
  // @ts-expect-error Profile fields are deeply readonly.
  profile.email = "changed@example.test"

  if (context.kind === "company") {
    // @ts-expect-error The modules property is immutable.
    context.modules = []
    // @ts-expect-error The modules collection is readonly.
    context.modules.push("financial")
  }
}

void assertReadonlyContract

function expectDeeplyFrozen(context: AccessContext) {
  expect(Object.isFrozen(context)).toBe(true)
  expect(Object.isFrozen(context.profile)).toBe(true)

  if (context.kind === "company") {
    expect(Object.isFrozen(context.modules)).toBe(true)
  }
}

describe("auth fixtures", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_CLOCK)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("uses a fixed past timestamp expressed in Unix epoch seconds", () => {
    const nowSeconds = Math.floor(Date.now() / 1_000)

    expect(authFixtures.platformContext.authenticatedAt).toBe(
      EXPECTED_AUTHENTICATED_AT_SECONDS,
    )
    expect(authFixtures.companyContext.authenticatedAt).toBe(
      EXPECTED_AUTHENTICATED_AT_SECONDS,
    )
    expect(authFixtures.platformContext.authenticatedAt).toBeLessThan(nowSeconds)
    expect(authFixtures.companyContext.authenticatedAt).toBeLessThan(nowSeconds)
  })

  it("returns fresh, deeply frozen context graphs from each factory", () => {
    expect(typeof fixtures.createPlatformContext).toBe("function")
    expect(typeof fixtures.createCompanyContext).toBe("function")

    const firstPlatform = fixtures.createPlatformContext()
    const secondPlatform = fixtures.createPlatformContext()
    const firstCompany = fixtures.createCompanyContext()
    const secondCompany = fixtures.createCompanyContext()

    expect(firstPlatform).not.toBe(secondPlatform)
    expect(firstPlatform.profile).not.toBe(secondPlatform.profile)
    expect(firstCompany).not.toBe(secondCompany)
    expect(firstCompany.profile).not.toBe(secondCompany.profile)
    expect(firstCompany.modules).not.toBe(secondCompany.modules)

    for (const context of [firstPlatform, secondPlatform, firstCompany, secondCompany]) {
      expectDeeplyFrozen(context)
    }
  })

  it("keeps the backwards-compatible constants deeply frozen", () => {
    expectDeeplyFrozen(authFixtures.platformContext)
    expectDeeplyFrozen(authFixtures.companyContext)
  })
})
