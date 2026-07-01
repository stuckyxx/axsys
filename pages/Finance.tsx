
import React, { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { Expense, Income } from '../types';
import { readCompanyScopedValue, writeCompanyScopedValue } from '../services/storageScope';
import { PaymentProcessManager } from './Administrative';
import { FINANCE_ACTIVE_TAB_STORAGE_KEY, getSafeFinanceTab, type FinanceTabId } from '../utils/moduleTabs.ts';

// Helper para formatação monetária
const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// --- Sub-Components ---

const StatCard = ({ title, value, type, icon }: { title: string, value: number, type: 'neutral' | 'success' | 'danger', icon: React.ReactNode }) => {
    const colors = {
        neutral: 'bg-white border-slate-200 text-slate-900',
        success: 'bg-emerald-50 border-emerald-100 text-emerald-900',
        danger: 'bg-rose-50 border-rose-100 text-rose-900'
    };
    
    const valueColors = {
        neutral: 'text-slate-900',
        success: 'text-emerald-600',
        danger: 'text-rose-600'
    };

    return (
        <div className={`p-6 rounded-2xl border shadow-sm flex items-center justify-between transition-transform hover:scale-[1.02] duration-300 ${colors[type]}`}>
            <div>
                <p className="text-sm font-medium opacity-80 uppercase tracking-wider">{title}</p>
                <p className={`text-3xl font-bold mt-1 ${valueColors[type]}`}>{formatCurrency(value)}</p>
            </div>
            <div className={`p-3 rounded-xl bg-white/60 backdrop-blur-sm shadow-sm`}>
                {icon}
            </div>
        </div>
    );
};

const FinancialDashboard = ({ income, expenses }: { income: Income[], expenses: Expense[] }) => {
    const totalIncome = income.reduce((acc, curr) => acc + curr.amount, 0);
    // Considera apenas despesas pagas (isPaid !== false)
    const totalExpense = expenses.reduce((acc, curr) => acc + (curr.isPaid !== false ? curr.amount : 0), 0);
    const balance = totalIncome - totalExpense;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <StatCard 
                    title="Entradas Totais" 
                    value={totalIncome} 
                    type="success" 
                    icon={<svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>}
                />
                <StatCard 
                    title="Saídas Totais" 
                    value={totalExpense} 
                    type="danger" 
                    icon={<svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>}
                />
                <StatCard 
                    title="Saldo em Caixa" 
                    value={balance} 
                    type="neutral" 
                    icon={<svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
            </div>
            
            {/* Chart Area */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <h4 className="font-bold text-slate-800 text-lg">Fluxo de Caixa (Previsão Semestral)</h4>
                    <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">Dados simulados</span>
                </div>
                <div className="h-64 flex items-end justify-between gap-4 px-2">
                    {[
                        { label: 'Out', val: 40 }, 
                        { label: 'Nov', val: 60 }, 
                        { label: 'Dez', val: 45 }, 
                        { label: 'Jan', val: 80 }, 
                        { label: 'Fev', val: 55 }, 
                        { label: 'Mar', val: 70 }
                    ].map((item, i) => (
                        <div key={i} className="flex flex-col items-center flex-1 h-full justify-end group cursor-default">
                             <div className="w-full relative h-full flex items-end rounded-t-lg bg-slate-50 overflow-hidden group-hover:bg-slate-100 transition-colors">
                                <div style={{height: `${item.val}%`}} className="w-full bg-gradient-to-t from-brand-600 to-brand-400 relative group-hover:from-brand-500 group-hover:to-brand-300 transition-all duration-300 rounded-t-sm shadow-lg shadow-brand-200/50">
                                    <div className="opacity-0 group-hover:opacity-100 absolute -top-10 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-xs py-1 px-2 rounded pointer-events-none transition-opacity">
                                        {item.val}k
                                    </div>
                                </div>
                             </div>
                             <span className="text-xs text-slate-400 mt-3 font-medium uppercase tracking-wide">{item.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const IncomeManager = ({ income, setIncome }: { income: Income[], setIncome: any }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newIncome, setNewIncome] = useState<Partial<Income>>({ 
        description: '', 
        amount: 0,
        date: new Date().toISOString().split('T')[0],
        category: 'Serviços'
    });

    const handleAddIncome = () => {
        if (!newIncome.description || !newIncome.amount) return;
        
        if (editingId) {
            setIncome(income.map(inc => inc.id === editingId ? { ...inc, ...newIncome } as Income : inc));
            setEditingId(null);
        } else {
            const entry: Income = {
                id: crypto.randomUUID(),
                description: newIncome.description,
                amount: Number(newIncome.amount),
                date: newIncome.date || new Date().toISOString().split('T')[0],
                origin: 'manual',
                category: newIncome.category
            };
            setIncome([entry, ...income]);
        }
        setNewIncome({ description: '', amount: 0, date: new Date().toISOString().split('T')[0], category: 'Serviços' });
        setIsAdding(false);
    };

    const handleEdit = (inc: Income) => {
        setNewIncome(inc);
        setEditingId(inc.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string) => {
        if (confirm('Tem certeza que deseja excluir esta receita?')) {
            setIncome(income.filter(inc => inc.id !== id));
        }
    };

    const cancelEdit = () => {
        setNewIncome({ description: '', amount: 0, date: new Date().toISOString().split('T')[0], category: 'Serviços' });
        setEditingId(null);
        setIsAdding(false);
    };

    const importFromRequests = () => {
        const entry: Income = {
            id: crypto.randomUUID(),
            description: 'Recebimento ref. NF #4021 (Importado)',
            amount: 2500.00,
            date: new Date().toISOString().split('T')[0],
            origin: 'payment_request',
            category: 'Faturamento'
        };
        setIncome([entry, ...income]);
        alert('1 Receita importada de Solicitações Pagas!');
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>
                        </span>
                        Receitas
                    </h3>
                    <p className="text-slate-500 text-xs ml-10">Gerencie todas as entradas financeiras.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={importFromRequests} className="text-xs">
                        Importar XML/NF
                    </Button>
                    <Button 
                        onClick={() => isAdding ? cancelEdit() : setIsAdding(true)} 
                        className={`text-xs ${isAdding ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {isAdding ? 'Cancelar' : '+ Nova Receita'}
                    </Button>
                </div>
            </div>

            {/* Add Form (Collapsible) */}
            {isAdding && (
                <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 shadow-inner animate-in slide-in-from-top-2">
                    <h4 className="text-sm font-bold text-emerald-900 mb-4">Detalhes da Nova Receita</h4>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-4">
                            <Input 
                                label="Descrição" 
                                placeholder="Ex: Venda de Consultoria" 
                                value={newIncome.description} 
                                onChange={e => setNewIncome({...newIncome, description: e.target.value})}
                                className="mb-0 bg-white"
                                autoFocus
                            />
                        </div>
                        <div className="md:col-span-2">
                             <Input 
                                label="Data" 
                                type="date"
                                value={newIncome.date} 
                                onChange={e => setNewIncome({...newIncome, date: e.target.value})}
                                className="mb-0 bg-white"
                            />
                        </div>
                        <div className="md:col-span-3">
                             <label className="block text-[13px] font-semibold text-slate-600 mb-2">Categoria</label>
                             <select 
                                className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                                value={newIncome.category}
                                onChange={e => setNewIncome({...newIncome, category: e.target.value})}
                             >
                                 <option>Serviços</option>
                                 <option>Produtos</option>
                                 <option>Investimentos</option>
                                 <option>Reembolsos</option>
                                 <option>Outros</option>
                             </select>
                        </div>
                        <div className="md:col-span-2">
                            <Input 
                                label="Valor (R$)" 
                                type="number" 
                                placeholder="0,00" 
                                value={newIncome.amount || ''} 
                                onChange={e => setNewIncome({...newIncome, amount: Number(e.target.value)})}
                                className="mb-0 bg-white font-bold text-emerald-600"
                            />
                        </div>
                        <div className="md:col-span-1">
                            <Button fullWidth onClick={handleAddIncome} className="bg-emerald-600 hover:bg-emerald-700 h-[46px] shadow-lg shadow-emerald-200">
                                {editingId ? 'Salvar' : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="bg-white shadow-sm border border-slate-100 rounded-2xl overflow-hidden">
                <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Categoria</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Origem</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Valor</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                        {income.length === 0 && (
                             <tr><td colSpan={6} className="p-8 text-center text-slate-400">Nenhuma receita lançada este mês.</td></tr>
                        )}
                        {income.map(inc => (
                            <tr key={inc.id} className="hover:bg-slate-50 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="text-sm font-bold text-slate-800">{inc.description}</div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        {inc.category || 'Geral'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                                    {inc.date ? (() => {
                                        try {
                                            const [year, month, day] = inc.date.split('T')[0].split('-');
                                            return `${day}/${month}/${year}`;
                                        } catch {
                                            return inc.date;
                                        }
                                    })() : ''}
                                </td>
                                <td className="px-6 py-4">
                                     <span className={`text-xs ${inc.origin === 'manual' ? 'text-slate-400' : 'text-purple-600 font-semibold'}`}>
                                        {inc.origin === 'manual' ? 'Manual' : 'Automático'}
                                     </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-emerald-600 group-hover:scale-105 transition-transform">
                                    + {formatCurrency(inc.amount)}
                                </td>
                                <td className="px-6 py-4 text-right whitespace-nowrap">
                                    <Button variant="ghost" className="text-xs mr-2" onClick={() => handleEdit(inc)}>Editar</Button>
                                    <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(inc.id)}>Excluir</Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ExpenseManager = ({ expenses, setExpenses }: { expenses: Expense[], setExpenses: any }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newExp, setNewExp] = useState<Partial<Expense>>({ 
        type: 'fixed', 
        amount: 0, 
        description: '',
        date: new Date().toISOString().split('T')[0],
        category: 'Operacional',
        isPaid: true
    });

    const handleAdd = () => {
        if(!newExp.description || !newExp.amount) return;
        
        if (editingId) {
            setExpenses(expenses.map(exp => exp.id === editingId ? { ...exp, ...newExp } as Expense : exp));
            setEditingId(null);
        } else {
            setExpenses([
                { ...newExp, id: crypto.randomUUID(), date: newExp.date || new Date().toISOString().split('T')[0] } as Expense,
                ...expenses
            ]);
        }
        setNewExp({ type: 'fixed', amount: 0, description: '', category: 'Operacional', date: new Date().toISOString().split('T')[0], isPaid: true });
        setIsAdding(false);
    };

    const handleEdit = (exp: Expense) => {
        setNewExp(exp);
        setEditingId(exp.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string) => {
        if (confirm('Tem certeza que deseja excluir esta despesa?')) {
            setExpenses(expenses.filter(exp => exp.id !== id));
        }
    };

    const cancelEdit = () => {
        setNewExp({ type: 'fixed', amount: 0, description: '', category: 'Operacional', date: new Date().toISOString().split('T')[0], isPaid: true });
        setEditingId(null);
        setIsAdding(false);
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
             {/* Header & Controls */}
             <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>
                        </span>
                        Despesas
                    </h3>
                    <p className="text-slate-500 text-xs ml-10">Controle seus custos fixos e variáveis.</p>
                </div>
                <div className="flex gap-2">
                    <Button 
                        onClick={() => isAdding ? cancelEdit() : setIsAdding(true)} 
                        className={`text-xs ${isAdding ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-rose-600 hover:bg-rose-700'}`}
                    >
                        {isAdding ? 'Cancelar' : '+ Nova Despesa'}
                    </Button>
                </div>
            </div>

            {/* Add Form (Collapsible) */}
            {isAdding && (
                <div className="bg-rose-50/50 p-6 rounded-2xl border border-rose-100 shadow-inner animate-in slide-in-from-top-2">
                    <h4 className="text-sm font-bold text-rose-900 mb-4">Lançar Nova Despesa</h4>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-4">
                             <Input 
                                label="Descrição" 
                                placeholder="Ex: Aluguel, Internet..." 
                                value={newExp.description || ''} 
                                onChange={e => setNewExp({...newExp, description: e.target.value})} 
                                className="mb-0 bg-white"
                                autoFocus
                            />
                        </div>
                        <div className="md:col-span-2">
                             <Input 
                                label="Data" 
                                type="date"
                                value={newExp.date} 
                                onChange={e => setNewExp({...newExp, date: e.target.value})}
                                className="mb-0 bg-white"
                            />
                        </div>
                        <div className="md:col-span-2">
                             <label className="block text-[13px] font-semibold text-slate-600 mb-2">Tipo de Custo</label>
                             <select 
                                className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10"
                                value={newExp.type}
                                onChange={e => setNewExp({...newExp, type: e.target.value as any})}
                             >
                                 <option value="fixed">Fixo (Recorrente)</option>
                                 <option value="variable">Variável (Pontual)</option>
                             </select>
                        </div>
                        <div className="md:col-span-2">
                            <Input 
                                label="Valor (R$)" 
                                type="number" 
                                placeholder="0,00"
                                value={newExp.amount || ''} 
                                onChange={e => setNewExp({...newExp, amount: Number(e.target.value)})} 
                                className="mb-0 bg-white font-bold text-rose-600"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <Button onClick={handleAdd} fullWidth className="bg-rose-600 hover:bg-rose-700 h-[46px] shadow-lg shadow-rose-200">
                                {editingId ? 'Salvar' : 'Lançar'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white shadow-sm border border-slate-100 rounded-2xl overflow-hidden">
                <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Valor</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                        {expenses.length === 0 && (
                             <tr><td colSpan={6} className="p-8 text-center text-slate-400">Nenhuma despesa registrada.</td></tr>
                        )}
                        {expenses.map(exp => (
                            <tr key={exp.id} className="hover:bg-slate-50 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="text-sm font-bold text-slate-800">{exp.description}</div>
                                    {exp.category && <div className="text-xs text-slate-400 mt-0.5">{exp.category}</div>}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                        exp.type === 'fixed' 
                                            ? 'bg-orange-50 text-orange-700 border-orange-100' 
                                            : 'bg-blue-50 text-blue-700 border-blue-100'
                                    }`}>
                                        {exp.type === 'fixed' ? 'Custo Fixo' : 'Custo Variável'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                                    {exp.date ? (() => {
                                        try {
                                            const [year, month, day] = exp.date.split('T')[0].split('-');
                                            return `${day}/${month}/${year}`;
                                        } catch {
                                            return exp.date;
                                        }
                                    })() : ''}
                                </td>
                                <td className="px-6 py-4">
                                    {exp.isPaid === false ? (
                                        <div className="flex flex-col gap-1 items-start">
                                            <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">Pendente</span>
                                            <Button 
                                                onClick={() => {
                                                    if (confirm('Confirmar pagamento desta despesa?')) {
                                                        setExpenses(expenses.map(e => e.id === exp.id ? { ...e, isPaid: true } : e));
                                                    }
                                                }}
                                                className="text-[10px] py-1 px-2 bg-emerald-600 hover:bg-emerald-700 h-auto"
                                            >
                                                Marcar como Pago
                                            </Button>
                                        </div>
                                    ) : (
                                        <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">Pago</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-sm text-right font-bold text-rose-600 group-hover:scale-105 transition-transform">
                                    - {formatCurrency(exp.amount)}
                                </td>
                                <td className="px-6 py-4 text-right whitespace-nowrap">
                                    <Button variant="ghost" className="text-xs mr-2" onClick={() => handleEdit(exp)}>Editar</Button>
                                    <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(exp.id)}>Excluir</Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export const Finance: React.FC = () => {
  const { user } = useAuth();
  const companyScopeId = user?.companyId ?? 'global';
  const hydratedIncomeScopeRef = React.useRef<string | null>(null);
  const hydratedExpenseScopeRef = React.useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<FinanceTabId>(() =>
    getSafeFinanceTab(localStorage.getItem(FINANCE_ACTIVE_TAB_STORAGE_KEY)),
  );
  
  const [income, setIncome] = useState<Income[]>(() => readCompanyScopedValue('axsys_income_db_v2', [], user));
  
  const [expenses, setExpenses] = useState<Expense[]>(() => readCompanyScopedValue('axsys_expense_db_v2', [], user));

  useEffect(() => {
      hydratedIncomeScopeRef.current = null;
      hydratedExpenseScopeRef.current = null;
      setIncome(readCompanyScopedValue('axsys_income_db_v2', [], user));
      setExpenses(readCompanyScopedValue('axsys_expense_db_v2', [], user));
  }, [companyScopeId, user]);

  useEffect(() => {
      if (hydratedIncomeScopeRef.current !== companyScopeId) {
          hydratedIncomeScopeRef.current = companyScopeId;
          return;
      }

      writeCompanyScopedValue('axsys_income_db_v2', income, user);
  }, [companyScopeId, income, user]);

  useEffect(() => {
      if (hydratedExpenseScopeRef.current !== companyScopeId) {
          hydratedExpenseScopeRef.current = companyScopeId;
          return;
      }

      writeCompanyScopedValue('axsys_expense_db_v2', expenses, user);
  }, [companyScopeId, expenses, user]);

  useEffect(() => {
      localStorage.setItem(FINANCE_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useTrackedStorageRefresh({
    trackedKeys: ['axsys_income_db_v2', 'axsys_expense_db_v2'],
    user,
    refresh: () => {
      hydratedIncomeScopeRef.current = null;
      hydratedExpenseScopeRef.current = null;
      setIncome(readCompanyScopedValue('axsys_income_db_v2', [], user));
      setExpenses(readCompanyScopedValue('axsys_expense_db_v2', [], user));
    },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in-up">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Módulo Financeiro</h1>
            <p className="mt-2 text-slate-500">Gestão de Fluxo de Caixa, Receitas, Despesas e Solicitações de Pagamento.</p>
        </div>
      </div>

       {/* Modern Tabs */}
       <div>
        <nav className="flex space-x-2 p-1 bg-slate-100/50 rounded-xl w-full md:w-auto overflow-x-auto" aria-label="Tabs">
            {[
                { id: 'dashboard', label: 'Painel' },
                { id: 'income', label: 'Receitas' },
                { id: 'expenses', label: 'Despesas' },
                { id: 'payments', label: 'Solicitações de Pagamento' }
            ].map(tab => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`${
                        activeTab === tab.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                    } whitespace-nowrap px-6 py-2.5 rounded-lg font-semibold text-sm transition-all duration-200`}
                >
                    {tab.label}
                </button>
            ))}
        </nav>
      </div>

      <div className="mt-6">
          {activeTab === 'income' && <IncomeManager income={income} setIncome={setIncome} />}
          {activeTab === 'expenses' && <ExpenseManager expenses={expenses} setExpenses={setExpenses} />}
          {activeTab === 'dashboard' && <FinancialDashboard income={income} expenses={expenses} />}
          {activeTab === 'payments' && <PaymentProcessManager />}
      </div>
    </div>
  );
};
