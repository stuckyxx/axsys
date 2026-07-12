import { Buffer } from "node:buffer"
import { loadEnvFile } from "node:process"

import { describe, expect, it } from "vitest"

import { getClamAvScanner } from "@/modules/files/server/clamav-client"

for (const file of [".env.local", ".env.test.local"]) {
  try {
    loadEnvFile(file)
  } catch {
    // CI may inject the complete file-service environment directly.
  }
}

describe("local ClamAV integration", () => {
  it("accepts a clean byte stream", async () => {
    await expect(
      getClamAvScanner().scan(Buffer.from("Axsys clean scanner probe", "utf8")),
    ).resolves.toBe("clean")
  })

  it("detects the standard non-malicious EICAR test signature", async () => {
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      "ascii",
    )

    await expect(getClamAvScanner().scan(eicar)).resolves.toBe("infected")
  })
})
