import { Skeleton } from "@/components/ui/skeleton"

export default function AdministrativeClientsLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando clientes" className="space-y-6">
      <div className="border-b border-border pb-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-10 w-56" />
        <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11 w-full sm:w-40" />
      </div>
      <div className="grid gap-4 lg:hidden">
        {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-60 rounded-2xl" key={index} />)}
      </div>
      <Skeleton className="hidden h-[28rem] rounded-2xl lg:block" />
    </div>
  )
}
