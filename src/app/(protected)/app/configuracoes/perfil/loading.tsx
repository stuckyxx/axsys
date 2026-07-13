import { Skeleton } from "@/components/ui/skeleton"

export default function ProfileLoading() {
  return <div aria-label="Carregando perfil" className="mx-auto w-full max-w-[1100px] space-y-8"><div className="space-y-3 border-b border-border pb-7"><Skeleton className="h-3 w-28" /><Skeleton className="h-10 w-56" /><Skeleton className="h-4 w-full max-w-xl" /></div><div className="grid gap-6 lg:grid-cols-[12rem_1fr]"><Skeleton className="size-24 rounded-2xl" /><div className="space-y-5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-11 w-36 justify-self-end" /></div></div></div>
}
