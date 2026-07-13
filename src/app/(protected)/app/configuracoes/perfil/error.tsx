"use client"

export default function ProfileError({ reset }: Readonly<{ reset: () => void }>) {
  return <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border p-6 text-center" role="alert"><div><h2 className="text-lg font-semibold">Não foi possível carregar seu perfil</h2><p className="mt-2 text-sm text-muted-foreground">Tente novamente sem recarregar dados antigos.</p><button className="mt-5 min-h-11 rounded-xl border border-border px-4 text-sm font-medium active:translate-y-px" onClick={reset} type="button">Tentar novamente</button></div></div>
}
