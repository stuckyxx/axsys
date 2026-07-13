import { requirePlatformContext } from "@/modules/auth/server/guards"
import { getOwnProfile } from "@/modules/settings/server/profile-service"
import { ProfileForm } from "@/modules/settings/ui/profile-form"

export const dynamic = "force-dynamic"

export default async function PlatformProfilePage() {
  const context = await requirePlatformContext()
  const profile = await getOwnProfile(context)
  return <section className="mx-auto w-full max-w-[1100px] space-y-8" aria-labelledby="platform-profile-title"><header className="border-b border-border pb-7"><p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Portal da plataforma</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl" id="platform-profile-title">Meu perfil</h1><p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted-foreground">Atualize sua identificação e preferência visual. Avatar não está disponível para identidades globais.</p></header><ProfileForm allowAvatar={false} initialProfile={profile} /></section>
}
