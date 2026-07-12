import { describe, expect, it } from "vitest"

import nextConfig from "../../../next.config"

describe("Next.js local security and freshness configuration", () => {
  it("disables the dev debug persistence channel and server-component HMR cache", () => {
    expect(nextConfig.experimental).toMatchObject({
      reactDebugChannel: false,
      serverComponentsHmrCache: false,
    })
  })
})
