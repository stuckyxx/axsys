import { describe, expect, it } from "vitest"

import { buildClientPrefixFilter } from "@/modules/administrative/server/client-repository"

describe("client prefix search", () => {
  it.each([
    ["100% Legal", "100\\\\% legal*"],
    ["Nome_Composto", "nome\\\\_composto*"],
    ["Órgão, Norte", "órgão, norte*"],
    ["Órgão (Norte)", "órgão (norte)*"],
    ['Órgão "Norte"', 'órgão \\"norte\\"*'],
    ["Órgão \\ Norte", "órgão \\\\\\\\ norte*"],
  ])("quotes and escapes PostgREST prefix input %s", (input, escaped) => {
    const filter = buildClientPrefixFilter(input)

    expect(filter).toContain(`legal_name.ilike."${escaped}"`)
    expect(filter).toContain(`trade_name.ilike."${escaped}"`)
    expect(filter).not.toContain("% Legal")
  })

  it("adds a normalized digit-only CNPJ prefix without leading wildcard", () => {
    expect(buildClientPrefixFilter("04.252")).toContain(
      "cnpj_normalized.like.04252*",
    )
    expect(buildClientPrefixFilter("04.252")).not.toContain("like.*04252")
  })
})
