import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../components/Button';
import { ContractActionsMenu } from '../components/contracts/ContractActionsMenu';
import { ContractAttachmentModal } from '../components/contracts/ContractAttachmentModal';
import { ContractDetailsModal } from '../components/contracts/ContractDetailsModal';
import { ContractFormModal } from '../components/contracts/ContractFormModal';
import { useAuth } from '../context/AuthContext';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { getClients } from '../services/clientService';
import { fileToBase64 } from '../services/companyService';
import { writeCompanyScopedValue } from '../services/storageScope';
import { getContracts } from '../services/contractService';
import type { Client, Contract } from '../types.ts';
import { FINANCE_ACTIVE_TAB_STORAGE_KEY } from '../utils/moduleTabs.ts';
import {
  ADMIN_PAYMENT_DRAFT_KEY,
  ADMIN_PAYMENT_FILTER_CONTRACT_KEY,
  filterContracts,
  formatContractCurrency,
  formatContractDate,
  getContractDaysRemaining,
  getContractProgress,
  getContractStatus,
  paginateContracts,
  type ContractEntity,
  type ContractStatus,
} from '../utils/contracts.ts';

interface ContractsProps {
  activeTab?: string;
}

const CONTRACTS_STORAGE_KEY = 'axsys_contracts_db_v2';

export const Contracts: React.FC<ContractsProps> = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const hasHydratedContractsRef = React.useRef(false);

  const [clients, setClients] = useState<Client[]>(() => getClients(user));
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus>('Todos');
  const [entity, setEntity] = useState<ContractEntity>('Todos');
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [attachmentContract, setAttachmentContract] = useState<Contract | null>(null);
  const [detailsContract, setDetailsContract] = useState<Contract | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadContracts = React.useCallback(async () => {
    setClients(getClients(user));
    const storedContracts = await getContracts(user);
    setContracts(storedContracts);
    hasHydratedContractsRef.current = true;
  }, [user]);

  useEffect(() => {
    if (!hasHydratedContractsRef.current) {
      return;
    }

    writeCompanyScopedValue(CONTRACTS_STORAGE_KEY, contracts, user);
  }, [contracts, user]);

  useEffect(() => {
    let cancelled = false;
    hasHydratedContractsRef.current = false;
    void getContracts(user).then((storedContracts) => {
      if (!cancelled) {
        setClients(getClients(user));
        setContracts(storedContracts);
        hasHydratedContractsRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useTrackedStorageRefresh({
    trackedKeys: ['axsys_contracts_db_v2', 'axsys_clients_db_v2'],
    user,
    refresh: async () => {
      hasHydratedContractsRef.current = false;
      await loadContracts();
    },
  });

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredContracts = useMemo(
    () => filterContracts(contracts, { search, status, entity }),
    [contracts, entity, search, status],
  );

  const paginatedContracts = useMemo(
    () => paginateContracts(filteredContracts, currentPage, 6),
    [currentPage, filteredContracts],
  );

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  };

  const handleSave = (data: Partial<Contract>) => {
    if (editingContract) {
      setContracts((current) =>
        current.map((contract) => (
          contract.id === editingContract.id ? { ...contract, ...data } as Contract : contract
        )),
      );
      setEditingContract(null);
      showFeedback('success', 'Contrato atualizado com sucesso.');
      return;
    }

    const newContract: Contract = {
      id: crypto.randomUUID(),
      clientId: data.clientId ?? '',
      clientName: data.clientName ?? '',
      contractNumber: data.contractNumber ?? '',
      object: data.object ?? '',
      startDate: data.startDate ?? '',
      endDate: data.endDate ?? '',
      totalValue: data.totalValue ?? 0,
      fileUrl: data.fileUrl ?? '#',
    };

    setContracts((current) => [newContract, ...current]);
    showFeedback('success', 'Contrato criado com sucesso.');
  };

  const handleDelete = (contract: Contract) => {
    if (!window.confirm(`Tem certeza que deseja excluir o contrato ${contract.contractNumber || contract.clientName}?`)) {
      return;
    }

    setContracts((current) => current.filter((item) => item.id !== contract.id));
    showFeedback('success', 'Contrato excluído.');
  };

  const handleSaveAttachment = async (file: File) => {
    if (!attachmentContract) {
      return;
    }

    try {
      const content = await fileToBase64(file);

      setContracts((current) =>
        current.map((contract) =>
          contract.id === attachmentContract.id
            ? {
                ...contract,
                fileUrl: content,
                attachment: {
                  name: file.name,
                  content,
                  mimeType: file.type || 'application/octet-stream',
                  attachedAt: new Date().toISOString(),
                },
              }
            : contract,
        ),
      );

      setAttachmentContract(null);
      showFeedback('success', 'Arquivo anexado com sucesso.');
    } catch {
      showFeedback('error', 'Não foi possível anexar o arquivo do contrato.');
    }
  };

  const handleCloseContract = (contract: Contract) => {
    if (contract.closedAt) {
      showFeedback('error', 'Este contrato já foi encerrado.');
      return;
    }

    if (!window.confirm(`Encerrar o contrato ${contract.contractNumber || contract.clientName}?`)) {
      return;
    }

    setContracts((current) =>
      current.map((item) =>
        item.id === contract.id
          ? {
              ...item,
              closedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    showFeedback('success', 'Contrato encerrado.');
  };

  const handleGeneratePaymentRequest = (contract: Contract) => {
    localStorage.setItem(
      ADMIN_PAYMENT_DRAFT_KEY,
      JSON.stringify({
        clientId: contract.clientId,
        contractId: contract.id,
        description: contract.object,
        amount: '',
        issueDate: '',
        invoiceNumber: '',
      }),
    );
    localStorage.setItem(ADMIN_PAYMENT_FILTER_CONTRACT_KEY, contract.id);
    localStorage.setItem(FINANCE_ACTIVE_TAB_STORAGE_KEY, 'payments');
    navigate('/finance');
  };

  const handleViewPayments = (contract: Contract) => {
    localStorage.setItem(ADMIN_PAYMENT_FILTER_CONTRACT_KEY, contract.id);
    localStorage.setItem(FINANCE_ACTIVE_TAB_STORAGE_KEY, 'payments');
    navigate('/finance');
  };

  const handleViewCertificates = () => {
    navigate('/certificates');
  };

  const handleGeneratePublicLink = async (contract: Contract) => {
    const shareId = contract.publicShareId ?? `contract-${crypto.randomUUID().slice(0, 8)}`;

    if (!contract.publicShareId) {
      setContracts((current) =>
        current.map((item) =>
          item.id === contract.id
            ? {
                ...item,
                publicShareId: shareId,
              }
            : item,
        ),
      );
    }

    const publicUrl = `${window.location.origin}${window.location.pathname}#/administrative?contractShare=${shareId}`;

    try {
      await navigator.clipboard.writeText(publicUrl);
      showFeedback('success', 'Link público copiado.');
    } catch {
      showFeedback('error', 'Não foi possível copiar o link público.');
    }
  };

  const handleDownloadAttachment = (contract: Contract) => {
    if (!contract.attachment?.content) {
      showFeedback('error', 'Este contrato ainda não possui anexo.');
      return;
    }

    const link = document.createElement('a');
    link.href = contract.attachment.content;
    link.download = contract.attachment.name || `${contract.contractNumber}.pdf`;
    link.click();
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-6 top-6 z-[80] rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Contratos</h1>
          <p className="mt-1 text-sm text-gray-500">Acompanhe a vigência, anexos e ações operacionais dos contratos.</p>
        </div>
        <Button onClick={() => { setEditingContract(null); setIsModalOpen(true); }}>
          + Novo Contrato
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Buscar</label>
            <input
              type="text"
              placeholder="Buscar contratos..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Status</label>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ContractStatus);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            >
              {['Todos', 'Ativo', 'A vencer', 'Vencido', 'Encerrado'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Órgão</label>
            <select
              value={entity}
              onChange={(event) => {
                setEntity(event.target.value as ContractEntity);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            >
              {['Todos', 'Prefeitura', 'Câmara', 'Empresa'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {paginatedContracts.items.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
            Nenhum contrato encontrado.
          </div>
        )}

        {paginatedContracts.items.map((contract) => {
          const progress = getContractProgress(contract);
          const daysLeft = getContractDaysRemaining(contract);
          const contractStatus = getContractStatus(contract);

          return (
            <div key={contract.id} className="bg-white border border-gray-200 shadow-sm rounded-xl p-6 hover:shadow-md transition-all">
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-gray-900">{contract.clientName}</h3>
                    {contract.contractNumber && (
                      <span className="px-2 py-0.5 rounded text-xs bg-brand-50 text-brand-700 font-semibold border border-brand-100">
                        Nº {contract.contractNumber}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      contractStatus === 'Ativo'
                        ? 'bg-green-100 text-green-700'
                        : contractStatus === 'A vencer'
                          ? 'bg-yellow-100 text-yellow-800'
                          : contractStatus === 'Vencido'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                    }`}>
                      {contractStatus}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-medium">{contract.object}</p>
                </div>

                <div className="text-right">
                  <p className="text-xl font-bold text-slate-800">{formatContractCurrency(contract.totalValue)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatContractDate(contract.startDate)} até {formatContractDate(contract.endDate)}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
                <div>
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mb-2">
                    <span>{formatContractDate(contract.startDate)}</span>
                    <span>{formatContractDate(contract.endDate)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        contractStatus === 'Vencido'
                          ? 'bg-red-500'
                          : contractStatus === 'A vencer'
                            ? 'bg-yellow-500'
                            : contractStatus === 'Encerrado'
                              ? 'bg-slate-400'
                              : 'bg-emerald-500'
                      }`}
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between mt-2 text-xs font-medium">
                    <span className="text-gray-500">{progress}% decorrido</span>
                    <span className={daysLeft < 30 ? 'text-red-600' : 'text-emerald-600'}>
                      {contractStatus === 'Encerrado'
                        ? 'Contrato encerrado'
                        : daysLeft > 0
                          ? `${daysLeft} dias restantes`
                          : 'Vigência encerrada'}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                  <Button variant="secondary" className="text-xs" onClick={() => { setEditingContract(contract); setIsModalOpen(true); }}>
                    Editar
                  </Button>
                  <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(contract)}>
                    Excluir
                  </Button>
                  <ContractActionsMenu
                    canClose={!contract.closedAt}
                    onAttach={() => setAttachmentContract(contract)}
                    onCloseContract={() => handleCloseContract(contract)}
                    onDownload={() => handleDownloadAttachment(contract)}
                    onGeneratePaymentRequest={() => handleGeneratePaymentRequest(contract)}
                    onGeneratePublicLink={() => void handleGeneratePublicLink(contract)}
                    onViewCertificates={handleViewCertificates}
                    onViewDetails={() => setDetailsContract(contract)}
                    onViewPayments={() => handleViewPayments(contract)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {paginatedContracts.totalPages > 1 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <p className="text-slate-500">
            Exibindo {paginatedContracts.items.length} de {paginatedContracts.totalItems} contratos
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={paginatedContracts.page === 1}
            >
              Anterior
            </Button>
            <span className="px-3 py-2 text-slate-600">
              Página {paginatedContracts.page} de {paginatedContracts.totalPages}
            </span>
            <Button
              variant="secondary"
              onClick={() => setCurrentPage((page) => Math.min(paginatedContracts.totalPages, page + 1))}
              disabled={paginatedContracts.page === paginatedContracts.totalPages}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <ContractFormModal
        clients={clients}
        contract={editingContract}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingContract(null);
        }}
        onSave={handleSave}
      />

      <ContractAttachmentModal
        existingAttachmentName={attachmentContract?.attachment?.name}
        isOpen={Boolean(attachmentContract)}
        onClose={() => setAttachmentContract(null)}
        onSave={handleSaveAttachment}
        title={attachmentContract?.contractNumber || attachmentContract?.clientName || 'Anexar contrato'}
      />

      <ContractDetailsModal
        contract={detailsContract}
        isOpen={Boolean(detailsContract)}
        onClose={() => setDetailsContract(null)}
        statusLabel={detailsContract ? getContractStatus(detailsContract) : ''}
      />
    </div>
  );
};
