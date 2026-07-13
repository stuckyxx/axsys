import { BankIcon, CheckCircleIcon } from "@phosphor-icons/react"

export type ReadonlyBankAccount = Readonly<{
  id: string
  bankCode: string
  bankName: string
  maskedBranch: string
  maskedAccount: string
  accountType: "checking" | "savings" | "payment"
  holderName: string
  maskedHolderDocument: string | null
  isDefault: boolean
}>

export function CompanyBankAccountsReadonly({
  banks,
}: Readonly<{ banks: readonly ReadonlyBankAccount[] }>) {
  return (
    <section aria-labelledby="company-bank-title" className="space-y-4">
      <div>
        <h2 id="company-bank-title" className="text-lg font-semibold">Bancos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Dados protegidos e somente para consulta. Solicite alterações ao Super Admin
        </p>
      </div>
      {banks.length === 0 ? (
        <p className="rounded-xl border p-5 text-sm text-muted-foreground">Nenhuma conta ativa.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {banks.map((bank) => (
            <article className="rounded-xl border bg-card p-4" key={bank.id}>
              <div className="flex items-start gap-3">
                <BankIcon aria-hidden className="mt-0.5 size-5 text-primary" weight="duotone" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{bank.bankCode} · {bank.bankName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Agência {bank.maskedBranch} · Conta {bank.maskedAccount}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {bank.holderName}{bank.maskedHolderDocument ? ` · ${bank.maskedHolderDocument}` : ""}
                  </p>
                </div>
                {bank.isDefault ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <CheckCircleIcon aria-hidden weight="fill" />Padrão
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
