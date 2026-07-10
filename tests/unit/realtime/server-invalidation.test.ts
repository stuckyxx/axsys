import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  noOpInvalidationPublisher,
  type InvalidationEvent,
  type InvalidationScope,
  type ServerInvalidationPublisher,
} from "@/lib/realtime/server-invalidation"

describe("server invalidation contract", () => {
  it("defines the exact nullable scope and readonly resource event", () => {
    expectTypeOf<InvalidationScope>().toEqualTypeOf<{
      userId: string
      companyId: string | null
    }>()
    expectTypeOf<InvalidationEvent>().toEqualTypeOf<{
      scope: InvalidationScope
      resources: readonly string[]
      correlationId: string
    }>()
    expectTypeOf<ServerInvalidationPublisher["publish"]>().returns.toEqualTypeOf<
      Promise<void>
    >()
  })

  it("provides a no-op publisher without database or realtime dependencies", async () => {
    const event: InvalidationEvent = {
      scope: { userId: "user-id", companyId: null },
      resources: ["session"],
      correlationId: "correlation-id",
    }

    await expect(noOpInvalidationPublisher.publish(event)).resolves.toBeUndefined()

    const source = readFileSync(resolve("src/lib/realtime/server-invalidation.ts"), "utf8")
    expect(source).not.toMatch(/from\s+["'](?:postgres|@supabase\/supabase-js)["']/u)
  })
})
