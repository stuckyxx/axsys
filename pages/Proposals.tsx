
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { Proposal, ProposalItem, Client, Service, Company } from '../types';
import { getClients } from '../services/clientService';
import { deleteProposal, getProposals, saveProposals } from '../services/proposalService.ts';
import { getServices } from '../services/serviceService';
import { useAuth } from '../context/AuthContext';
import { getCompanyById, getCompanySettings } from '../services/companyService';

const ProposalDocumentPreview = ({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) => {
    const printRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();
    
    const [clients] = useState<Client[]>(() => getClients(user));
    const [services] = useState<Service[]>(() => getServices(user));
    const [companySettings] = useState<Company>(() => {
        if (user?.companyId) {
            const company = getCompanyById(user.companyId);
            if (company) return company;
        }
        return getCompanySettings();
    });

    const client = clients.find(c => c.id === proposal.clientId);

    const formatProposalDate = (dateString: string) => {
        try {
            const [year, month, day] = dateString.split('T')[0].split('-');
            const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
            const monthName = monthNames[parseInt(month, 10) - 1];
            const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
            return `${day} de ${capitalizedMonth} de ${year}`;
        } catch {
            return new Date(dateString).toLocaleDateString('pt-BR');
        }
    };

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;

        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);

        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map(el => el.outerHTML)
            .join('\n');

        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
            iframeDoc.open();
            iframeDoc.write(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <title>Impressão - Proposta</title>
                        ${styles}
                        <style>
                            @page { size: A4; margin: 0; }
                            body { 
                                margin: 0; 
                                -webkit-print-color-adjust: exact; 
                                print-color-adjust: exact; 
                                background-color: white;
                            }
                            .print-container {
                                width: 210mm;
                                min-height: 297mm;
                                margin: 0 auto;
                                background: white;
                                position: relative;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="print-container">
                            ${printContent.innerHTML}
                        </div>
                    </body>
                </html>
            `);
            iframeDoc.close();

            setTimeout(() => {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
                setTimeout(() => {
                    document.body.removeChild(iframe);
                }, 1000);
            }, 500);
        }
    };

    if (!client) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Visualização da Proposta
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-1">Proposta Comercial - {proposal.number}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose}>Fechar</Button>
                        <Button onClick={handlePrint}>
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Imprimir Proposta
                        </Button>
                    </div>
                </div>

                <div className="overflow-y-auto p-8 bg-gray-200 flex justify-center">
                    <div ref={printRef} className="bg-white w-[210mm] min-h-[297mm] shadow-lg relative text-black font-sans print:w-full print:shadow-none">
                        
                        <div className="relative h-[297mm] flex flex-col">
                            {/* Timbrado (Fundo/Cabeçalho/Rodapé) */}
                            <div className="absolute inset-0 z-0 pointer-events-none">
                                {companySettings.letterheadUrl && (
                                    <img src={companySettings.letterheadUrl} alt="Timbrado" className="w-full h-full object-cover opacity-100" />
                                )}
                            </div>

                            {/* Conteúdo da Carta */}
                            <div 
                                className="relative z-10 flex flex-col h-full font-serif text-[12pt] leading-relaxed text-justify"
                                style={{ paddingTop: '6.5cm', paddingBottom: '4cm', paddingLeft: '2.5cm', paddingRight: '2.5cm' }}
                            >
                                
                                <h1 className="text-center font-bold text-[14pt] mb-8 uppercase underline decoration-2 underline-offset-4">
                                    PROPOSTA DE PREÇO
                                </h1>

                                <div className="mb-8 font-bold text-left">
                                    <p>A(o) Setor de compras da</p>
                                    <p>{proposal.segment} Municipal de {client.city}</p>
                                </div>

                                <p className="mb-6">Conforme solicitado, estamos enviando coleta de preços para os serviços abaixo:</p>

                                <table className="w-full border-collapse mb-6 text-sm">
                                    <thead>
                                        <tr>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold w-[5%]">ITEM</th>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold">DESCRIÇÃO</th>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold w-[8%]">UNID</th>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold w-[8%]">QUANT</th>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold w-[15%]">VALOR UNIT/MENSAL</th>
                                            <th className="border border-black p-2 bg-gray-100 text-center font-bold w-[15%]">VALOR TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {proposal.items.map((item, index) => {
                                            const service = services.find(s => s.id === item.serviceId);
                                            const description = item.serviceDescription || service?.description || service?.name || '';
                                            const isProduct = item.type === 'product';
                                            const unit = isProduct ? 'un' : 'mês';
                                            const quantity = isProduct ? (item.quantity || 0) : (item.validityMonths || 0);
                                            const unitValue = isProduct ? (item.unitValue || 0) : (item.monthlyValue || 0);
                                            
                                            return (
                                                <tr key={item.id}>
                                                    <td className="border border-black p-2 text-center">{String(index + 1).padStart(2, '0')}</td>
                                                    <td className="border border-black p-2">{description}</td>
                                                    <td className="border border-black p-2 text-center">{unit}</td>
                                                    <td className="border border-black p-2 text-center">{quantity}</td>
                                                    <td className="border border-black p-2 text-right">R$&nbsp;{unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                    <td className="border border-black p-2 text-right font-bold">R$&nbsp;{item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                </tr>
                                            );
                                        })}
                                        <tr>
                                            <td colSpan={5} className="border border-black p-2 text-right font-bold">VALOR GLOBAL DA PROPOSTA</td>
                                            <td className="border border-black p-2 text-right font-bold">R$&nbsp;{proposal.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                <h3 className="font-bold mb-2">Condições Gerais da Proposta:</h3>
                                <ul className="list-disc pl-6 mb-12">
                                    <li>Prazo de execução: 12 meses.</li>
                                    <li>Validade da Proposta: 90 (noventa) dias contados de sua emissão.</li>
                                </ul>

                                <div className="mt-auto text-center">
                                    <p className="mb-16">{client.city}/{client.state || 'MA'}, {formatProposalDate(proposal.date)}.</p>
                                    <div className="flex flex-col items-center justify-center w-96 mx-auto mt-16">
                                        {companySettings?.signatureUrl && (
                                            <img 
                                                src={companySettings.signatureUrl} 
                                                alt="Assinatura" 
                                                className="w-[200px] h-auto object-contain mix-blend-multiply mb-[-1rem]" 
                                            />
                                        )}
                                        <div className="w-full border-t border-black mt-4 mb-2"></div>
                                        <p className="font-bold">{companySettings?.corporateName || 'AXSYS TECHNOLOGY LTDA'}</p>
                                        <p>CNPJ: {companySettings?.cnpj || '00.000.000/0001-00'}</p>
                                        <p>{companySettings?.representative || 'Representante Legal'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const Proposals: React.FC = () => {
  const [isEditingMode, setIsEditingMode] = useState(false);
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>(() => getClients(user));
  const [services, setServices] = useState<Service[]>(() => getServices(user));
  const [proposals, setProposals] = useState<Proposal[]>(() => getProposals(user));

  // Form State
  const [currentProposal, setCurrentProposal] = useState<Partial<Proposal>>({
    items: [],
    segment: 'Prefeitura',
    status: 'draft',
    clientId: '',
    number: '',
    totalValue: 0,
    date: ''
  });
  const [newItem, setNewItem] = useState<Partial<ProposalItem>>({ validityMonths: 12, monthlyValue: 0, serviceId: '', type: 'service', quantity: 1, unitValue: 0, serviceDescription: '' });

  const [previewProposal, setPreviewProposal] = useState<Proposal | null>(null);

  useEffect(() => {
      setClients(getClients(user));
      setServices(getServices(user));
      setProposals(getProposals(user));
  }, [user]);

  useTrackedStorageRefresh({
    trackedKeys: ['axsys_clients_db_v2', 'axsys_services_db_v2', 'axsys_proposals_db_v2'],
    user,
    refresh: () => {
      setClients(getClients(user));
      setServices(getServices(user));
      setProposals(getProposals(user));
    },
  });

  // Iniciar criação
  const handleCreateNew = () => {
      setCurrentProposal({
          id: '', 
          number: `PROP-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000)}`,
          status: 'draft',
          items: [],
          totalValue: 0,
          segment: 'Prefeitura',
          clientId: '',
          date: new Date().toISOString().split('T')[0]
      });
      setIsEditingMode(true);
  };

  // Iniciar edição
  const handleEdit = (prop: Proposal) => {
      setCurrentProposal({ ...prop }); // Clone para evitar mutação direta
      setIsEditingMode(true);
  };

  // Excluir
  const handleDelete = (id: string) => {
      if(confirm("Tem certeza que deseja excluir esta proposta?")) {
          const updatedProposals = proposals.filter(p => p.id !== id);
          setProposals(updatedProposals);
          deleteProposal(id, user);
      }
  };

  // Salvar (Create or Update)
  const handleSaveProposal = () => {
      if (!currentProposal.clientId || !currentProposal.date) {
          alert("Preencha o cliente e a data.");
          return;
      }

      let updatedProposals;
      if (currentProposal.id) {
          // Atualizar existente
          updatedProposals = proposals.map(p => p.id === currentProposal.id ? currentProposal as Proposal : p);
      } else {
          // Criar novo
          const newProp = { ...currentProposal, id: Math.random().toString() } as Proposal;
          updatedProposals = [newProp, ...proposals];
      }
      setProposals(updatedProposals);
      saveProposals(updatedProposals, user);
      setIsEditingMode(false);
  };

  const calculateItemTotal = (item: Partial<ProposalItem>) => {
      if (item.type === 'product') {
          return (item.quantity || 0) * (item.unitValue || 0);
      }
      return (item.validityMonths || 0) * (item.monthlyValue || 0);
  };

  const handleAddItem = () => {
    if (!currentProposal.items) return;
    if (!newItem.serviceId) return;

    const service = services.find(s => s.id === newItem.serviceId);
    if (!service) return;

    const total = calculateItemTotal(newItem);
    const itemToAdd = { 
        ...newItem, 
        id: Math.random().toString(), 
        total,
        serviceDescription: newItem.serviceDescription || service.description || service.name
    } as ProposalItem;
    
    const updatedItems = [...currentProposal.items, itemToAdd];
    const newTotal = updatedItems.reduce((acc, curr) => acc + curr.total, 0);

    setCurrentProposal({
      ...currentProposal,
      items: updatedItems,
      totalValue: newTotal
    });
    
    // Reset item form
    setNewItem({ validityMonths: 12, monthlyValue: 0, serviceId: '', type: 'service', quantity: 1, unitValue: 0, serviceDescription: '' });
  };

  const handleRemoveItem = (id: string) => {
    if (!currentProposal.items) return;
    const updatedItems = currentProposal.items.filter(i => i.id !== id);
    const newTotal = updatedItems.reduce((acc, curr) => acc + curr.total, 0);
    setCurrentProposal({ ...currentProposal, items: updatedItems, totalValue: newTotal });
  };

  const handlePrint = (proposal: Proposal) => {
    setPreviewProposal(proposal);
  };

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800 border-gray-200',
    sent: 'bg-blue-50 text-blue-700 border-blue-200',
    approved: 'bg-green-50 text-green-700 border-green-200',
    rejected: 'bg-red-50 text-red-700 border-red-200'
  };

  const statusLabels = {
    draft: 'Rascunho',
    sent: 'Enviada',
    approved: 'Aprovada',
    rejected: 'Rejeitada'
  };

  // --- VIEW: EDITOR DE PROPOSTA ---
  if (isEditingMode) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        {/* Header Editor */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
             <div className="flex items-center gap-3">
                <button onClick={() => setIsEditingMode(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </button>
                <h1 className="text-2xl font-bold text-slate-800">
                    {currentProposal.id ? `Editando ${currentProposal.number}` : 'Nova Proposta Comercial'}
                </h1>
             </div>
             <p className="ml-9 text-sm text-slate-500">Preencha os detalhes para gerar o documento.</p>
          </div>
          <div className="flex gap-2">
             <Button variant="ghost" onClick={() => setIsEditingMode(false)}>Cancelar</Button>
             <Button onClick={handleSaveProposal} className="shadow-lg shadow-brand-500/20">Salvar Proposta</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Client & Details */}
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Dados do Cliente</h3>
                    <div className="space-y-4">
                        <div>
                             <label className="block text-[13px] font-semibold text-slate-600 mb-2">Segmento</label>
                             <select 
                                className="block w-full rounded-xl border border-slate-200 bg-white py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                                value={currentProposal.segment || 'Prefeitura'}
                                onChange={e => {
                                    setCurrentProposal({
                                        ...currentProposal, 
                                        segment: e.target.value,
                                        clientId: '' // Reset client when segment changes
                                    });
                                }}
                             >
                                <option value="Prefeitura">Prefeitura</option>
                                <option value="Câmara">Câmara</option>
                             </select>
                        </div>
                        <div>
                             <label className="block text-[13px] font-semibold text-slate-600 mb-2">Cliente</label>
                             <select 
                                className="block w-full rounded-xl border border-slate-200 bg-white py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                                value={currentProposal.clientId || ''}
                                onChange={e => setCurrentProposal({...currentProposal, clientId: e.target.value})}
                             >
                                <option value="">Selecione um cliente...</option>
                                {clients.filter(c => c.segment === currentProposal.segment).map(client => (
                                    <option key={client.id} value={client.id}>{client.city} - {client.cnpj}</option>
                                ))}
                             </select>
                        </div>
                        <Input 
                            label="Data de Emissão" 
                            type="date" 
                            value={currentProposal.date || ''} 
                            onChange={e => setCurrentProposal({...currentProposal, date: e.target.value})} 
                        />
                        <div>
                             <label className="block text-[13px] font-semibold text-slate-600 mb-2">Status</label>
                             <select 
                                className="block w-full rounded-xl border border-slate-200 bg-white py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                                value={currentProposal.status}
                                onChange={e => setCurrentProposal({...currentProposal, status: e.target.value as any})}
                             >
                                <option value="draft">Rascunho</option>
                                <option value="sent">Enviada</option>
                                <option value="approved">Aprovada</option>
                                <option value="rejected">Rejeitada</option>
                             </select>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
                     <div className="relative z-10">
                        <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">Valor Total</p>
                        <p className="text-3xl font-bold mt-1">
                            R$ {currentProposal.totalValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
                        </p>
                     </div>
                     <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-5 rounded-full"></div>
                </div>
            </div>

            {/* Right Column: Items */}
            <div className="lg:col-span-2">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-full">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Itens do Orçamento</h3>
                    
                    {/* Add Item Form */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                            <div className="md:col-span-12">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tipo de Item</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2">
                                        <input type="radio" name="itemType" checked={newItem.type === 'service' || !newItem.type} onChange={() => setNewItem({...newItem, type: 'service'})} />
                                        <span className="text-sm">Serviço (Mensalidade)</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="radio" name="itemType" checked={newItem.type === 'product'} onChange={() => setNewItem({...newItem, type: 'product'})} />
                                        <span className="text-sm">Produto (Quantidade x Valor Unitário)</span>
                                    </label>
                                </div>
                            </div>
                            <div className="md:col-span-12">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Serviço / Produto</label>
                                <select 
                                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-brand-500 focus:ring-brand-500 text-sm py-2"
                                    value={newItem.serviceId || ''}
                                    onChange={(e) => {
                                        const selectedService = services.find(s => s.id === e.target.value);
                                        setNewItem({
                                            ...newItem, 
                                            serviceId: e.target.value,
                                            serviceDescription: selectedService?.description || ''
                                        });
                                    }}
                                >
                                    <option value="">Selecione um serviço...</option>
                                    {services.filter(s => s.segment === currentProposal.segment).map(service => (
                                        <option key={service.id} value={service.id}>{service.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="md:col-span-12">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Descrição do Objeto</label>
                                <textarea 
                                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-brand-500 focus:ring-brand-500 text-sm py-2 px-3"
                                    rows={2}
                                    value={newItem.serviceDescription || ''}
                                    onChange={(e) => setNewItem({...newItem, serviceDescription: e.target.value})}
                                    placeholder="Descrição que sairá na proposta..."
                                />
                            </div>

                            {(!newItem.type || newItem.type === 'service') ? (
                                <>
                                    <div className="md:col-span-4">
                                        <Input label="Meses de Vigência" type="number" value={newItem.validityMonths ?? ''} onChange={e => setNewItem({...newItem, validityMonths: Number(e.target.value)})} className="mb-0" />
                                    </div>
                                    <div className="md:col-span-4">
                                        <Input label="Valor Mensal (R$)" type="number" value={newItem.monthlyValue ?? ''} onChange={e => setNewItem({...newItem, monthlyValue: Number(e.target.value)})} className="mb-0" />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="md:col-span-4">
                                        <Input label="Quantidade" type="number" value={newItem.quantity ?? ''} onChange={e => setNewItem({...newItem, quantity: Number(e.target.value)})} className="mb-0" />
                                    </div>
                                    <div className="md:col-span-4">
                                        <Input label="Valor Unitário (R$)" type="number" value={newItem.unitValue ?? ''} onChange={e => setNewItem({...newItem, unitValue: Number(e.target.value)})} className="mb-0" />
                                    </div>
                                </>
                            )}
                            
                            <div className="md:col-span-4">
                                <Button fullWidth onClick={handleAddItem} className="py-2.5">Adicionar</Button>
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Item</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Cálculo</th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Total</th>
                            <th scope="col" className="relative px-6 py-3"><span className="sr-only">Ações</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {currentProposal.items?.map((item) => {
                                const service = services.find(s => s.id === item.serviceId);
                                const description = item.serviceDescription || service?.description || service?.name || '';
                                return (
                            <tr key={item.id} className="hover:bg-slate-50/50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{description}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                {(!item.type || item.type === 'service') 
                                    ? `${item.validityMonths} meses x ${item.monthlyValue?.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}`
                                    : `${item.quantity} un x ${item.unitValue?.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}`
                                }
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-slate-800">
                                    {item.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button onClick={() => handleRemoveItem(item.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                                </td>
                            </tr>
                            )})}
                            {(!currentProposal.items || currentProposal.items.length === 0) && (
                            <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 text-sm">Nenhum item adicionado à proposta.</td></tr>
                            )}
                        </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
      </div>
    );
  }

  // --- VIEW: LISTAGEM ---
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestão de Propostas</h1>
          <p className="mt-1 text-sm text-gray-500">Crie, edite e gerencie seus orçamentos comerciais.</p>
        </div>
        <Button onClick={handleCreateNew}>+ Nova Proposta</Button>
      </div>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {proposals.length === 0 && (
              <li className="p-12 text-center text-slate-400">Nenhuma proposta encontrada. Crie uma nova.</li>
          )}
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <div className="px-6 py-5 hover:bg-slate-50 transition-colors group">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                     <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                     </div>
                     <div>
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-brand-600">{proposal.number}</p>
                            <span className="text-slate-300">•</span>
                            <p className="text-sm text-slate-500">
                                {proposal.date ? (() => {
                                    try {
                                        const [year, month, day] = proposal.date.split('T')[0].split('-');
                                        return `${day}/${month}/${year}`;
                                    } catch {
                                        return proposal.date;
                                    }
                                })() : ''}
                            </p>
                        </div>
                        <p className="text-lg font-bold text-slate-900 mt-1">
                            {clients.find(c => c.id === proposal.clientId)?.city || 'Cliente não encontrado'} - {proposal.segment}
                        </p>
                     </div>
                  </div>
                  
                  <div className="flex flex-col items-end">
                    <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-bold uppercase rounded-md border ${statusColors[proposal.status]}`}>
                      {statusLabels[proposal.status]}
                    </span>
                    <p className="mt-2 text-lg font-bold text-slate-800">
                      R$ {proposal.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                     <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(proposal.id)}>
                        Excluir
                     </Button>
                     <Button variant="secondary" className="text-xs" onClick={() => handleEdit(proposal)}>
                        Editar
                     </Button>
                     <Button variant="primary" className="text-xs shadow-none" onClick={() => handlePrint(proposal)}>
                        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        Gerar PDF
                     </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      
      {previewProposal && (
        <ProposalDocumentPreview 
            proposal={previewProposal} 
            onClose={() => setPreviewProposal(null)} 
        />
      )}
    </div>
  );
};
