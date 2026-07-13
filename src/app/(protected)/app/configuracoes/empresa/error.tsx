"use client"

import { Button } from "@/components/ui/button"

export default function CompanySettingsError({ reset }: { error: Error; reset: () => void }) {
  return <section role="alert" className="rounded-xl border p-6"><h1 className="font-semibold">Não foi possível carregar as configurações.</h1><Button className="mt-4 min-h-11" onClick={reset}>Tentar novamente</Button></section>
}
