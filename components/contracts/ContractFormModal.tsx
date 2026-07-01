import React, { useEffect, useState } from 'react';

import { Button } from '../Button';
import type { Client, Contract } from '../../types.ts';
import { XIcon } from './ContractIcons';

interface ContractFormModalProps {
  clients: Client[];
  contract?: Contract | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Contract>) => void;
}

const emptyForm: Partial<Contract> = {
  clientId: '',
  clientName: '',
  contractNumber: '',
  object: '',
  startDate: '',
  endDate: '',
  totalValue: 0,
  fileUrl: '#',
};

export const ContractFormModal: React.FC<ContractFormModalProps> = ({ clients, contract, isOpen, onClose, onSave }) => {
  const [formData, setFormData] = useState<Partial<Contract>>(emptyForm);

  useEffect(() => {
    setFormData(contract ? { ...contract } : emptyForm);
  }, [contract, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_40px_100px_-50px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Cadastro de contrato</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
              {contract ? 'Editar contrato' : 'Novo contrato'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            aria-label="Fechar modal de contrato"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 p-6 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Cliente / Órgão</span>
            <select
              value={formData.clientId ?? ''}
              onChange={(event) => {
                const client = clients.find((item) => item.id === event.target.value);
                setFormData((current) => ({
                  ...current,
                  clientId: event.target.value,
                  clientName: client ? `${client.segment} Municipal de ${client.city}` : '',
                }));
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="">Selecione o cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.segment} Municipal de {client.city}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Número do contrato</span>
            <input
              type="text"
              value={formData.contractNumber ?? ''}
              onChange={(event) => setFormData((current) => ({ ...current, contractNumber: event.target.value }))}
              placeholder="Ex: 001/2026"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Valor total (R$)</span>
            <input
              type="number"
              value={formData.totalValue ?? 0}
              onChange={(event) => setFormData((current) => ({ ...current, totalValue: Number(event.target.value) }))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Objeto contratado</span>
            <textarea
              rows={4}
              value={formData.object ?? ''}
              onChange={(event) => setFormData((current) => ({ ...current, object: event.target.value }))}
              placeholder="Descreva o objeto contratado"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Data inicial</span>
            <input
              type="date"
              value={formData.startDate ?? ''}
              onChange={(event) => setFormData((current) => ({ ...current, startDate: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Data final</span>
            <input
              type="date"
              value={formData.endDate ?? ''}
              onChange={(event) => setFormData((current) => ({ ...current, endDate: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-all duration-200 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-5">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(formData);
              onClose();
            }}
          >
            {contract ? 'Salvar alterações' : 'Criar contrato'}
          </Button>
        </div>
      </div>
    </div>
  );
};
