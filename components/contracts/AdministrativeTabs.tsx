import React from 'react';
import type { AdministrativeModuleTabId } from '../../utils/moduleTabs.ts';

export type AdministrativeTabId = AdministrativeModuleTabId;

const tabs: Array<{ id: AdministrativeTabId; label: string }> = [
  { id: 'registrations', label: 'Cadastros' },
  { id: 'proposals', label: 'Propostas & Orçamentos' },
  { id: 'contracts', label: 'Contratos' },
];

interface AdministrativeTabsProps {
  activeTab: AdministrativeTabId;
  onTabChange: (tab: AdministrativeTabId) => void;
}

export const AdministrativeTabs: React.FC<AdministrativeTabsProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav
      aria-label="Navegação do módulo administrativo"
      className="rounded-[1.5rem] border border-slate-200/80 bg-slate-100/80 p-1.5 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.35)] backdrop-blur"
    >
      <div className="flex min-w-full gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`group relative whitespace-nowrap rounded-[1.1rem] px-4 py-3 text-sm font-semibold tracking-tight transition-all duration-200 md:px-5 ${
                isActive
                  ? 'bg-white text-brand-700 shadow-[0_14px_30px_-20px_rgba(37,99,235,0.45)] ring-1 ring-brand-100'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full transition-colors ${
                    isActive ? 'bg-brand-500' : 'bg-slate-300 group-hover:bg-slate-400'
                  }`}
                />
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
