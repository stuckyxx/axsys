import React from 'react';

import type { Contract } from '../../types.ts';
import { formatContractCurrency, formatContractDate } from '../../utils/contracts.ts';
import { Button } from '../Button';
import { CalendarIcon, FileTextIcon, LinkIcon, PaperclipIcon, XIcon } from './ContractIcons';

interface ContractDetailsModalProps {
  contract: Contract | null;
  isOpen: boolean;
  onClose: () => void;
  statusLabel: string;
}

export const ContractDetailsModal: React.FC<ContractDetailsModalProps> = ({ contract, isOpen, onClose, statusLabel }) => {
  if (!isOpen || !contract) {
    return null;
  }

  const detailRows = [
    { label: 'Número do contrato', value: contract.contractNumber || 'Não informado' },
    { label: 'Órgão contratante', value: contract.clientName },
    { label: 'Data inicial', value: formatContractDate(contract.startDate) },
    { label: 'Data final', value: formatContractDate(contract.endDate) },
    { label: 'Valor total', value: formatContractCurrency(contract.totalValue) },
    { label: 'Status atual', value: statusLabel },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-3xl overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_40px_100px_-50px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Detalhes do contrato</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{contract.clientName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            aria-label="Fechar detalhes do contrato"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1.25fr_0.9fr]">
          <section className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
                <FileTextIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Resumo executivo</p>
                <p className="text-sm text-slate-500">Visão consolidada do contrato selecionado.</p>
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
                  <dd className="mt-2 text-sm font-semibold text-slate-900">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-4">
            <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white/10 p-3">
                  <CalendarIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Objeto contratado</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{contract.object}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <PaperclipIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Anexo do contrato</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {contract.attachment?.name ? contract.attachment.name : 'Nenhum arquivo anexado até o momento.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <LinkIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Link público</p>
                  <p className="mt-1 break-all text-sm text-slate-500">
                    {contract.publicShareId ? contract.publicShareId : 'Ainda não gerado.'}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-slate-100 bg-white px-6 py-5">
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
};
