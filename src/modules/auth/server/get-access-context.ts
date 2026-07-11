import "server-only"

import { z } from "zod"

import { bffDb } from "@/lib/db/bff"
import { createServerSupabase } from "@/lib/supabase/server"
import type {
  AccessContext,
  ModuleKey,
  ProfileSummary,
} from "@/modules/auth/domain/access-context"

const AUTHENTICATION_CLOCK_SKEW_SECONDS = 60
const MODULE_ORDER: readonly ModuleKey[] = [
  "administrative",
  "financial",
  "certificates",
]

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
  amr: z.unknown().optional(),
})

const profileRowSchema = z
  .object({
    email: z.string().email().max(254),
    display_name: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => value.trim().length > 0),
    preferred_theme: z.enum(["dark", "light"]),
    must_change_password: z.boolean(),
    temporary_password_expires_at: z.string().nullable(),
    is_active: z.boolean(),
    version: z.int().positive(),
  })
  .strict()

const platformRowSchema = z
  .object({
    role: z.literal("super_admin"),
    is_active: z.boolean(),
  })
  .strict()

const membershipRowSchema = z
  .object({
    id: z.uuid(),
    company_id: z.uuid(),
    role: z.enum(["company_admin", "member"]),
    status: z.enum(["active", "suspended"]),
  })
  .strict()

const companyRowSchema = z
  .object({ status: z.enum(["active", "archived"]) })
  .strict()

const moduleRowsSchema = z.array(
  z.object({ module: z.enum(MODULE_ORDER) }).strict(),
)

export type AccessResolution =
  | Readonly<{ status: "anonymous" }>
  | Readonly<{
      status: "password_change"
      userId: string
      expired: boolean
    }>
  | Readonly<{ status: "authenticated"; context: AccessContext }>

const ANONYMOUS_RESOLUTION: AccessResolution = Object.freeze({
  status: "anonymous",
})

function isTemporaryPasswordExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return true
  }

  const timestamp = Date.parse(expiresAt)
  const nowMilliseconds = Date.now()
  return (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(nowMilliseconds) ||
    nowMilliseconds <= 0 ||
    timestamp <= nowMilliseconds
  )
}

function getPasswordAuthenticatedAt(amr: unknown): number {
  if (!Array.isArray(amr)) {
    return 0
  }

  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    return 0
  }

  let latestTimestamp = 0

  for (const entry of amr) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue
    }

    const { method, timestamp } = entry as Record<string, unknown>
    if (
      method !== "password" ||
      !Number.isSafeInteger(timestamp) ||
      (timestamp as number) <= 0 ||
      (timestamp as number) > nowSeconds + AUTHENTICATION_CLOCK_SKEW_SECONDS
    ) {
      continue
    }

    latestTimestamp = Math.max(
      latestTimestamp,
      Math.min(timestamp as number, nowSeconds),
    )
  }

  return latestTimestamp
}

function createProfileSummary(
  profile: z.infer<typeof profileRowSchema>,
): ProfileSummary {
  return Object.freeze({
    displayName: profile.display_name,
    email: profile.email,
    preferredTheme: profile.preferred_theme,
    version: profile.version,
  })
}

function authenticated(context: AccessContext): AccessResolution {
  return Object.freeze({ status: "authenticated", context })
}

export async function getAccessContext(): Promise<AccessResolution> {
  try {
    const client = await createServerSupabase()
    const claimsResult = await client.auth.getClaims()
    if (claimsResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    const parsedClaims = claimsSchema.safeParse(claimsResult.data?.claims)
    if (!parsedClaims.success || parsedClaims.data.is_anonymous === true) {
      return ANONYMOUS_RESOLUTION
    }

    const claims = parsedClaims.data
    const hasActiveAppSession = await bffDb.assertAuthSession(
      claims.session_id,
      claims.sub,
    )
    if (hasActiveAppSession !== true) {
      return ANONYMOUS_RESOLUTION
    }

    const profileResult = await client
      .from("profiles")
      .select(
        "email,display_name,preferred_theme,must_change_password,temporary_password_expires_at,is_active,version",
      )
      .eq("user_id", claims.sub)
      .maybeSingle()
    if (profileResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    const parsedProfile = profileRowSchema.safeParse(profileResult.data)
    if (!parsedProfile.success || !parsedProfile.data.is_active) {
      return ANONYMOUS_RESOLUTION
    }

    const profile = parsedProfile.data
    if (profile.must_change_password) {
      return Object.freeze({
        status: "password_change",
        userId: claims.sub,
        expired: isTemporaryPasswordExpired(
          profile.temporary_password_expires_at,
        ),
      })
    }

    const authenticatedAt = getPasswordAuthenticatedAt(claims.amr)
    const profileSummary = createProfileSummary(profile)
    const platformResult = await client
      .from("platform_roles")
      .select("role,is_active")
      .eq("user_id", claims.sub)
      .maybeSingle()
    if (platformResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    if (platformResult.data !== null) {
      const parsedPlatform = platformRowSchema.safeParse(platformResult.data)
      if (!parsedPlatform.success || !parsedPlatform.data.is_active) {
        return ANONYMOUS_RESOLUTION
      }

      return authenticated(
        Object.freeze({
          kind: "platform",
          userId: claims.sub,
          sessionId: claims.session_id,
          authenticatedAt,
          profile: profileSummary,
        }),
      )
    }

    const membershipResult = await client
      .from("company_memberships")
      .select("id,company_id,role,status")
      .eq("user_id", claims.sub)
      .maybeSingle()
    if (membershipResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    const parsedMembership = membershipRowSchema.safeParse(membershipResult.data)
    if (!parsedMembership.success || parsedMembership.data.status !== "active") {
      return ANONYMOUS_RESOLUTION
    }

    const membership = parsedMembership.data
    const companyResult = await client
      .from("companies")
      .select("status")
      .eq("id", membership.company_id)
      .maybeSingle()
    if (companyResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    const parsedCompany = companyRowSchema.safeParse(companyResult.data)
    if (!parsedCompany.success || parsedCompany.data.status !== "active") {
      return ANONYMOUS_RESOLUTION
    }

    const modulesResult = await client
      .from("member_modules")
      .select("module")
      .eq("company_id", membership.company_id)
      .eq("membership_id", membership.id)
    if (modulesResult.error !== null) {
      return ANONYMOUS_RESOLUTION
    }

    const parsedModules = moduleRowsSchema.safeParse(modulesResult.data)
    if (!parsedModules.success) {
      return ANONYMOUS_RESOLUTION
    }

    const moduleSet = new Set<ModuleKey>(
      parsedModules.data.map((row) => row.module),
    )
    const modules = Object.freeze(
      MODULE_ORDER.filter((module) => moduleSet.has(module)),
    )

    return authenticated(
      Object.freeze({
        kind: "company",
        userId: claims.sub,
        sessionId: claims.session_id,
        authenticatedAt,
        companyId: membership.company_id,
        membershipId: membership.id,
        role: membership.role,
        modules,
        profile: profileSummary,
      }),
    )
  } catch {
    return ANONYMOUS_RESOLUTION
  }
}
