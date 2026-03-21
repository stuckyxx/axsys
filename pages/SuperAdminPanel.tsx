import React, { useState, useEffect } from 'react';
import { Company, User, UserRole, BankAccount, SystemModule } from '../types';
import { getCompanies, saveCompany, deleteCompany } from '../services/companyService';
import { getAllUsers, registerMock, deleteUserMock, updateUserDetailsMock, updateUserModulesMock } from '../services/authService';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Switch } from '../components/Switch';

export const SuperAdminPanel = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'companies'>('overview');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Detailed View State
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companyTab, setCompanyTab] = useState<'dados' | 'bancos' | 'usuarios'>('dados');

  // Company Form State
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [currentCompany, setCurrentCompany] = useState<Partial<Company>>({});
  const [newCompanyAdminPassword, setNewCompanyAdminPassword] = useState('');

  // Bank Form State
  const [isEditingBank, setIsEditingBank] = useState(false);
  const [currentBank, setCurrentBank] = useState<Partial<BankAccount>>({});

  // User Form State
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [currentUser, setCurrentUser] = useState<Partial<User> & { password?: string }>({});
  const [selectedModules, setSelectedModules] = useState<SystemModule[]>([]);

  const loadData = React.useCallback(() => {
    Promise.all([
      Promise.resolve(getCompanies()),
      getAllUsers()
    ]).then(([loadedCompanies, allUsers]) => {
      setCompanies(loadedCompanies);
      setUsers(allUsers);
      
      // Update selected company if it exists
      setSelectedCompany(prev => {
        if (prev) {
          const updated = loadedCompanies.find(c => c.id === prev.id);
          return updated || prev;
        }
        return prev;
      });
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Company Management ---
  const handleSaveCompany = async () => {
    if (!currentCompany.corporateName || !currentCompany.cnpj || !currentCompany.email) {
      alert('Razão Social, CNPJ e E-mail são obrigatórios.');
      return;
    }

    const isNew = !currentCompany.id;

    if (isNew && !newCompanyAdminPassword) {
      alert('Para uma nova empresa, a senha do administrador é obrigatória.');
      return;
    }

    const newCompany: Company = {
      id: currentCompany.id || `comp-${Date.now()}`,
      corporateName: currentCompany.corporateName || '',
      cnpj: currentCompany.cnpj || '',
      street: currentCompany.street || '',
      number: currentCompany.number || '',
      neighborhood: currentCompany.neighborhood || '',
      zipCode: currentCompany.zipCode || '',
      city: currentCompany.city || '',
      state: currentCompany.state || '',
      address: `${currentCompany.street || ''}, ${currentCompany.number || ''} - ${currentCompany.neighborhood || ''}, ${currentCompany.city || ''} - ${currentCompany.state || ''}, ${currentCompany.zipCode || ''}`,
      representative: currentCompany.representative || '',
      cpf: currentCompany.cpf || '',
      email: currentCompany.email || '',
      taxRate: currentCompany.taxRate || 0,
      banks: currentCompany.banks || [],
      logoUrl: currentCompany.logoUrl || '',
      letterheadUrl: currentCompany.letterheadUrl || '',
      signatureUrl: currentCompany.signatureUrl || ''
    };

    saveCompany(newCompany);

    if (isNew) {
      // Create the first admin user for this company
      try {
        await registerMock({
          firstName: `Admin - ${newCompany.corporateName}`,
          email: newCompany.email,
          password: newCompanyAdminPassword,
          role: UserRole.COMPANY_ADMIN,
          companyId: newCompany.id,
          allowedModules: [SystemModule.ADMINISTRATIVE, SystemModule.FINANCIAL, SystemModule.CERTIFICATES, SystemModule.SYSTEM_ADMIN]
        });
      } catch (e) {
        console.error("Erro ao criar usuário admin da empresa", e);
      }
    }

    setIsEditingCompany(false);
    setCurrentCompany({});
    setNewCompanyAdminPassword('');
    loadData();
  };

  const handleDeleteCompany = (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta empresa? Todos os usuários vinculados perderão o acesso.')) {
      deleteCompany(id);
      if (selectedCompany?.id === id) {
        setSelectedCompany(null);
      }
      loadData();
    }
  };

  // --- Bank Management ---
  const handleSaveBank = () => {
    if (!selectedCompany || !currentBank.name || !currentBank.agency || !currentBank.account) {
      alert('Preencha todos os campos do banco.');
      return;
    }

    const newBank: BankAccount = {
      id: currentBank.id || `bank-${Date.now()}`,
      name: currentBank.name,
      agency: currentBank.agency,
      account: currentBank.account
    };

    let updatedBanks = [...(selectedCompany.banks || [])];
    if (currentBank.id) {
      updatedBanks = updatedBanks.map(b => b.id === currentBank.id ? newBank : b);
    } else {
      updatedBanks.push(newBank);
    }

    saveCompany({ ...selectedCompany, banks: updatedBanks });
    setIsEditingBank(false);
    setCurrentBank({});
    loadData();
  };

  const handleDeleteBank = (bankId: string) => {
    if (confirm('Excluir esta conta bancária?') && selectedCompany) {
      const updatedBanks = selectedCompany.banks.filter(b => b.id !== bankId);
      saveCompany({ ...selectedCompany, banks: updatedBanks });
      loadData();
    }
  };

  // --- User Management ---
  const handleSaveUser = async () => {
    if (!selectedCompany || !currentUser.name || !currentUser.email) {
      alert('Nome e E-mail são obrigatórios.');
      return;
    }

    try {
      if (currentUser.id) {
        // Edit existing user
        await updateUserDetailsMock(currentUser.id, {
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role
        });
        await updateUserModulesMock(currentUser.id, selectedModules);
        alert('Usuário atualizado com sucesso!');
      } else {
        // Create new user
        if (!currentUser.password) {
          alert('Senha é obrigatória para novos usuários.');
          return;
        }
        await registerMock({
          firstName: currentUser.name,
          email: currentUser.email,
          password: currentUser.password,
          role: currentUser.role || UserRole.USER,
          companyId: selectedCompany.id,
          allowedModules: selectedModules
        });
        alert('Usuário criado com sucesso!');
      }
      
      setIsEditingUser(false);
      setCurrentUser({});
      setSelectedModules([]);
      loadData();
    } catch {
      alert('Erro ao salvar usuário.');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm('Tem certeza que deseja excluir este usuário?')) {
      try {
        await deleteUserMock(userId);
        loadData();
      } catch {
        alert('Erro ao excluir usuário.');
      }
    }
  };

  const handleToggleModule = (module: SystemModule) => {
    setSelectedModules(prev => 
      prev.includes(module) 
        ? prev.filter(m => m !== module)
        : [...prev, module]
    );
  };

  const totalBanks = companies.reduce((acc, curr) => acc + (curr.banks?.length || 0), 0);
  const companyUsers = selectedCompany ? users.filter(u => u.companyId === selectedCompany.id) : [];

  const modulesList = [
    { key: SystemModule.ADMINISTRATIVE, label: 'Módulo Administrativo', desc: 'Cadastros, Propostas, Contratos' },
    { key: SystemModule.FINANCIAL, label: 'Módulo Financeiro', desc: 'Receitas, Despesas, Fluxo de Caixa' },
    { key: SystemModule.CERTIFICATES, label: 'Módulo Certidões', desc: 'Gestão de validade e arquivos' },
    { key: SystemModule.SYSTEM_ADMIN, label: 'Administração do Sistema', desc: 'Gestão de usuários da empresa' },
  ];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Gestão de Empresas (Super Admin)</h1>
          <p className="mt-1 text-sm text-gray-500">Controle global de empresas, usuários e permissões.</p>
        </div>
      </div>

      {/* Main Navigation */}
      {!selectedCompany && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'overview'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Visão Geral
            </button>
            <button
              onClick={() => setActiveTab('companies')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'companies'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Empresas Cadastradas
            </button>
          </nav>
        </div>
      )}

      {/* Tab Content: Overview */}
      {!selectedCompany && activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="bg-white overflow-hidden shadow rounded-xl border border-gray-100">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-3 bg-blue-100 rounded-lg">
                      <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total de Empresas</dt>
                      <dd className="flex items-baseline">
                        <div className="text-2xl font-semibold text-gray-900">{companies.length}</div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-5 py-3">
                <div className="text-sm">
                  <button onClick={() => setActiveTab('companies')} className="font-medium text-blue-700 hover:text-blue-900">Ver todas as empresas</button>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-xl border border-gray-100">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-3 bg-green-100 rounded-lg">
                      <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total de Usuários</dt>
                      <dd className="flex items-baseline">
                        <div className="text-2xl font-semibold text-gray-900">{users.length}</div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-xl border border-gray-100">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="p-3 bg-purple-100 rounded-lg">
                      <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Contas Bancárias</dt>
                      <dd className="flex items-baseline">
                        <div className="text-2xl font-semibold text-gray-900">{totalBanks}</div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Companies List */}
      {!selectedCompany && activeTab === 'companies' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Empresas Cadastradas</h2>
            <Button onClick={() => { setIsEditingCompany(true); setCurrentCompany({}); setNewCompanyAdminPassword(''); }}>
              Nova Empresa
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map(company => (
              <div key={company.id} className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 flex flex-col">
                <div className="px-4 py-5 sm:p-6 flex-1">
                  <h3 className="text-lg leading-6 font-bold text-gray-900">{company.corporateName}</h3>
                  <p className="mt-1 text-sm text-gray-500">CNPJ: {company.cnpj}</p>
                  <p className="mt-1 text-sm text-gray-500">Email: {company.email}</p>
                  
                  <div className="mt-4 flex items-center text-sm text-gray-500">
                    <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    {users.filter(u => u.companyId === company.id).length} usuários vinculados
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-4 sm:px-6 flex justify-between items-center border-t border-gray-100">
                  <Button variant="outline" onClick={() => setSelectedCompany(company)}>
                    Gerenciar Empresa
                  </Button>
                  <button onClick={() => handleDeleteCompany(company.id)} className="text-red-600 hover:text-red-800 p-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Company View */}
      {selectedCompany && (
        <div className="space-y-6 animate-fade-in-up">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setSelectedCompany(null)}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            </button>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{selectedCompany.corporateName}</h2>
              <p className="text-sm text-gray-500">CNPJ: {selectedCompany.cnpj}</p>
            </div>
          </div>

          <div className="bg-white shadow rounded-xl border border-gray-200 overflow-hidden">
            <div className="border-b border-gray-200 bg-gray-50 px-4 sm:px-6">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setCompanyTab('dados')}
                  className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    companyTab === 'dados'
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Dados da Empresa
                </button>
                <button
                  onClick={() => setCompanyTab('usuarios')}
                  className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    companyTab === 'usuarios'
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Usuários & Permissões
                </button>
                <button
                  onClick={() => setCompanyTab('bancos')}
                  className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    companyTab === 'bancos'
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Contas Bancárias
                </button>
              </nav>
            </div>

            <div className="p-6">
              {/* Company Data Tab */}
              {companyTab === 'dados' && (
                <div className="space-y-6 max-w-3xl">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-900">Informações Cadastrais</h3>
                    <Button variant="outline" onClick={() => { setIsEditingCompany(true); setCurrentCompany(selectedCompany); }}>
                      Editar Dados
                    </Button>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">Razão Social</dt>
                      <dd className="mt-1 text-sm text-gray-900">{selectedCompany.corporateName}</dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">CNPJ</dt>
                      <dd className="mt-1 text-sm text-gray-900">{selectedCompany.cnpj}</dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">E-mail de Contato</dt>
                      <dd className="mt-1 text-sm text-gray-900">{selectedCompany.email}</dd>
                    </div>
                    <div className="sm:col-span-1">
                      <dt className="text-sm font-medium text-gray-500">Representante</dt>
                      <dd className="mt-1 text-sm text-gray-900">{selectedCompany.representative || '-'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Endereço Completo</dt>
                      <dd className="mt-1 text-sm text-gray-900">{selectedCompany.address || '-'}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Company Users Tab */}
              {companyTab === 'usuarios' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-900">Usuários Vinculados</h3>
                    <Button onClick={() => { 
                      setIsEditingUser(true); 
                      setCurrentUser({ role: UserRole.USER }); 
                      setSelectedModules([SystemModule.ADMINISTRATIVE]); 
                    }}>
                      Novo Usuário
                    </Button>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <ul className="divide-y divide-gray-200">
                      {companyUsers.map(user => (
                        <li key={user.id} className="p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="flex-shrink-0">
                                <img className="h-10 w-10 rounded-full" src={user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`} alt="" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                                <p className="text-sm text-gray-500">{user.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-4">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.role === UserRole.COMPANY_ADMIN ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                                {user.role === UserRole.COMPANY_ADMIN ? 'Admin da Empresa' : 'Usuário Padrão'}
                              </span>
                              <div className="flex space-x-2">
                                <Button variant="outline" size="sm" onClick={() => {
                                  setCurrentUser(user);
                                  setSelectedModules(user.allowedModules || []);
                                  setIsEditingUser(true);
                                }}>
                                  Editar
                                </Button>
                                <button onClick={() => handleDeleteUser(user.id)} className="text-red-600 hover:text-red-800 p-1">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 ml-14">
                            <p className="text-xs text-gray-500 font-medium mb-1">Módulos de Acesso:</p>
                            <div className="flex flex-wrap gap-1">
                              {user.allowedModules?.map(mod => (
                                <span key={mod} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">
                                  {modulesList.find(m => m.key === mod)?.label || mod}
                                </span>
                              ))}
                              {(!user.allowedModules || user.allowedModules.length === 0) && (
                                <span className="text-xs text-gray-400 italic">Nenhum módulo liberado</span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                      {companyUsers.length === 0 && (
                        <li className="p-8 text-center text-gray-500">
                          Nenhum usuário cadastrado para esta empresa.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* Company Banks Tab */}
              {companyTab === 'bancos' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-900">Contas Bancárias</h3>
                    <Button onClick={() => { setIsEditingBank(true); setCurrentBank({}); }}>
                      Adicionar Conta
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {selectedCompany.banks && selectedCompany.banks.length > 0 ? (
                      selectedCompany.banks.map(bank => (
                        <div key={bank.id} className="bg-white border border-gray-200 rounded-lg p-4 flex justify-between items-center shadow-sm">
                          <div>
                            <p className="font-bold text-gray-900">{bank.name}</p>
                            <p className="text-sm text-gray-500">Agência: {bank.agency}</p>
                            <p className="text-sm text-gray-500">Conta: {bank.account}</p>
                          </div>
                          <button onClick={() => handleDeleteBank(bank.id)} className="text-red-500 hover:text-red-700 p-2 bg-red-50 rounded-full">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-full p-8 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg">
                        Nenhuma conta bancária cadastrada.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {isEditingCompany && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-xl leading-6 font-bold text-gray-900 mb-6">
                  {currentCompany.id ? 'Editar Empresa' : 'Cadastrar Nova Empresa'}
                </h3>
                <div className="space-y-4">
                  <Input label="Nome da Empresa (Razão Social)" value={currentCompany.corporateName || ''} onChange={e => setCurrentCompany({...currentCompany, corporateName: e.target.value})} required />
                  <Input label="CNPJ" value={currentCompany.cnpj || ''} onChange={e => setCurrentCompany({...currentCompany, cnpj: e.target.value})} required />
                  <Input label="E-mail de Contato" type="email" value={currentCompany.email || ''} onChange={e => setCurrentCompany({...currentCompany, email: e.target.value})} required />
                  
                  {!currentCompany.id && (
                    <div className="pt-4 border-t border-gray-100 mt-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Acesso do Administrador da Empresa</h4>
                      <p className="text-xs text-gray-500 mb-4">Um usuário administrador será criado automaticamente com o e-mail acima.</p>
                      <Input label="Senha do Administrador" type="password" value={newCompanyAdminPassword} onChange={e => setNewCompanyAdminPassword(e.target.value)} required placeholder="Defina uma senha provisória" />
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setIsEditingCompany(false)}>Cancelar</Button>
                <Button onClick={handleSaveCompany}>Salvar Empresa</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditingBank && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-xl leading-6 font-bold text-gray-900 mb-6">
                  Nova Conta Bancária
                </h3>
                <div className="space-y-4">
                  <Input label="Nome do Banco" value={currentBank.name || ''} onChange={e => setCurrentBank({...currentBank, name: e.target.value})} />
                  <Input label="Agência" value={currentBank.agency || ''} onChange={e => setCurrentBank({...currentBank, agency: e.target.value})} />
                  <Input label="Conta Corrente" value={currentBank.account || ''} onChange={e => setCurrentBank({...currentBank, account: e.target.value})} />
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setIsEditingBank(false)}>Cancelar</Button>
                <Button onClick={handleSaveBank}>Salvar Conta</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditingUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-xl leading-6 font-bold text-gray-900 mb-6">
                  {currentUser.id ? 'Editar Usuário' : 'Novo Usuário para a Empresa'}
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-gray-700 border-b pb-2">Dados de Acesso</h4>
                    <Input label="Nome Completo" value={currentUser.name || ''} onChange={e => setCurrentUser({...currentUser, name: e.target.value})} required />
                    <Input label="E-mail" type="email" value={currentUser.email || ''} onChange={e => setCurrentUser({...currentUser, email: e.target.value})} required />
                    {!currentUser.id && (
                      <Input label="Senha Provisória" type="password" value={currentUser.password || ''} onChange={e => setCurrentUser({...currentUser, password: e.target.value})} required />
                    )}
                    
                    <div className="pt-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nível de Acesso</label>
                      <select 
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-sm"
                        value={currentUser.role || UserRole.USER}
                        onChange={e => setCurrentUser({...currentUser, role: e.target.value as UserRole})}
                      >
                        <option value={UserRole.USER}>Usuário Padrão</option>
                        <option value={UserRole.COMPANY_ADMIN}>Administrador da Empresa</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-semibold text-gray-700 border-b pb-2">Permissões de Módulos</h4>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                      {modulesList.map((mod) => {
                        const isEnabled = selectedModules.includes(mod.key);
                        return (
                          <div key={mod.key} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isEnabled ? 'bg-brand-50/50 border-brand-100' : 'bg-white border-gray-200'}`}>
                            <div>
                              <p className={`text-sm font-bold ${isEnabled ? 'text-gray-900' : 'text-gray-500'}`}>{mod.label}</p>
                              <p className="text-xs text-gray-400">{mod.desc}</p>
                            </div>
                            <Switch 
                              checked={isEnabled} 
                              onChange={() => handleToggleModule(mod.key)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setIsEditingUser(false)}>Cancelar</Button>
                <Button onClick={handleSaveUser}>Salvar Usuário</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
