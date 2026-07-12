import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlatformAuditTable } from "@/modules/audit/ui/platform-audit-table"
import { PlatformHealthPanel } from "@/modules/platform/ui/platform-health-panel"

const event = {
  id: "73000000-0000-4000-8000-000000000001",
  actorUserId: "71000000-0000-4000-8000-000000000001",
  action: "company.updated",
  resourceType: "company",
  resourceId: "74000000-0000-4000-8000-000000000001",
  outcome: "success" as const,
  reasonCode: null,
  correlationId: "75000000-0000-4000-8000-000000000001",
  metadata: { moduleCount: 2 },
  occurredAt: "2026-07-12T12:00:00.000Z",
}

describe("platform observability UI", () => {
  it("renders the audit table and mobile cards without unsafe HTML", () => {
    const { container } = render(
      <PlatformAuditTable events={[event]} nextCursor={null} />,
    )
    expect(screen.getAllByText("company.updated")).toHaveLength(2)
    expect(screen.getAllByText("Sucesso")).toHaveLength(2)
    expect(container.querySelector("script")).toBeNull()
    expect(screen.queryByText("temporaryPassword")).not.toBeInTheDocument()
  })

  it("shows a truthful audit empty state", () => {
    render(<PlatformAuditTable events={[]} nextCursor={null} />)
    expect(screen.getByText("Nenhum evento encontrado")).toBeVisible()
  })

  it("distinguishes degraded dependencies and operational backlogs", () => {
    render(<PlatformHealthPanel health={{
      checkedAt: "2026-07-12T12:00:00.000Z",
      database: "healthy",
      auth: "degraded",
      storage: "healthy",
      pendingCompensations: 2,
      pendingFileCleanup: 3,
      scanFailures: 1,
      storageBytes: 12_500,
      reservedStorageBytes: 640,
      companiesNearQuota: 2,
      quotaDriftAlerts: 0,
    }} />)
    const auth = screen.getByTestId("health-auth")
    expect(within(auth).getByText("Degradado")).toBeVisible()
    expect(screen.getByText("compensações pendentes").closest("p")).toHaveTextContent(
      "2compensações pendentes",
    )
    expect(screen.queryByRole("button", { name: /corrigir/iu })).toBeNull()
  })
})
