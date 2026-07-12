import { requirePlatformContext } from "@/modules/auth/server/guards"
import { getPlatformHealth } from "@/modules/platform/server/platform-health"
import { PlatformHealthPanel } from "@/modules/platform/ui/platform-health-panel"

export const dynamic = "force-dynamic"

export default async function PlatformHealthPage() {
  const context = await requirePlatformContext()
  const health = await getPlatformHealth({
    userId: context.userId,
    sessionId: context.sessionId,
  })
  return <section className="space-y-8" aria-labelledby="platform-health-title"><header className="border-b border-border/70 pb-7"><p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Operação</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl" id="platform-health-title">Saúde da plataforma</h1><p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted-foreground">Dependências e pendências agregadas, verificadas nesta requisição.</p></header><PlatformHealthPanel health={health} /></section>
}
