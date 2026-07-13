import { describe, expect, it } from "vitest"

import { canTransitionProposal } from "@/modules/proposals/domain/proposal-status"

describe("proposal status", () => {
  it.each([
    ["draft", "sent"],
    ["sent", "approved"],
    ["sent", "rejected"],
  ] as const)("allows %s to %s", (from, to) => {
    expect(canTransitionProposal(from, to)).toBe(true)
  })

  it.each([
    ["draft", "approved"],
    ["approved", "sent"],
    ["rejected", "draft"],
  ] as const)("rejects %s to %s", (from, to) => {
    expect(canTransitionProposal(from, to)).toBe(false)
  })
})
