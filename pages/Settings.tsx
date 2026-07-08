import React, { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { updateUserDetailsMock } from '../services/authService';
import { buildCompanyAddress, getCompanyById, saveCompany, fileToBase64, getCompanySettings } from '../services/companyService';
import { Company, SystemModule, UserRole } from '../types';

export const Settings: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'company'>('profile');
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const canEditCompanyData = !!user && (
    user.role === UserRole.SUPER_ADMIN ||
    user.role === UserRole.COMPANY_ADMIN ||
    user.allowedModules.includes(SystemModule.ADMINISTRATIVE)
  );
  const canViewCompanyData = canEditCompanyData || !!user?.allowedModules.includes(SystemModule.FINANCIAL);

  const [profileData, setProfileData] = useState({
    name: '',
    email: '',
    avatarUrl: '',
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [companyData, setCompanyData] = useState<Company | null>(null);

  useEffect(() => {
    if (user) {
      setProfileData({
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || '',
      });

      if (user.companyId) {
        const company = getCompanyById(user.companyId);
        if (company) {
          setCompanyData(company);
        } else {
          setCompanyData(getCompanySettings());
        }
      } else {
        setCompanyData(getCompanySettings());
      }
    }
  }, [user]);

  useEffect(() => {
    if (!canViewCompanyData && activeTab === 'company') {
      setActiveTab('profile');
    }
  }, [activeTab, canViewCompanyData]);

  useTrackedStorageRefresh({
    trackedKeys: ['axsys_companies_db_v2', 'axsys_users_db_v3'],
    user,
    refresh: () => {
      if (!user) {
        return;
      }

      if (user.companyId) {
        setCompanyData(getCompanyById(user.companyId) || getCompanySettings());
      } else {
        setCompanyData(getCompanySettings());
      }
    },
  });

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfileData(prev => ({ ...prev, avatarUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    try {
      const updatedUser = await updateUserDetailsMock(user.id, profileData);
      refreshUser(updatedUser);
      showNotification('success', 'Perfil atualizado com sucesso!');
    } catch {
      showNotification('error', 'Erro ao atualizar perfil.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleTimbradoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditCompanyData) {
      showNotification('error', 'Você não tem permissão para editar os dados da empresa.');
      return;
    }

    if (e.target.files?.[0] && companyData) {
      try {
        const base64 = await fileToBase64(e.target.files[0]);
        setCompanyData({ ...companyData, letterheadUrl: base64 });
      } catch {
        showNotification('error', 'Erro ao processar imagem do timbrado.');
      }
    }
  };

  const handleAssinaturaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditCompanyData) {
      showNotification('error', 'Você não tem permissão para editar os dados da empresa.');
      return;
    }

    if (e.target.files?.[0] && companyData) {
      try {
        const base64 = await fileToBase64(e.target.files[0]);
        setCompanyData({ ...companyData, signatureUrl: base64 });
      } catch {
        showNotification('error', 'Erro ao processar imagem da assinatura.');
      }
    }
  };

  const handleSaveCompany = () => {
    if (!companyData) return;

    if (!canEditCompanyData) {
      showNotification('error', 'Você não tem permissão para editar os dados da empresa.');
      return;
    }

    try {
      const fullAddress = buildCompanyAddress(companyData);
      const dataToSave = { ...companyData, address: fullAddress };

      saveCompany(dataToSave);
      setCompanyData(dataToSave);
      showNotification('success', 'Dados da empresa salvos com sucesso!');
    } catch {
      showNotification('error', 'Erro ao salvar dados da empresa.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up relative">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white font-medium flex items-center gap-2 animate-fade-in-up ${notification.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {notification.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          )}
          {notification.message}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-1 text-sm text-gray-500">Gerencie seu perfil pessoal e dados da empresa.</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('profile')}
            className={`${
              activeTab === 'profile'
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
          >
            Meu Perfil
          </button>
          {canViewCompanyData && (
            <button
              onClick={() => setActiveTab('company')}
              className={`${
                activeTab === 'company'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              Dados da Empresa
            </button>
          )}
        </nav>
      </div>

      <div className="bg-white shadow rounded-lg border border-slate-100">
        {activeTab === 'profile' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-6 mb-6">
              <div className="relative group">
                <img
                  src={profileData.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(profileData.name)}&background=random`}
                  alt="Avatar"
                  className="w-24 h-24 rounded-full object-cover ring-4 ring-slate-50 group-hover:ring-brand-200 transition-all"
                />
                <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 bg-brand-600 p-2 rounded-full text-white cursor-pointer hover:bg-brand-700 transition-colors shadow-lg hover:scale-110 transform">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <input id="avatar-upload" type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                </label>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{profileData.name}</h3>
                <p className="text-sm text-gray-500">{user?.role === 'ADMIN' ? 'Administrador do Sistema' : 'Cliente Corporativo'}</p>
                <label htmlFor="avatar-upload" className="text-xs text-brand-600 font-medium cursor-pointer hover:underline mt-1 block">Alterar foto</label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Nome Completo"
                value={profileData.name}
                onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
              />
              <Input
                label="E-mail de Acesso"
                value={profileData.email}
                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
              />
              <div className="col-span-1 md:col-span-2">
                <Input
                  label="URL do Avatar (Opcional)"
                  value={profileData.avatarUrl}
                  onChange={(e) => setProfileData({ ...profileData, avatarUrl: e.target.value })}
                  placeholder="https://..."
                />
                <p className="text-xs text-gray-400 mt-1">Você pode fazer upload clicando na foto ou colar uma URL externa aqui.</p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-100">
              <Button onClick={handleSaveProfile} isLoading={isSavingProfile}>
                Salvar Alterações
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'company' && companyData && canViewCompanyData && (
          <div className="divide-y divide-gray-200">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">Dados da Empresa (para Relatórios)</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {canEditCompanyData
                      ? 'Usuários administrativos podem atualizar essas informações.'
                      : 'Você pode consultar os dados da empresa, mas não tem permissão para editá-los.'}
                  </p>
                </div>
                {!canEditCompanyData && (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    Somente leitura
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                <div className="sm:col-span-6">
                  <Input
                    label="Razão Social"
                    value={companyData.corporateName || ''}
                    onChange={(e) => setCompanyData({ ...companyData, corporateName: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-6">
                  <Input
                    label="CNPJ"
                    value={companyData.cnpj || ''}
                    onChange={(e) => setCompanyData({ ...companyData, cnpj: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-4">
                  <Input
                    label="Rua"
                    value={companyData.street || ''}
                    onChange={(e) => setCompanyData({ ...companyData, street: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Input
                    label="Número"
                    value={companyData.number || ''}
                    onChange={(e) => setCompanyData({ ...companyData, number: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label="Bairro"
                    value={companyData.neighborhood || ''}
                    onChange={(e) => setCompanyData({ ...companyData, neighborhood: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label="CEP"
                    value={companyData.zipCode || ''}
                    onChange={(e) => setCompanyData({ ...companyData, zipCode: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label="Municipio"
                    value={companyData.city || ''}
                    onChange={(e) => setCompanyData({ ...companyData, city: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label="UF"
                    value={companyData.state || ''}
                    onChange={(e) => setCompanyData({ ...companyData, state: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-6">
                  <Input
                    label="Representante Legal"
                    value={companyData.representative || ''}
                    onChange={(e) => setCompanyData({ ...companyData, representative: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-6">
                  <Input
                    label="CPF do Representante"
                    value={companyData.cpf || ''}
                    onChange={(e) => setCompanyData({ ...companyData, cpf: e.target.value })}
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timbrado (Imagem)</label>
                  <div className="flex items-center gap-4">
                    <label
                      htmlFor="file-upload-timbrado-inline"
                      className={`py-2 px-3 border rounded-md shadow-sm text-sm leading-4 font-medium transition-colors ${
                        canEditCompanyData
                          ? 'cursor-pointer bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400'
                      }`}
                    >
                      Escolher arquivo
                      <input
                        id="file-upload-timbrado-inline"
                        name="file-upload-timbrado-inline"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleTimbradoUpload}
                        disabled={!canEditCompanyData}
                      />
                    </label>
                    <span className="text-sm text-gray-500">{companyData.letterheadUrl ? 'Arquivo selecionado' : 'Nenhum arquivo escolhido'}</span>
                  </div>
                  {companyData.letterheadUrl && (
                    <div className="mt-2">
                      <img src={companyData.letterheadUrl} alt="Timbrado Preview" className="h-20 object-contain border border-gray-200" />
                    </div>
                  )}
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contas Bancárias (Gerenciadas pelo Administrador do Sistema)</label>
                  {companyData.banks && companyData.banks.length > 0 ? (
                    <div className="space-y-3">
                      {companyData.banks.map(bank => (
                        <div key={bank.id} className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                          <p className="text-sm font-bold text-gray-800">{bank.name}</p>
                          <p className="text-xs text-gray-600">Agência: {bank.agency} | Conta: {bank.account}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">Nenhuma conta bancária cadastrada.</p>
                  )}
                </div>

                <div className="sm:col-span-6">
                  <Input
                    label="Aliquota Padrão de Imposto (%)"
                    value={companyData.taxRate?.toString() || ''}
                    onChange={(e) => setCompanyData({ ...companyData, taxRate: parseFloat(e.target.value) || 0 })}
                    type="number"
                    disabled={!canEditCompanyData}
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Imagem da Assinatura (PNG com fundo transparente)</label>
                  <div className="flex items-center gap-4">
                    <label
                      htmlFor="file-upload-sig-inline"
                      className={`py-2 px-3 border rounded-md shadow-sm text-sm leading-4 font-medium transition-colors ${
                        canEditCompanyData
                          ? 'cursor-pointer bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400'
                      }`}
                    >
                      Escolher arquivo
                      <input
                        id="file-upload-sig-inline"
                        name="file-upload-sig-inline"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleAssinaturaUpload}
                        disabled={!canEditCompanyData}
                      />
                    </label>
                    <span className="text-sm text-gray-500">{companyData.signatureUrl ? 'Arquivo selecionado' : 'Nenhum arquivo escolhido'}</span>
                  </div>
                  {companyData.signatureUrl && (
                    <div className="mt-2">
                      <img src={companyData.signatureUrl} alt="Assinatura Preview" className="h-16 object-contain border border-gray-200 bg-gray-50" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {canEditCompanyData && (
              <div className="p-4 flex justify-end">
                <Button onClick={handleSaveCompany}>Salvar Dados da Empresa</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
