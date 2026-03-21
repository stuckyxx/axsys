
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Switch } from '../components/Switch';
import { registerMock } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import { SystemModule, UserRole } from '../types';

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '', email: '', password: ''
  });

  const [selectedModules, setSelectedModules] = useState<SystemModule[]>([SystemModule.ADMINISTRATIVE]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleToggleModule = (module: SystemModule) => {
    setSelectedModules(prev => 
      prev.includes(module) 
        ? prev.filter(m => m !== module)
        : [...prev, module]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.password) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    setIsLoading(true);
    try {
      await registerMock({
        firstName: formData.name,
        email: formData.email,
        password: formData.password,
        role: UserRole.USER,
        companyId: currentUser?.companyId,
        allowedModules: selectedModules
      });
      alert('Novo usuário cadastrado com sucesso!');
      navigate('/admin/permissions');
    } catch {
      alert('Erro ao realizar cadastro.');
    } finally {
      setIsLoading(false);
    }
  };

  const modulesList = [
    { key: SystemModule.ADMINISTRATIVE, label: 'Módulo Administrativo', desc: 'Cadastros, Propostas, Contratos' },
    { key: SystemModule.FINANCIAL, label: 'Módulo Financeiro', desc: 'Receitas, Despesas, Fluxo de Caixa' },
    { key: SystemModule.CERTIFICATES, label: 'Módulo Certidões', desc: 'Gestão de validade e arquivos' },
  ];

  return (
    <div className="max-w-3xl mx-auto py-6 animate-fade-in-up">
      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Cadastrar Novo Usuário
          </h2>
          <p className="mt-1 text-slate-500 font-medium">
            Crie um novo acesso vinculado à sua empresa.
          </p>
        </div>
        <button 
          onClick={() => navigate('/admin/permissions')} 
          className="px-5 py-2.5 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
        >
           Cancelar e Sair
        </button>
      </div>

      {/* Main Form Content */}
      <div className="bg-white p-8 md:p-10 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] border border-slate-100 flex flex-col">
        <form className="flex-1 flex flex-col space-y-8" onSubmit={handleSubmit}>
          
          <div className="space-y-6">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-slate-800">Dados do Usuário</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <Input label="Nome Completo" name="name" value={formData.name} onChange={handleChange} required placeholder="ex: João Silva" />
              <Input label="E-mail" name="email" type="email" value={formData.email} onChange={handleChange} required placeholder="exemplo@empresa.com" />
              <Input label="Senha Provisória" name="password" type="password" value={formData.password} onChange={handleChange} required placeholder="Mínimo 6 caracteres" />
            </div>
          </div>

          <div className="space-y-6 pt-6 border-t border-slate-100">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-slate-800">Permissões de Acesso</h3>
              <p className="text-sm text-slate-500">Selecione quais módulos este usuário poderá acessar.</p>
            </div>
            <div className="space-y-3">
                {modulesList.map((mod) => {
                const isEnabled = selectedModules.includes(mod.key);
                return (
                    <div key={mod.key} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${isEnabled ? 'bg-brand-50/50 border-brand-100' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                        <div>
                            <p className={`text-sm font-bold ${isEnabled ? 'text-slate-800' : 'text-slate-500'}`}>{mod.label}</p>
                            <p className="text-xs text-slate-400">{mod.desc}</p>
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

          {/* Navigation Buttons */}
          <div className="mt-8 pt-8 border-t border-slate-50 flex justify-end items-center">
            <Button 
              type="submit" 
              isLoading={isLoading} 
              className="px-10 py-4 text-sm font-bold bg-brand-600 hover:bg-brand-700 rounded-2xl shadow-xl shadow-brand-500/20 transition-all"
            >
              Criar Usuário
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
