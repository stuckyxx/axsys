"use client"

import { Button } from "@/components/ui/button"
import { AdministrativeUnavailableState } from "@/modules/administrative/ui/administrative-screen-states"

export default function AdministrativeCatalogError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <div className="space-y-5">
      <AdministrativeUnavailableState
        correlationId={error.digest ?? "indisponível"}
      />
      <Button className="min-h-11" onClick={reset} type="button" variant="outline">
        Tentar novamente
      </Button>
    </div>
  )
}
