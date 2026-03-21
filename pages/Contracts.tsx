
import React, { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Contract, Client } from '../types';
import { getClients } from '../services/clientService';

const formatDateString = (dateString: string) => {
    if (!dateString) return '';
    try {
        const [year, month, day] = dateString.split('T')[0].split('-');
        return `${day}/${month}/${year}`;
    } catch {
        return dateString;
    }
};

// Modal de Formulário para Contratos
const ContractFormModal = ({ 
    isOpen, 
    onClose, 
    onSave, 
    initialData 
}: { 
    isOpen: boolean; 
    onClose: () => void; 
    onSave: (data: Partial<Contract>) => void; 
    initialData?: Contract | null 
}) => {
    const [clients] = useState<Client[]>(() => getClients());

    const [formData, setFormData] = useState<Partial<Contract>>(
        initialData || {
            clientId: '',
            clientName: '',
            contractNumber: '',
            object: '',
            startDate: '',
            endDate: '',
            totalValue: 0,
            fileUrl: '#'
        }
    );

    // Atualiza o form se mudar de edição para criação ou troca de item
    React.useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData({ clientId: '', clientName: '', contractNumber: '', object: '', startDate: '', endDate: '', totalValue: 0, fileUrl: '#' });
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-lg">
                        {initialData ? 'Editar Contrato' : 'Novo Contrato'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
                </div>
                
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-[13px] font-semibold text-slate-600 mb-2">Cliente / Parte</label>
                        <select 
                            className="block w-full rounded-xl border border-slate-200 bg-white py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                            value={formData.clientId || ''}
                            onChange={e => {
                                const client = clients.find(c => c.id === e.target.value);
                                setFormData({
                                    ...formData, 
                                    clientId: e.target.value,
                                    clientName: client ? `${client.segment} Municipal de ${client.city}` : ''
                                });
                            }}
                        >
                            <option value="">Selecione um cliente...</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.segment} Municipal de {c.city}</option>
                            ))}
                        </select>
                    </div>

                    <Input 
                        label="Número do Contrato" 
                        placeholder="Ex: 001/2024"
                        value={formData.contractNumber || ''}
                        onChange={e => setFormData({...formData, contractNumber: e.target.value})}
                    />
                    
                    <Input 
                        label="Objeto do Contrato" 
                        placeholder="Ex: Prestação de Serviços de TI"
                        value={formData.object}
                        onChange={e => setFormData({...formData, object: e.target.value})}
                    />

                    <div className="grid grid-cols-2 gap-4">
                        <Input 
                            label="Data Início" 
                            type="date"
                            value={formData.startDate}
                            onChange={e => setFormData({...formData, startDate: e.target.value})}
                        />
                        <Input 
                            label="Data Fim" 
                            type="date"
                            value={formData.endDate}
                            onChange={e => setFormData({...formData, endDate: e.target.value})}
                        />
                    </div>

                    <Input 
                        label="Valor Total (R$)" 
                        type="number"
                        placeholder="0.00"
                        value={formData.totalValue}
                        onChange={e => setFormData({...formData, totalValue: Number(e.target.value)})}
                    />
                    
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex items-start gap-3">
                         <div className="text-blue-500 mt-0.5">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                         </div>
                         <p className="text-xs text-blue-800">
                             Ao salvar, o sistema calculará automaticamente a vigência e o progresso do contrato com base nas datas.
                         </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                        <Button onClick={() => { onSave(formData); onClose(); }}>
                            {initialData ? 'Salvar Alterações' : 'Criar Contrato'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const Contracts: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>(() => {
      const saved = localStorage.getItem('axsys_contracts_db_v2');
      if (saved) return JSON.parse(saved);
      return [];
  });

  useEffect(() => {
      localStorage.setItem('axsys_contracts_db_v2', JSON.stringify(contracts));
  }, [contracts]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);

  const handleSave = (data: Partial<Contract>) => {
      if (editingContract) {
          // Edit
          setContracts(prev => prev.map(c => c.id === editingContract.id ? { ...c, ...data } as Contract : c));
          setEditingContract(null);
      } else {
          // Create
          const newContract: Contract = {
              ...data as Contract,
              id: Math.random().toString(),
              fileUrl: '#'
          };
          setContracts([newContract, ...contracts]);
      }
      setIsModalOpen(false);
  };

  const handleEdit = (contract: Contract) => {
      setEditingContract(contract);
      setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
      if(confirm('Tem certeza que deseja excluir este contrato?')) {
          setContracts(prev => prev.filter(c => c.id !== id));
      }
  };

  const calculateProgress = (start: string, end: string) => {
    const startDate = new Date(start + 'T00:00:00').getTime();
    const endDate = new Date(end + 'T00:00:00').getTime();
    const today = new Date().getTime();
    
    if (today < startDate) return 0;
    if (today > endDate) return 100;
    
    const totalDuration = endDate - startDate;
    const elapsed = today - startDate;
    
    return Math.round((elapsed / totalDuration) * 100);
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
              <h1 className="text-2xl font-bold text-gray-900">Meus Contratos</h1>
              <p className="mt-1 text-sm text-gray-500">Acompanhe a vigência e execução dos contratos.</p>
          </div>
          <Button onClick={() => { setEditingContract(null); setIsModalOpen(true); }}>
              + Novo Contrato
          </Button>
       </div>

       <div className="grid grid-cols-1 gap-6">
          {contracts.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
                  Nenhum contrato cadastrado.
              </div>
          )}
          {contracts.map(contract => {
              const progress = calculateProgress(contract.startDate, contract.endDate);
              const daysLeft = Math.ceil((new Date(contract.endDate + 'T00:00:00').getTime() - new Date().getTime()) / (1000 * 3600 * 24));

              return (
                  <div key={contract.id} className="bg-white border border-gray-200 shadow-sm rounded-xl p-6 hover:shadow-md transition-all group">
                      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                          <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-gray-900">{contract.clientName}</h3>
                                {contract.contractNumber && <span className="px-2 py-0.5 rounded text-xs bg-brand-50 text-brand-700 font-semibold border border-brand-100">Nº {contract.contractNumber}</span>}
                                {progress >= 100 && <span className="px-2 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 font-bold uppercase">Finalizado</span>}
                                {progress < 100 && <span className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-bold uppercase">Ativo</span>}
                              </div>
                              <p className="text-sm text-gray-500 font-medium">{contract.object}</p>
                          </div>
                          <div className="text-right">
                              <p className="text-xl font-bold text-slate-800">R$ {contract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                          </div>
                      </div>

                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-gray-500 mb-2">
                                <span>{formatDateString(contract.startDate)}</span>
                                <span>{formatDateString(contract.endDate)}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                <div 
                                    className={`h-3 rounded-full transition-all duration-500 ${progress >= 90 ? 'bg-red-500' : progress >= 50 ? 'bg-brand-500' : 'bg-emerald-500'}`} 
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between mt-2 text-xs font-medium">
                                <span className={progress >= 90 ? 'text-red-600' : 'text-gray-500'}>{progress}% Decorrido</span>
                                <span className={daysLeft < 30 ? 'text-red-600' : 'text-emerald-600'}>
                                    {daysLeft > 0 ? `${daysLeft} dias restantes` : 'Vigência encerrada'}
                                </span>
                            </div>
                          </div>
                          
                          <div className="flex justify-end gap-2 border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                             <Button variant="secondary" className="text-xs" onClick={() => handleEdit(contract)}>
                                 Editar
                             </Button>
                             <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(contract.id)}>
                                 Excluir
                             </Button>
                          </div>
                      </div>
                  </div>
              );
          })}
       </div>

       <ContractFormModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          initialData={editingContract}
       />
    </div>
  );
};
