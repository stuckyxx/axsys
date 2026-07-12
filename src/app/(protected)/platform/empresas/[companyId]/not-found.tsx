import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function CompanyNotFound() {
  return <div className="grid min-h-[45dvh] place-items-center"><div className="max-w-md text-center"><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Não encontrada</p><h1 className="mt-3 text-2xl font-semibold">Empresa indisponível</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">O cadastro não existe ou não está disponível para este acesso.</p><Button asChild className="mt-6 h-11"><Link href="/platform/empresas">Voltar para empresas</Link></Button></div></div>
}
