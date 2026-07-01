import React from 'react';

import { AdministrativeTabId, AdministrativeTabs } from './AdministrativeTabs';
import { BellIcon, SettingsIcon, SparkIcon } from './ContractIcons';

interface ContractsModuleShellProps {
  activeTab: AdministrativeTabId;
  companyName: string;
  notificationsCount: number;
  onOpenSettings: () => void;
  onTabChange: (tab: AdministrativeTabId) => void;
  userAvatarUrl?: string;
  userName: string;
  children: React.ReactNode;
}

export const ContractsModuleShell: React.FC<ContractsModuleShellProps> = ({
  activeTab,
  companyName,
  notificationsCount,
  onOpenSettings,
  onTabChange,
  userAvatarUrl,
  userName,
  children,
}) => {
  return (
    <div className="mx-auto max-w-[1380px] space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_40px_120px_-60px_rgba(15,23,42,0.45)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.92),_rgba(255,255,255,1))]" />
        <div className="relative space-y-8 p-6 md:p-8">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-brand-700 shadow-sm">
                <SparkIcon className="h-4 w-4" />
                Administrativo
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance md:text-5xl">
                Módulo Administrativo
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                Gestão de Cadastros, Propostas e Contratos.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:min-w-[360px] md:flex-row md:items-center md:justify-end">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Empresa ativa</p>
                <p className="mt-1 max-w-[220px] truncate text-sm font-semibold text-slate-900">{companyName}</p>
              </div>

              <div className="flex items-center gap-3 rounded-[1.5rem] border border-slate-200 bg-white/95 px-3 py-3 shadow-sm">
                <button
                  type="button"
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  aria-label="Notificações"
                >
                  <BellIcon className="h-5 w-5" />
                  {notificationsCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                      {notificationsCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  aria-label="Configurações rápidas"
                >
                  <SettingsIcon className="h-5 w-5" />
                </button>

                <div className="flex items-center gap-3 rounded-2xl bg-slate-950 px-3 py-2 text-white">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/10">
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt={userName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold uppercase">{userName.slice(0, 2)}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Usuário</p>
                    <p className="max-w-[120px] truncate text-sm font-semibold">{userName}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <AdministrativeTabs activeTab={activeTab} onTabChange={onTabChange} />
        </div>
      </section>

      {children}
    </div>
  );
};
