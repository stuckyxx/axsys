
import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Order } from '../types';

export const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([
    { id: '1', fileName: 'Ordem_Compra_1020.pdf', uploadDate: '2024-03-14', status: 'pending' },
    { id: '2', fileName: 'Ordem_Servico_5592.pdf', uploadDate: '2024-03-14', status: 'pending' },
    { id: '3', fileName: 'Contrato_Anexo_A.pdf', uploadDate: '2024-03-13', status: 'signed', signedUrl: '#' },
  ]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFileName, setEditFileName] = useState('');

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleEdit = (order: Order) => {
      setEditingId(order.id);
      setEditFileName(order.fileName);
  };

  const handleSaveEdit = (id: string) => {
      setOrders(orders.map(o => o.id === id ? { ...o, fileName: editFileName } : o));
      setEditingId(null);
  };

  const handleDelete = (id: string) => {
      if(confirm("Deseja remover este documento?")) {
          setOrders(prev => prev.filter(o => o.id !== id));
          setSelectedIds(prev => prev.filter(sid => sid !== id));
      }
  };

  const handleSign = () => {
    setIsSigning(true);
    // Simulation of API Call to Python Backend (pypdf/reportlab)
    setTimeout(() => {
      setOrders(prev => prev.map(order => 
        selectedIds.includes(order.id) ? { ...order, status: 'signed', signedUrl: '#' } : order
      ));
      setSelectedIds([]);
      setIsSigning(false);
      alert(`${selectedIds.length} documentos assinados digitalmente com sucesso!`);
    }, 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ordens de Fornecimento</h1>
          <p className="mt-1 text-sm text-gray-500">Upload em lote e assinatura digital automática.</p>
        </div>
        <div className="mt-4 md:mt-0 flex space-x-3">
          <input type="file" id="file-upload" multiple className="hidden" onChange={(e) => {
             if(e.target.files) {
                 const newFiles = Array.from(e.target.files).map((f: File) => ({
                     id: Math.random().toString(),
                     fileName: f.name,
                     uploadDate: new Date().toISOString().split('T')[0],
                     status: 'pending' as const
                 }));
                 setOrders([...newFiles, ...orders]);
             }
          }}/>
          
          <Button variant="secondary" onClick={() => document.getElementById('file-upload')?.click()}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
            Upload de Arquivos
          </Button>

          <Button 
            onClick={handleSign} 
            disabled={selectedIds.length === 0} 
            isLoading={isSigning}
            className="bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500 shadow-lg shadow-indigo-500/20"
          >
            Assinar Selecionados ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                <input type="checkbox" className="rounded text-brand-600 focus:ring-brand-500 border-gray-300" 
                  onChange={(e) => {
                      if(e.target.checked) setSelectedIds(orders.filter(o => o.status === 'pending').map(o => o.id));
                      else setSelectedIds([]);
                  }}
                  checked={orders.length > 0 && selectedIds.length === orders.filter(o => o.status === 'pending').length}
                />
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Arquivo</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Data Upload</th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="relative px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {orders.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum documento pendente.</td></tr>
            )}
            {orders.map((order) => (
              <tr key={order.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.includes(order.id) ? 'bg-indigo-50/50' : ''}`}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <input 
                    type="checkbox" 
                    className="rounded text-brand-600 focus:ring-brand-500 border-gray-300"
                    checked={selectedIds.includes(order.id)}
                    onChange={() => toggleSelection(order.id)}
                    disabled={order.status === 'signed'}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="p-2 bg-red-50 text-red-500 rounded-lg mr-3">
                         <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"></path></svg>
                    </div>
                    {editingId === order.id ? (
                        <div className="flex items-center gap-2">
                            <input 
                                type="text" 
                                value={editFileName} 
                                onChange={(e) => setEditFileName(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-sm"
                            />
                            <Button variant="primary" className="text-xs px-2 py-1" onClick={() => handleSaveEdit(order.id)}>Salvar</Button>
                            <Button variant="ghost" className="text-xs px-2 py-1" onClick={() => setEditingId(null)}>Cancelar</Button>
                        </div>
                    ) : (
                        <span className="text-sm font-medium text-slate-700">{order.fileName}</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {order.uploadDate ? (() => {
                        try {
                            const [year, month, day] = order.uploadDate.split('T')[0].split('-');
                            return `${day}/${month}/${year}`;
                        } catch {
                            return order.uploadDate;
                        }
                    })() : ''}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-bold uppercase rounded-md border ${
                      order.status === 'signed' 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                    }`}>
                    {order.status === 'signed' ? 'Assinado' : 'Pendente'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex items-center justify-end gap-3">
                  {order.status === 'signed' && (
                     <a href="#" className="text-brand-600 hover:text-brand-900 flex items-center text-xs font-bold bg-brand-50 px-3 py-1.5 rounded-lg">
                       <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                       Baixar
                     </a>
                  )}
                  <button 
                    onClick={() => handleEdit(order)}
                    className="text-slate-400 hover:text-blue-600 p-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button 
                    onClick={() => handleDelete(order.id)}
                    className="text-slate-400 hover:text-red-600 p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir"
                  >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
