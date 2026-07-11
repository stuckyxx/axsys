import { describe, expect, it } from "vitest"

import {
  requireLocalHttpUrl,
  requireLocalOwnerDatabaseUrl,
} from "../../helpers/local-destructive-urls"

describe("local destructive fixture URL guard", () => {
  it("accepts only canonical loopback HTTP origins", () => {
    expect(
      requireLocalHttpUrl("http://127.0.0.1:54321", "54321", "fixture"),
    ).toBe("http://127.0.0.1:54321/")
    expect(
      requireLocalHttpUrl("http://[::1]:3000/", "3000", "fixture"),
    ).toBe("http://[::1]:3000/")

    for (const unsafe of [
      "https://127.0.0.1:54321/",
      "http://user:secret@127.0.0.1:54321/",
      "http://127.0.0.1:54321/rest/v1",
      "http://127.0.0.1:54321/?target=production",
      "http://example.com:54321/",
      "http://127.0.0.1:54322/",
    ]) {
      expect(() => requireLocalHttpUrl(unsafe, "54321", "fixture")).toThrow(
        "fixture is unavailable",
      )
    }
  })

  it("accepts only the local postgres owner database", () => {
    expect(
      requireLocalOwnerDatabaseUrl(
        "postgresql://postgres:local-secret@127.0.0.1:54322/postgres",
        "fixture",
      ),
    ).toBe("postgresql://postgres:local-secret@127.0.0.1:54322/postgres")

    for (const unsafe of [
      "postgresql://app_user:local-secret@127.0.0.1:54322/postgres",
      "postgresql://postgres@127.0.0.1:54322/postgres",
      "postgresql://postgres:local-secret@127.0.0.1:54322/template1",
      "postgresql://postgres:local-secret@example.com:54322/postgres",
      "postgresql://postgres:local-secret@127.0.0.1:5432/postgres",
      "postgresql://postgres:local-secret@127.0.0.1:54322/postgres?sslmode=require",
      "http://postgres:local-secret@127.0.0.1:54322/postgres",
    ]) {
      expect(() => requireLocalOwnerDatabaseUrl(unsafe, "fixture")).toThrow(
        "fixture is unavailable",
      )
    }
  })
})
