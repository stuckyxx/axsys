import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe("resumable upload browser boundary", () => {
  it("keeps TUS capability state memory-only and never imports a browser session", () => {
    const source = readFileSync(
      resolve("src/modules/files/ui/use-resumable-upload.ts"),
      "utf8",
    )

    expect(source).toContain("storeFingerprintForResuming: false")
    expect(source).toContain("removeFingerprintOnSuccess: true")
    expect(source).toContain("urlStorage: null as never")
    expect(source).toContain('"x-upsert": "false"')
    expect(source).toContain('cacheControl: "0"')
    expect(source).not.toMatch(/findPreviousUploads|getSession|service[_-]?role/iu)
    expect(source).not.toMatch(/localStorage|sessionStorage/iu)
  })
})
