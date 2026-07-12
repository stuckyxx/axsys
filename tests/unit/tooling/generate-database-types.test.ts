import { describe, expect, it } from "vitest"
import { postprocessDatabaseTypes } from "../../../scripts/generate-database-types"

const generatedFixture = `export type Database = {
  public: {
    Tables: {
      company_settings: {
        Row: {
          company_id: string
          consolidated_address: string | null
        }
        Insert: {
          company_id: string
          consolidated_address?: string | null
          updated_by: string
        }
        Update: {
          company_id?: string
          consolidated_address?: string | null
          updated_by?: string
        }
        Relationships: []
      }
    }
  }
}
`

describe("database type generation", () => {
  it("makes allowlisted GENERATED ALWAYS columns unwriteable", () => {
    const processed = postprocessDatabaseTypes(generatedFixture)

    expect(processed).toContain("consolidated_address: string | null")
    expect(processed.match(/consolidated_address\?: never/gu)).toHaveLength(2)
    expect(processed).not.toContain("consolidated_address?: string | null")
    expect(processed.endsWith("\n")).toBe(true)
    expect(processed.endsWith("\n\n")).toBe(false)
  })

  it("fails closed when the generated contract no longer matches the allowlist", () => {
    expect(() =>
      postprocessDatabaseTypes(generatedFixture.replace("consolidated_address?: string | null", "")),
    ).toThrow(/company_settings\.Insert\.consolidated_address/u)
  })
})
