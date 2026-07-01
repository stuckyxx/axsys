import React from 'react';

import type { ContractEntity, ContractStatus } from '../../utils/contracts.ts';
import { FilterIcon, SearchIcon, SettingsIcon } from './ContractIcons';

interface ContractsToolbarProps {
  entity: ContractEntity;
  pageSize: number;
  search: string;
  showAdvanced: boolean;
  sortBy: 'endDate' | 'value' | 'recent';
  status: ContractStatus;
  withAttachmentOnly: boolean;
  withPublicLinkOnly: boolean;
  onEntityChange: (value: ContractEntity) => void;
  onPageSizeChange: (value: number) => void;
  onSearchChange: (value: string) => void;
  onSortByChange: (value: 'endDate' | 'value' | 'recent') => void;
  onStatusChange: (value: ContractStatus) => void;
  onToggleAdvanced: () => void;
  onWithAttachmentOnlyChange: (value: boolean) => void;
  onWithPublicLinkOnlyChange: (value: boolean) => void;
}

const selectClasses =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition-all duration-200 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10';

export const ContractsToolbar: React.FC<ContractsToolbarProps> = ({
  entity,
  pageSize,
  search,
  showAdvanced,
  sortBy,
  status,
  withAttachmentOnly,
  withPublicLinkOnly,
  onEntityChange,
  onPageSizeChange,
  onSearchChange,
  onSortByChange,
  onStatusChange,
  onToggleAdvanced,
  onWithAttachmentOnlyChange,
  onWithPublicLinkOnlyChange,
}) => {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-[0_25px_70px_-55px_rgba(15,23,42,0.35)] md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <label className="relative block xl:min-w-[320px] xl:flex-[1.3]">
          <span className="sr-only">Buscar contratos</span>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar contratos..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3 pl-12 pr-4 text-sm font-medium text-slate-800 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
          />
        </label>

        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <select value={status} onChange={(event) => onStatusChange(event.target.value as ContractStatus)} className={selectClasses}>
            <option value="Todos">Todos</option>
            <option value="Ativo">Ativo</option>
            <option value="Vencido">Vencido</option>
            <option value="A vencer">A vencer</option>
            <option value="Encerrado">Encerrado</option>
          </select>

          <select value={entity} onChange={(event) => onEntityChange(event.target.value as ContractEntity)} className={selectClasses}>
            <option value="Todos">Todos os órgãos</option>
            <option value="Prefeitura">Prefeitura</option>
            <option value="Câmara">Câmara</option>
            <option value="Empresa">Empresa</option>
          </select>

          <button
            type="button"
            onClick={onToggleAdvanced}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
              showAdvanced
                ? 'border-brand-200 bg-brand-50 text-brand-700 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand-100 hover:bg-slate-50'
            }`}
          >
            <FilterIcon className="h-4 w-4" />
            Filtros Avançados
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="mt-4 grid gap-4 rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Ordenação</span>
            <select
              value={sortBy}
              onChange={(event) => onSortByChange(event.target.value as 'endDate' | 'value' | 'recent')}
              className={selectClasses}
            >
              <option value="endDate">Vencimento mais próximo</option>
              <option value="value">Maior valor</option>
              <option value="recent">Atualização mais recente</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Itens por página</span>
            <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className={selectClasses}>
              <option value={4}>4 contratos</option>
              <option value={6}>6 contratos</option>
              <option value={8}>8 contratos</option>
            </select>
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Somente com anexo</p>
              <p className="text-xs text-slate-500">Mostra apenas contratos com arquivo anexado.</p>
            </div>
            <input
              type="checkbox"
              checked={withAttachmentOnly}
              onChange={(event) => onWithAttachmentOnlyChange(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Somente com link</p>
              <p className="text-xs text-slate-500">Filtra contratos já preparados para compartilhamento.</p>
            </div>
            <input
              type="checkbox"
              checked={withPublicLinkOnly}
              onChange={(event) => onWithPublicLinkOnlyChange(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white md:col-span-2 xl:col-span-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-white/10 p-2 text-white">
                <SettingsIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Visão executiva</p>
                <p className="mt-1 text-sm text-slate-300">
                  Os filtros avançados refinam a operação diária sem tirar o foco da listagem principal.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
