import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("Supabase local configuration", () => {
  it("fails the recovery migration closed on forgot-policy drift", () => {
    const migration = readFileSync(
      resolve("supabase/migrations/20260711160300_password_recovery_saga.sql"),
      "utf8",
    )

    expect(migration).toContain("AXSYS_FORGOT_RATE_POLICY_DRIFT")
    expect(migration).toMatch(/get diagnostics\s+v_updated_policy_count\s*=\s*row_count/iu)
    expect(migration).toMatch(/v_updated_policy_count\s*<>\s*2/iu)
    expect(migration).toContain("('forgot-ip-volume', 10, 900, 60, false)")
    expect(migration).toContain("('forgot-account-volume', 3, 3600, 60, false)")
  })

  it("keeps default exposure denied and recovery RPC grant order-independent", () => {
    const config = readFileSync(resolve("supabase/config.toml"), "utf8")
    const roles = readFileSync(resolve("supabase/roles.sql"), "utf8")
    const provisioner = readFileSync(resolve("scripts/provision-local-env.ts"), "utf8")
    const seed = readFileSync(resolve("supabase/seed.sql"), "utf8")
    const api = config.match(/\[api\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(api).not.toMatch(
      /^[ \t]*auto_expose_new_tables[ \t]*=[ \t]*true(?:[ \t]*(?:#.*)?)?$/mu,
    )
    expect(roles).toMatch(
      /to_regprocedure\(\s*'public\.issue_password_recovery_grant\(text\)'\s*\)/u,
    )
    for (const regrantSource of [roles, provisioner]) {
      expect(regrantSource).toContain("v_recovery_function_oid")
      expect(regrantSource).toContain("v_recovery_signature")
      expect(regrantSource).toContain("password recovery RPC catalog assertion failed")
      expect(regrantSource).toContain("owner_role.rolname = 'postgres'")
      expect(regrantSource).toContain("function.prosecdef")
      expect(regrantSource).toContain("not function.proretset")
      expect(regrantSource).toContain("function.prorettype = 'timestamptz'::regtype")
      expect(regrantSource).toContain(
        "function.proconfig = array['search_path=" + '""' + "']::text[]",
      )
      expect(regrantSource).toContain("from public, anon, authenticated, service_role, axsys_bff")
      expect(regrantSource).toContain("to authenticated")
    }
    expect(seed).not.toMatch(/\bgrant\b/iu)
  })

  it("enables email sign-in for admin-created users while public signup stays disabled", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const auth = source.match(/\[auth\][\s\S]*?(?=\n\[|$)/u)?.[0]
    const email = source.match(/\[auth\.email\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(auth).toMatch(/\nenable_signup = false\n/u)
    expect(email).toMatch(/\nenable_signup = true\n/u)
    expect(email).toMatch(/\nenable_confirmations = true\n/u)
  })

  it("allowlists only the exact local password-recovery callback", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const auth = source.match(/\[auth\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(auth).toContain(
      '"http://127.0.0.1:3000/auth/callback?next=/reset-password"',
    )
    expect(auth).not.toContain('"http://127.0.0.1:3000/auth/callback",')
    expect(auth).not.toContain('"http://127.0.0.1:3000/reset-password",')
  })

  it("keeps out-of-scope analytics disabled for Colima socket compatibility", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const analytics = source.match(/\[analytics\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(analytics).toContain("# Disabled locally because Vector requires a Docker socket bind unsupported by Colima.")
    expect(analytics).toMatch(/\nenabled = false\n/u)
  })

  it("keeps optional Storage Vector buckets disabled during the PG17 cold start", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const storageVector = source.match(/\[storage\.vector\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(storageVector).toContain(
      "# Disabled locally because optional Vector bucket migrations exceed the CLI cold-start wait.",
    )
    expect(storageVector).toMatch(/\nenabled = false\n/u)
  })

  it("keeps the unused Edge Runtime disabled for the Next.js BFF architecture", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const edgeRuntime = source.match(/\[edge_runtime\][\s\S]*?(?=\n\[|$)/u)?.[0]

    expect(edgeRuntime).toContain(
      "# Disabled locally because Axsys uses the Next.js BFF and has no Edge Functions.",
    )
    expect(edgeRuntime).toMatch(/\nenabled = false\n/u)
  })

  it("keeps image transformation explicitly disabled", () => {
    const source = readFileSync(resolve("supabase/config.toml"), "utf8")
    const transformation = source.match(
      /(?:^|\n)(\[storage\.image_transformation\][\s\S]*?)(?=\n\[|$)/u,
    )?.[1]

    expect(transformation).toContain(
      "# Disabled locally because Axsys does not use image transformation.",
    )
    expect(transformation).toMatch(/\nenabled = false\n/u)
  })
})
