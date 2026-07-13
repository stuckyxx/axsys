"use client"

import { AdministrativeUnavailableState } from "@/modules/administrative/ui/administrative-screen-states"

export default function AdministrativeClientsError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <div className="space-y-5">
      <AdministrativeUnavailableState correlationId={error.digest ?? "indisponível"} />
      <button
        className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={reset}
        type="button"
      >
        Tentar novamente
      </button>
    </div>
  )
}
