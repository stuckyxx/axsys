import React from 'react';

import type { Contract } from '../../types.ts';
import { deriveContractEntity, formatContractCurrency, formatContractDate } from '../../utils/contracts.ts';
import { Button } from '../Button';
import { ContractActionsMenu } from './ContractActionsMenu';
import { BadgeIcon, BuildingIcon, CalendarIcon, PaperclipIcon, PencilIcon, TrashIcon } from './ContractIcons';

interface ContractCardProps {
  contract: Contract;
  daysRemaining: number;
  progress: number;
  status: 'Ativo' | 'A vencer' | 'Vencido' | 'Encerrado';
  onAttach: () => void;
  onCloseContract: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onGeneratePaymentRequest: () => void;
  onGeneratePublicLink: () => void;
  onViewCertificates: () => void;
  onViewDetails: () => void;
  onViewPayments: () => void;
}

const statusStyles = {
  Ativo: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'A vencer': 'bg-amber-50 text-amber-700 ring-amber-100',
  Vencido: 'bg-rose-50 text-rose-700 ring-rose-100',
  Encerrado: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const;

const progressStyles = {
  Ativo: 'from-emerald-500 to-teal-500',
  'A vencer': 'from-amber-500 to-orange-500',
  Vencido: 'from-rose-500 to-red-500',
  Encerrado: 'from-slate-400 to-slate-500',
} as const;

export const ContractCard: React.FC<ContractCardProps> = ({
  contract,
  daysRemaining,
  progress,
  status,
  onAttach,
  onCloseContract,
  onDelete,
  onDownload,
  onEdit,
  onGeneratePaymentRequest,
  onGeneratePublicLink,
  onViewCertificates,
  onViewDetails,
  onViewPayments,
}) => {
  const entity = deriveContractEntity(contract.clientName);
  const entityBadge =
    entity === 'Prefeitura'
      ? 'bg-brand-50 text-brand-700 ring-brand-100'
      : entity === 'Câmara'
        ? 'bg-violet-50 text-violet-700 ring-violet-100'
        : 'bg-slate-100 text-slate-700 ring-slate-200';

  const daysLabel =
    status === 'Encerrado'
      ? 'Encerrado manualmente'
      : daysRemaining < 0
        ? 'Vigência encerrada'
        : `${daysRemaining} dias restantes`;

  return (
    <article className="group rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-[0_35px_80px_-60px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-100 hover:shadow-[0_36px_80px_-50px_rgba(37,99,235,0.28)] md:p-6">
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr_0.88fr] xl:items-start">
        <div className="flex gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.4rem] bg-[linear-gradient(145deg,#eff6ff,#f8fafc)] text-brand-700 ring-1 ring-slate-200">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-brand-100">
              <BuildingIcon className="h-5 w-5" />
              <span className="absolute -bottom-2 rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                {entity.slice(0, 3)}
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">{contract.clientName}</h3>
              <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
                Nº {contract.contractNumber}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusStyles[status]}`}>
                {status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ring-1 ${entityBadge}`}>
                {entity}
              </span>
              {contract.attachment?.name && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 ring-1 ring-slate-200">
                  <PaperclipIcon className="h-3.5 w-3.5" />
                  Anexo
                </span>
              )}
              {contract.publicShareId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white ring-1 ring-slate-900">
                  <BadgeIcon className="h-3.5 w-3.5" />
                  Link ativo
                </span>
              )}
            </div>

            <p className="mt-4 max-w-[58ch] text-sm leading-7 text-slate-600">
              {contract.object}
            </p>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white p-3 text-slate-700 ring-1 ring-slate-200">
                <CalendarIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Data inicial</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatContractDate(contract.startDate)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white p-3 text-slate-700 ring-1 ring-slate-200">
                <CalendarIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Data final</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatContractDate(contract.endDate)}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <span>Vigência</span>
              <span className="text-slate-700">{progress}%</span>
            </div>
            <div className="h-3 rounded-full bg-white ring-1 ring-slate-200">
              <div
                className={`h-3 rounded-full bg-gradient-to-r ${progressStyles[status]} transition-all duration-500`}
                style={{ width: progress === 0 ? '0%' : `${Math.max(8, progress)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-900">{progress}% utilizado</span>
              <span className={`font-medium ${status === 'Vencido' ? 'text-rose-600' : status === 'A vencer' ? 'text-amber-600' : 'text-slate-500'}`}>
                {daysLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex h-full flex-col justify-between gap-5 rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Valor total</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{formatContractCurrency(contract.totalValue)}</p>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Button variant="secondary" onClick={onEdit} className="h-11 rounded-2xl border-slate-200">
                <PencilIcon className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button variant="ghost" onClick={onDelete} className="h-11 rounded-2xl border border-rose-100 bg-rose-50/60 text-rose-600 hover:bg-rose-100">
                <TrashIcon className="mr-2 h-4 w-4" />
                Excluir
              </Button>
              <ContractActionsMenu
                canClose={!contract.closedAt}
                onAttach={onAttach}
                onCloseContract={onCloseContract}
                onDownload={onDownload}
                onGeneratePaymentRequest={onGeneratePaymentRequest}
                onGeneratePublicLink={onGeneratePublicLink}
                onViewCertificates={onViewCertificates}
                onViewDetails={onViewDetails}
                onViewPayments={onViewPayments}
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};
