import { describe, expect, it, vi } from "vitest"

import { settleRealtimeCleanup } from "@/lib/realtime/realtime-lifecycle"

describe("Task 16 Realtime cleanup", () => {
  it("absorbs channel and client cleanup failures without skipping either", async () => {
    const channel = { topic: "protected-scope" }
    const lifecycle = {
      removeChannel: vi.fn().mockRejectedValue(new Error("remove failed")),
      dispose: vi.fn().mockRejectedValue(new Error("dispose failed")),
    }

    await expect(settleRealtimeCleanup(lifecycle, channel)).resolves.toBeUndefined()
    expect(lifecycle.removeChannel).toHaveBeenCalledWith(channel)
    expect(lifecycle.dispose).toHaveBeenCalledOnce()
  })
})
