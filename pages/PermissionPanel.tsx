
import React, { useState, useEffect } from 'react';
import { User, SystemModule, UserRole } from '../types';
import { getAllUsers, updateUserModulesMock, resetUserPasswordMock, deleteUserMock, updateUserDetailsMock } from '../services/authService';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Switch } from '../components/Switch';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// Simple Password Reset Modal
const ResetPasswordModal = ({ isOpen, onClose, userName, onConfirm }: { isOpen: boolean; onClose: () => void; userName: string; onConfirm: (pass: string) => void }) => {
    const [password, setPassword] = useState('');
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Redefinir Senha</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        Defina uma nova senha de acesso para <strong>{userName}</strong>.
                    </p>
                    <Input 
                        label="Nova Senha" 
                        type="text" 
                        value={password} 
                        onChange={(e) => setPassword(e.target.value)} 
                        placeholder="Digite a nova senha..."
                        autoFocus
                    />
                    <div className="flex gap-3 justify-end mt-6">
                        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                        <Button 
                            onClick={() => onConfirm(password)} 
                            disabled={!password || password.length < 3}
                            className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
                        >
                            Alterar Senha
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Edit User Details Modal
const EditUserModal = ({ isOpen, onClose, user, onConfirm, isLoading }: { isOpen: boolean; onClose: () => void; user: User | null; onConfirm: (name: string, email: string) => void; isLoading: boolean }) => {
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');

    React.useEffect(() => {
        if (user) {
            setName(user.name || '');
            setEmail(user.email || '');
        }
    }, [user, isOpen]);

    if (!isOpen || !user) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                    <h3 className="text-lg font-bold text-slate-800">Editar Dados do Usuário</h3>
                </div>
                <div className="p-6 space-y-4">
                    <Input 
                        label="Nome Completo" 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                    />
                    <Input 
                        label="E-mail" 
                        type="email"
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)} 
                    />
                    <div className="flex gap-3 justify-end mt-6">
                        <Button variant="ghost" onClick={onClose} disabled={isLoading}>Cancelar</Button>
                        <Button 
                            onClick={() => onConfirm(name, email)} 
                            isLoading={isLoading}
                            disabled={!name || !email}
                        >
                            Salvar Alterações
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Delete Confirmation Modal
const DeleteUserModal = ({ isOpen, onClose, userName, onConfirm, isLoading }: { isOpen: boolean; onClose: () => void; userName: string; onConfirm: () => void; isLoading: boolean }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 text-center">
                    <div className="w-12 h-12 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
                        <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Excluir Usuário?</h3>
                    <p className="text-sm text-slate-500 mb-6">
                        Tem certeza que deseja remover <strong>{userName}</strong>? Esta ação não pode ser desfeita e todos os dados associados serão perdidos.
                    </p>
                    <div className="flex gap-3 justify-center">
                        <Button variant="ghost" onClick={onClose} disabled={isLoading}>Cancelar</Button>
                        <Button 
                            variant="danger"
                            onClick={onConfirm} 
                            isLoading={isLoading}
                        >
                            Sim, Excluir
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const PermissionPanel: React.FC = () => {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  
  // Reset Password State
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<User | null>(null);

  // Edit User State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Delete User State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
      setLoading(true);
      const data = await getAllUsers();
      setUsers(data);
      setLoading(false);
  };

  const handleToggle = (userId: string, module: SystemModule) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      
      const hasModule = u.allowedModules.includes(module);
      let newModules: SystemModule[];
      
      if (hasModule) {
        newModules = u.allowedModules.filter(m => m !== module);
      } else {
        newModules = [...u.allowedModules, module];
      }

      return { ...u, allowedModules: newModules };
    }));
  };

  const handleSavePermissions = async (userToSave: User) => {
    setSavingId(userToSave.id);
    try {
      await updateUserModulesMock(userToSave.id, userToSave.allowedModules);
    } catch {
      alert('Erro ao salvar permissões');
    } finally {
      setSavingId(null);
    }
  };

  const openResetModal = (user: User) => {
      setUserToReset(user);
      setResetModalOpen(true);
  };

  const handleConfirmReset = async (newPassword: string) => {
      if (!userToReset) return;
      try {
          await resetUserPasswordMock(userToReset.id, newPassword);
          alert(`Senha de ${userToReset.name} alterada com sucesso!`);
          setResetModalOpen(false);
          setUserToReset(null);
      } catch {
          alert('Erro ao alterar senha.');
      }
  };

  const openEditModal = (user: User) => {
      setUserToEdit(user);
      setEditModalOpen(true);
  };

  const handleConfirmEdit = async (name: string, email: string) => {
      if (!userToEdit) return;
      setIsEditing(true);
      try {
          const updated = await updateUserDetailsMock(userToEdit.id, { name, email });
          setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
          setEditModalOpen(false);
          setUserToEdit(null);
      } catch {
          alert('Erro ao atualizar usuário.');
      } finally {
          setIsEditing(false);
      }
  };

  const openDeleteModal = (user: User) => {
      setUserToDelete(user);
      setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
      if (!userToDelete) return;
      setIsDeleting(true);
      try {
          await deleteUserMock(userToDelete.id);
          setUsers(prev => prev.filter(u => u.id !== userToDelete.id));
          setDeleteModalOpen(false);
          setUserToDelete(null);
      } catch (e: any) {
          alert('Erro ao excluir usuário: ' + e.message);
      } finally {
          setIsDeleting(false);
      }
  };

  if (currentUser?.role !== UserRole.COMPANY_ADMIN && currentUser?.role !== UserRole.SUPER_ADMIN) {
    return <div className="p-8 text-center text-red-600">Acesso negado. Apenas administradores podem ver esta tela.</div>;
  }

  const displayedUsers = users.filter(u => {
    if (currentUser?.role === UserRole.SUPER_ADMIN) return true;
    return u.companyId === currentUser?.companyId && u.id !== currentUser?.id;
  });

  const modulesList = [
    { key: SystemModule.ADMINISTRATIVE, label: 'Módulo Administrativo', desc: 'Cadastros, Propostas, Contratos' },
    { key: SystemModule.FINANCIAL, label: 'Módulo Financeiro', desc: 'Receitas, Despesas, Fluxo de Caixa' },
    { key: SystemModule.CERTIFICATES, label: 'Módulo Certidões', desc: 'Gestão de validade e arquivos' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in-up">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Gestão de Clientes (Banco de Dados)</h1>
          <p className="text-sm text-slate-500 mt-2 font-medium">
            Gerencie acessos, permissões e segurança dos usuários cadastrados no sistema.
          </p>
        </div>
        <div className="flex items-center gap-3">
            <Button 
              variant="primary" 
              className="shadow-lg shadow-brand-500/20 py-3 px-6 rounded-xl"
              onClick={() => navigate('/admin/create-user')}
            >
               + Novo Usuário
            </Button>
        </div>
      </div>

      {loading ? (
          <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
          </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {displayedUsers.map((client) => (
            <div key={client.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 group">
                {/* User Header */}
                <div className="px-6 py-5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex justify-between items-start">
                    <div className="flex items-center">
                        <div className="relative">
                            <img 
                                src={client.avatarUrl} 
                                alt={client.name}
                                className="h-12 w-12 rounded-xl object-cover shadow-sm border border-white ring-2 ring-slate-100"
                            />
                        </div>
                        <div className="ml-4">
                            <h3 className="text-lg font-bold text-slate-900 leading-tight">{client.name}</h3>
                            <p className="text-sm text-slate-500 font-medium">{client.email}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => openEditModal(client)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Editar Dados"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button 
                            onClick={() => openResetModal(client)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Redefinir Senha"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                        </button>
                        <button 
                            onClick={() => openDeleteModal(client)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Excluir Usuário"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                </div>

                {/* Modules Config */}
                <div className="p-6 flex-1 bg-white">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">
                        Acesso aos Módulos
                    </h4>
                    <div className="space-y-3">
                        {modulesList.map((mod) => {
                        const isEnabled = client.allowedModules.includes(mod.key);
                        return (
                            <div key={mod.key} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isEnabled ? 'bg-brand-50/50 border-brand-100' : 'bg-white border-transparent hover:bg-slate-50'}`}>
                                <div className="flex items-center">
                                    <div className={`p-2 rounded-lg mr-3 transition-colors ${isEnabled ? 'bg-white text-brand-600 shadow-sm' : 'bg-slate-100 text-slate-400'}`}>
                                        {mod.key === SystemModule.FINANCIAL ? (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        ) : mod.key === SystemModule.ADMINISTRATIVE ? (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                        ) : (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        )}
                                    </div>
                                    <div>
                                        <p className={`text-sm font-bold ${isEnabled ? 'text-slate-800' : 'text-slate-500'}`}>{mod.label}</p>
                                        <p className="text-xs text-slate-400">{mod.desc}</p>
                                    </div>
                                </div>
                                <Switch 
                                    checked={isEnabled} 
                                    onChange={() => handleToggle(client.id, mod.key)}
                                />
                            </div>
                        );
                        })}
                    </div>
                </div>
                
                {/* Actions Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-[10px] font-mono text-slate-300 select-all">{client.id}</span>
                    <Button 
                        onClick={() => handleSavePermissions(client)} 
                        isLoading={savingId === client.id}
                        variant={savingId === client.id ? 'primary' : 'secondary'}
                        className={`text-xs px-4 py-2 rounded-lg font-bold ${savingId === client.id ? '' : 'border-slate-200 text-slate-600'}`}
                    >
                        {savingId === client.id ? 'Salvando...' : 'Salvar Permissões'}
                    </Button>
                </div>
            </div>
            ))}
        </div>
      )}

      {/* Password Reset Modal */}
      <ResetPasswordModal 
         isOpen={resetModalOpen} 
         onClose={() => { setResetModalOpen(false); setUserToReset(null); }}
         userName={userToReset?.name || ''}
         onConfirm={handleConfirmReset}
      />

      {/* Edit User Modal */}
      <EditUserModal 
        isOpen={editModalOpen}
        onClose={() => { setEditModalOpen(false); setUserToEdit(null); }}
        user={userToEdit}
        onConfirm={handleConfirmEdit}
        isLoading={isEditing}
      />

      {/* Delete User Modal */}
      <DeleteUserModal
        isOpen={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setUserToDelete(null); }}
        userName={userToDelete?.name || ''}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </div>
  );
};
