import React, { useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { getClients, saveClient, deleteClient } from '../services/clientService';
import { getServices, saveService, deleteService } from '../services/serviceService';
import { Client, Service, Contract, Proposal, PaymentRequest } from '../types';

const ClientDetailsView = ({ client, onBack }: { client: Client, onBack: () => void }) => {
    const [contracts] = useState<Contract[]>(() => {
        const savedContracts = localStorage.getItem('axsys_contracts_db_v2');
        if (savedContracts) {
            const allContracts: Contract[] = JSON.parse(savedContracts);
            return allContracts.filter(c => c.clientId === client.id);
        }
        return [];
    });

    const [proposals] = useState<Proposal[]>(() => {
        const savedProposals = localStorage.getItem('axsys_proposals_db_v2');
        if (savedProposals) {
            const allProposals: Proposal[] = JSON.parse(savedProposals);
            return allProposals.filter(p => p.clientId === client.id);
        }
        return [];
    });

    const [paymentRequests] = useState<PaymentRequest[]>(() => {
        const savedPaymentRequests = localStorage.getItem('axsys_payment_requests_v2');
        if (savedPaymentRequests) {
            const allRequests: PaymentRequest[] = JSON.parse(savedPaymentRequests);
            return allRequests.filter(pr => pr.clientId === client.id);
        }
        return [];
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
                <button onClick={onBack} className="text-slate-500 hover:text-slate-800 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </button>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">{client.city}</h2>
                    <p className="text-sm text-slate-500">CNPJ: {client.cnpj} • Segmento: {client.segment}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Contracts */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Contratos ({contracts.length})
                        </h3>
                    </div>
                    <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                        {contracts.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">Nenhum contrato vinculado.</p>
                        ) : (
                            contracts.map(contract => (
                                <div key={contract.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-sm text-slate-800">{contract.contractNumber}</span>
                                        <span className="text-xs font-medium text-slate-500">R$ {contract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 line-clamp-2">{contract.object}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Proposals */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Propostas ({proposals.length})
                        </h3>
                    </div>
                    <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                        {proposals.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">Nenhuma proposta vinculada.</p>
                        ) : (
                            proposals.map(proposal => (
                                <div key={proposal.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-sm text-slate-800">{proposal.number}</span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                            proposal.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                                            proposal.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                                            proposal.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                                            'bg-slate-200 text-slate-700'
                                        }`}>
                                            {proposal.status === 'approved' ? 'Aprovada' :
                                             proposal.status === 'rejected' ? 'Rejeitada' :
                                             proposal.status === 'sent' ? 'Enviada' : 'Rascunho'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600">R$ {proposal.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Payment Requests */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            Solicitações de Pagamento ({paymentRequests.length})
                        </h3>
                    </div>
                    <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                        {paymentRequests.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">Nenhuma solicitação vinculada.</p>
                        ) : (
                            paymentRequests.map(request => (
                                <div key={request.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-sm text-slate-800">NF: {request.invoiceNumber}</span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                            request.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                                            request.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                                            'bg-amber-100 text-amber-700'
                                        }`}>
                                            {request.status === 'paid' ? 'Pago' :
                                             request.status === 'approved' ? 'Aprovado' : 'Pendente'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 mb-1 line-clamp-1">{request.description}</p>
                                    <p className="text-xs font-medium text-slate-800">R$ {request.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const Registrations = () => {
    const [subTab, setSubTab] = useState<'clients' | 'services'>('clients');
    
    const [clients, setClients] = useState<Client[]>(getClients);
    const [services, setServices] = useState<Service[]>(getServices);

    const [isAddingClient, setIsAddingClient] = useState(false);
    const [editingClient, setEditingClient] = useState<string | null>(null);
    const [clientForm, setClientForm] = useState({ city: '', segment: 'Prefeitura', cnpj: '' });

    const [isAddingService, setIsAddingService] = useState(false);
    const [editingService, setEditingService] = useState<string | null>(null);
    const [serviceForm, setServiceForm] = useState({ name: '', segment: 'Prefeitura', description: '' });

    const [selectedClientDetails, setSelectedClientDetails] = useState<Client | null>(null);

    // Client Handlers
    const handleSaveClient = () => {
        if (!clientForm.city || !clientForm.cnpj) return;
        
        const newClient: Client = {
            id: editingClient || Math.random().toString(),
            ...clientForm,
            used: editingClient ? clients.find(c => c.id === editingClient)?.used : false
        };
        saveClient(newClient);
        setClients(getClients());
        
        setIsAddingClient(false);
        setEditingClient(null);
        setClientForm({ city: '', segment: 'Prefeitura', cnpj: '' });
    };

    const handleEditClient = (client: any) => {
        setClientForm({ city: client.city, segment: client.segment, cnpj: client.cnpj });
        setEditingClient(client.id);
        setIsAddingClient(true);
    };

    const handleDeleteClient = (id: string) => {
        const client = clients.find(c => c.id === id);
        if (client?.used) {
            alert('Não é possível excluir este cliente pois ele já está vinculado a propostas ou contratos.');
            return;
        }
        deleteClient(id);
        setClients(getClients());
    };

    const cancelClientForm = () => {
        setIsAddingClient(false);
        setEditingClient(null);
        setClientForm({ city: '', segment: 'Prefeitura', cnpj: '' });
    };

    // Service Handlers
    const handleSaveService = () => {
        if (!serviceForm.name || !serviceForm.description) return;
        
        const newService: Service = {
            id: editingService || Math.random().toString(),
            ...serviceForm,
            used: editingService ? services.find(s => s.id === editingService)?.used : false
        };
        saveService(newService);
        setServices(getServices());
        
        setIsAddingService(false);
        setEditingService(null);
        setServiceForm({ name: '', segment: 'Prefeitura', description: '' });
    };

    const handleEditService = (service: any) => {
        setServiceForm({ name: service.name, segment: service.segment, description: service.description });
        setEditingService(service.id);
        setIsAddingService(true);
    };

    const handleDeleteService = (id: string) => {
        const service = services.find(s => s.id === id);
        if (service?.used) {
            alert('Não é possível excluir este serviço pois ele já foi utilizado em propostas ou contratos.');
            return;
        }
        deleteService(id);
        setServices(getServices());
    };

    const cancelServiceForm = () => {
        setIsAddingService(false);
        setEditingService(null);
        setServiceForm({ name: '', segment: 'Prefeitura', description: '' });
    };

    if (selectedClientDetails) {
        return <ClientDetailsView client={selectedClientDetails} onBack={() => setSelectedClientDetails(null)} />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex space-x-4 border-b border-slate-200 pb-2">
                <button
                    onClick={() => setSubTab('clients')}
                    className={`pb-2 text-sm font-bold transition-colors ${subTab === 'clients' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-slate-500 hover:text-slate-800'}`}
                >
                    Clientes
                </button>
                <button
                    onClick={() => setSubTab('services')}
                    className={`pb-2 text-sm font-bold transition-colors ${subTab === 'services' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-slate-500 hover:text-slate-800'}`}
                >
                    Serviços
                </button>
            </div>

            {subTab === 'clients' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-slate-800">Clientes Cadastrados</h3>
                        {!isAddingClient && (
                            <Button onClick={() => setIsAddingClient(true)}>
                                + Novo Cliente
                            </Button>
                        )}
                    </div>

                    {isAddingClient && (
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-800 mb-4">{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                <div className="md:col-span-4">
                                    <Input label="Município" value={clientForm.city} onChange={e => setClientForm({...clientForm, city: e.target.value})} className="mb-0 bg-white" />
                                </div>
                                <div className="md:col-span-3 mb-6">
                                    <label className="block text-[13px] font-semibold text-slate-600 mb-2">Segmento</label>
                                    <select 
                                        className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                                        value={clientForm.segment}
                                        onChange={e => setClientForm({...clientForm, segment: e.target.value})}
                                    >
                                        <option value="Prefeitura">Prefeitura</option>
                                        <option value="Câmara">Câmara</option>
                                    </select>
                                </div>
                                <div className="md:col-span-3">
                                    <Input label="CNPJ" value={clientForm.cnpj} onChange={e => setClientForm({...clientForm, cnpj: e.target.value})} className="mb-0 bg-white" />
                                </div>
                                <div className="md:col-span-2 flex gap-2 mb-6">
                                    <Button variant="secondary" onClick={cancelClientForm} className="flex-1 h-[46px]">Cancelar</Button>
                                    <Button onClick={handleSaveClient} className="flex-1 h-[46px]">Salvar</Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white shadow-sm border border-slate-100 rounded-xl overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Município</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Segmento</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">CNPJ</th>
                                    <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {clients.map(client => (
                                    <tr key={client.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{client.city}</td>
                                        <td className="px-6 py-4 text-sm text-slate-500">
                                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                                                {client.segment}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-500">{client.cnpj}</td>
                                        <td className="px-6 py-4 text-sm text-right space-x-2">
                                            <button onClick={() => setSelectedClientDetails(client)} className="text-slate-600 hover:text-slate-800 font-medium">Ver Detalhes</button>
                                            <button onClick={() => handleEditClient(client)} className="text-brand-600 hover:text-brand-800 font-medium">Editar</button>
                                            <button onClick={() => handleDeleteClient(client.id)} className="text-rose-600 hover:text-rose-800 font-medium">Excluir</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {subTab === 'services' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-slate-800">Serviços Cadastrados</h3>
                        {!isAddingService && (
                            <Button onClick={() => setIsAddingService(true)}>
                                + Novo Serviço
                            </Button>
                        )}
                    </div>

                    {isAddingService && (
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-800 mb-4">{editingService ? 'Editar Serviço' : 'Novo Serviço'}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                                <div className="md:col-span-5">
                                    <Input label="Nome do Serviço" value={serviceForm.name} onChange={e => setServiceForm({...serviceForm, name: e.target.value})} className="mb-0 bg-white" />
                                </div>
                                <div className="md:col-span-3 mb-6">
                                    <label className="block text-[13px] font-semibold text-slate-600 mb-2">Segmento</label>
                                    <select 
                                        className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                                        value={serviceForm.segment}
                                        onChange={e => setServiceForm({...serviceForm, segment: e.target.value})}
                                    >
                                        <option value="Prefeitura">Prefeitura</option>
                                        <option value="Câmara">Câmara</option>
                                    </select>
                                </div>
                                <div className="md:col-span-12 mb-6">
                                    <label className="block text-[13px] font-semibold text-slate-600 mb-2">Descrição do Objeto</label>
                                    <textarea 
                                        className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 min-h-[100px]"
                                        placeholder="Descrição detalhada que será usada nas propostas..."
                                        value={serviceForm.description}
                                        onChange={e => setServiceForm({...serviceForm, description: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-12 flex justify-end gap-2 mt-2">
                                    <Button variant="secondary" onClick={cancelServiceForm}>Cancelar</Button>
                                    <Button onClick={handleSaveService}>Salvar</Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white shadow-sm border border-slate-100 rounded-xl overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Nome do Serviço</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Segmento</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Descrição do Objeto</th>
                                    <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {services.map(service => (
                                    <tr key={service.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{service.name}</td>
                                        <td className="px-6 py-4 text-sm text-slate-500">
                                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                                                {service.segment}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate" title={service.description}>
                                            {service.description}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right space-x-2 whitespace-nowrap">
                                            <button onClick={() => handleEditService(service)} className="text-brand-600 hover:text-brand-800 font-medium">Editar</button>
                                            <button onClick={() => handleDeleteService(service.id)} className="text-rose-600 hover:text-rose-800 font-medium">Excluir</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
