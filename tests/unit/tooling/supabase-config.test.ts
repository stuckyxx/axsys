import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("Supabase local configuration", () => {
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
