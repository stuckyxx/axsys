import { readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { describe, expect, expectTypeOf, it } from "vitest"
import { bffDb, type RateLimitDecision } from "@/lib/db/bff"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

describe("bffDb boundary", () => {
  it("exports only the four typed domain operations", () => {
    expect(Object.keys(bffDb).sort()).toEqual([
      "assertAuthSession",
      "clearRateLimit",
      "consumeRateLimit",
      "registerAuthSession",
    ])

    expectTypeOf<RateLimitDecision>().toEqualTypeOf<{
      allowed: boolean
      attempts: number
      retryAfterSeconds: number
    }>()
    expectTypeOf(bffDb.consumeRateLimit).returns.toEqualTypeOf<
      Promise<RateLimitDecision>
    >()
    expectTypeOf(bffDb.clearRateLimit).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf(bffDb.registerAuthSession).returns.toEqualTypeOf<Promise<string>>()
    expectTypeOf(bffDb.assertAuthSession).returns.toEqualTypeOf<Promise<boolean>>()
  })

  it("keeps the SQL client private and uses static private function names", () => {
    const facadePath = resolve("src/lib/db/bff.ts")
    const source = readFileSync(facadePath, "utf8")

    expect(source).not.toMatch(/export\s+(?:const|function|let|var)\s+(?:getSql|sql)/u)
    expect(source).not.toMatch(/\b(?:unsafe|transaction|begin|reserve|execute|query|call)\s*:/u)
    expect(source).not.toContain(".unsafe(")
    expect(source).toContain("private.consume_rate_limit(")
    expect(source).toContain("private.clear_rate_limit(")
    expect(source).toContain("private.register_auth_session(")
    expect(source).toContain("private.assert_auth_session(")
  })

  it("is the only application source allowed to import postgres", () => {
    const facadePath = resolve("src/lib/db/bff.ts")
    const violations = sourceFiles(resolve("src")).filter((path) => {
      if (path === facadePath) return false
      return /from\s+["']postgres["']/u.test(readFileSync(path, "utf8"))
    })

    expect(violations).toEqual([])
  })
})
