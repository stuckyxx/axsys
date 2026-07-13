import { requireCompanyContext } from "@/modules/auth/server/guards"
import { getOwnProfile } from "@/modules/settings/server/profile-service"
import { ProfileForm } from "@/modules/settings/ui/profile-form"

export const dynamic = "force-dynamic"

export default async function CompanyProfilePage() {
  const context = await requireCompanyContext()
  const profile = await getOwnProfile(context)
  return <ProfilePage profileForm={<ProfileForm allowAvatar initialProfile={profile} />} portal="empresa" />
}

function ProfilePage({ profileForm, portal }: Readonly<{ profileForm: React.ReactNode; portal: string }>) {
  return <section className="mx-auto w-full max-w-[1100px] space-y-8" aria-labelledby="profile-page-title"><header className="border-b border-border pb-7"><p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Portal da {portal}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl" id="profile-page-title">Meu perfil</h1><p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted-foreground">Atualize sua identificação, avatar e preferência visual com dados lidos diretamente da origem.</p></header>{profileForm}</section>
}
