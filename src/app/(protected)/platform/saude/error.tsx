"use client"

export default function PlatformHealthError({ reset }: Readonly<{ reset: () => void }>) {
  return <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border px-5 text-center" role="alert"><div><h2 className="text-lg font-semibold">Saúde temporariamente indisponível</h2><p className="mt-2 text-sm text-muted-foreground">A verificação não pôde ser concluída com segurança.</p><button className="mt-5 min-h-11 rounded-xl border border-border px-4 text-sm font-medium active:translate-y-px" onClick={reset} type="button">Tentar novamente</button></div></div>
}
