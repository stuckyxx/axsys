import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe("Task 11 BFF JSON metadata binding", () => {
  it("binds metadata objects directly for both audited event writers", () => {
    const source = readFileSync(resolve("src/lib/db/bff.ts"), "utf8")
    const directBindings =
      source.match(/\$\{sql\.json\(metadata\)\}::jsonb/gu) ?? []

    expect(directBindings).toHaveLength(2)
    expect(source).not.toContain("JSON.stringify(input.metadata)")
    expect(source).toContain("toJsonObject(input.metadata)")
  })
})
