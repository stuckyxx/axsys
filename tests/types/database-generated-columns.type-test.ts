import type { Database } from "../../src/lib/supabase/database.types"

type CompanySettingsInsert = Database["public"]["Tables"]["company_settings"]["Insert"]
type CompanySettingsUpdate = Database["public"]["Tables"]["company_settings"]["Update"]

const validInsert: CompanySettingsInsert = {
  company_id: "30000000-0000-4000-8000-000000000001",
  updated_by: "20000000-0000-4000-8000-000000000001",
}
const validUpdate: CompanySettingsUpdate = { representative_name: "Representante" }

// @ts-expect-error GENERATED ALWAYS columns are read-only at the database boundary.
const invalidInsert: CompanySettingsInsert = { ...validInsert, consolidated_address: "forged" }
// @ts-expect-error GENERATED ALWAYS columns are read-only at the database boundary.
const invalidUpdate: CompanySettingsUpdate = { consolidated_address: null }

void validInsert
void validUpdate
void invalidInsert
void invalidUpdate
