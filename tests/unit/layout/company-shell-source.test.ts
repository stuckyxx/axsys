import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const shellPath = path.join(
  process.cwd(),
  "src/components/layout/company-shell.tsx",
)

describe("company shell authorization boundary", () => {
  it("derives navigation from the server-provided context without trusting browser events", async () => {
    const source = await readFile(shellPath, "utf8")

    expect(source).toContain("context.modules.map")
    expect(source).toContain('context.role === "company_admin"')
    expect(source).not.toMatch(/addEventListener|BroadcastChannel|payload|event\.detail/u)
    expect(source).not.toMatch(/localStorage|sessionStorage/u)
  })
})
