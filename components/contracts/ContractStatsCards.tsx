import React from 'react';

import { BadgeIcon, ClockIcon, FileTextIcon, MoneyIcon } from './ContractIcons';

interface ContractStatsCardsProps {
  stats: {
    activeCount: number;
    expiringCount: number;
    expiredCount: number;
    totalValue: string;
  };
}

const cardStyles = [
  {
    title: 'Contratos Ativos',
    valueKey: 'activeCount' as const,
    accent: 'bg-emerald-500/12 text-emerald-700 ring-emerald-100',
    icon: BadgeIcon,
  },
  {
    title: 'A vencer em 30 dias',
    valueKey: 'expiringCount' as const,
    accent: 'bg-amber-500/12 text-amber-700 ring-amber-100',
    icon: ClockIcon,
  },
  {
    title: 'Vencidos',
    valueKey: 'expiredCount' as const,
    accent: 'bg-rose-500/12 text-rose-700 ring-rose-100',
    icon: FileTextIcon,
  },
  {
    title: 'Valor Total',
    valueKey: 'totalValue' as const,
    accent: 'bg-brand-500/12 text-brand-700 ring-brand-100',
    icon: MoneyIcon,
  },
];

export const ContractStatsCards: React.FC<ContractStatsCardsProps> = ({ stats }) => {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cardStyles.map((card) => {
        const Icon = card.icon;
        const value = stats[card.valueKey];

        return (
          <article
            key={card.title}
            className="group rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.4)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-100 hover:shadow-[0_28px_70px_-45px_rgba(37,99,235,0.28)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{card.title}</p>
                <p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {typeof value === 'number' ? value : value}
                </p>
              </div>
              <div className={`rounded-2xl p-3 ring-1 transition-transform duration-300 group-hover:scale-105 ${card.accent}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
};
