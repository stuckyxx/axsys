
import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Certificate } from '../types';
import { getCertificates, saveCertificate, deleteCertificate, fileToBase64, REQUIRED_CERTIFICATE_TYPES } from '../services/certificateService';

// Modal para Adicionar/Editar Certidão
const AddCertificateModal = ({ isOpen, onClose, onSave, initialData }: { isOpen: boolean, onClose: () => void, onSave: (c: Certificate) => void, initialData?: Certificate | null }) => {
    const [type, setType] = useState(initialData?.name || REQUIRED_CERTIFICATE_TYPES[0]);
    const [validUntil, setValidUntil] = useState(initialData?.validUntil || '');
    const [file, setFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Update state when initialData changes
    React.useEffect(() => {
        if (isOpen) {
            setType(initialData?.name || REQUIRED_CERTIFICATE_TYPES[0]);
            setValidUntil(initialData?.validUntil || '');
            setFile(null);
        }
    }, [isOpen, initialData]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validUntil) return;
        if (!initialData && !file) return; // File is only required for new certificates

        setIsLoading(true);
        try {
            let base64File = initialData?.fileUrl || '';
            if (file) {
                base64File = await fileToBase64(file);
            }
            
            const newCert: Certificate = {
                id: initialData?.id || crypto.randomUUID(),
                name: type,
                validUntil: validUntil,
                fileUrl: base64File
            };
            onSave(newCert);
            onClose();
        } catch {
            alert("Erro ao processar arquivo.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800">{initialData ? 'Editar Certidão' : 'Nova Certidão'}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-[13px] font-semibold text-slate-600 mb-2">Tipo de Certidão</label>
                        <select 
                            className="block w-full rounded-xl border border-slate-200 bg-white sm:text-sm py-3 px-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            {REQUIRED_CERTIFICATE_TYPES.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>

                    <Input 
                        label="Data de Validade" 
                        type="date" 
                        value={validUntil} 
                        onChange={(e) => setValidUntil(e.target.value)} 
                        required
                    />

                    <div>
                        <label className="block text-[13px] font-semibold text-slate-600 mb-2">Arquivo (PDF/Imagem) {initialData && <span className="text-xs text-slate-400 font-normal">(Opcional para manter o atual)</span>}</label>
                        <input 
                            type="file" 
                            accept=".pdf,.jpg,.png,.jpeg"
                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 transition-all"
                            required={!initialData}
                        />
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
                        <Button type="submit" isLoading={isLoading}>Salvar Certidão</Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const Certificates: React.FC = () => {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCert, setEditingCert] = useState<Certificate | null>(null);

  React.useEffect(() => {
    const loadCertificates = async () => {
      const certs = await getCertificates();
      setCertificates(certs);
    };
    loadCertificates();
  }, []);

  const handleSave = async (newCert: Certificate) => {
      await saveCertificate(newCert);
      const updatedCerts = await getCertificates();
      setCertificates(updatedCerts); // Refresh list
  };

  const handleEdit = (cert: Certificate) => {
      setEditingCert(cert);
      setIsModalOpen(true);
  };

  const handleCloseModal = () => {
      setIsModalOpen(false);
      setEditingCert(null);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir esta certidão?")) {
      await deleteCertificate(id);
      const updatedCerts = await getCertificates();
      setCertificates(updatedCerts); // Refresh list
    }
  };

  const checkStatus = (dateString: string) => {
    const today = new Date();
    // Reset time part for accurate date comparison
    today.setHours(0,0,0,0);
    const validUntil = new Date(dateString);
    // Add 1 day to include the expiration day as valid or handle timezone offsets simply
    validUntil.setHours(23,59,59,999);
    
    return validUntil >= today ? 'valid' : 'expired';
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Certidões Negativas</h1>
          <p className="mt-1 text-sm text-gray-500">Mantenha a regularidade fiscal para emitir processos de pagamento.</p>
        </div>
        <div className="space-x-2">
            <Button onClick={() => { setEditingCert(null); setIsModalOpen(true); }}>+ Adicionar Certidão</Button>
        </div>
      </div>

      {/* Grid de Certidões */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {certificates.map((cert) => {
          const status = checkStatus(cert.validUntil);
          return (
            <div key={cert.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-lg transition-all p-6 flex flex-col justify-between group">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl ${status === 'valid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${status === 'valid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {status === 'valid' ? 'Válida' : 'Vencida'}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 leading-tight min-h-[3rem]">{cert.name}</h3>
                <p className="mt-2 text-sm text-gray-500 flex items-center">
                    <svg className="w-4 h-4 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Vence em: <span className="font-semibold ml-1">{cert.validUntil ? (() => {
                        try {
                            const [year, month, day] = cert.validUntil.split('T')[0].split('-');
                            return `${day}/${month}/${year}`;
                        } catch {
                            return cert.validUntil;
                        }
                    })() : ''}</span>
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
                {cert.fileUrl ? (
                    <a 
                        href={cert.fileUrl} 
                        download={`${cert.name}.pdf`} // Nome sugerido para download
                        className="flex items-center text-sm font-bold text-brand-600 hover:text-brand-700 transition-colors"
                    >
                        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Baixar
                    </a>
                ) : (
                    <span className="flex items-center text-sm font-medium text-slate-400" title="Arquivo não salvo devido ao limite de armazenamento do navegador">
                        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        Sem Arquivo
                    </span>
                )}
                <div className="flex gap-2">
                    <button 
                      onClick={() => handleEdit(cert)}
                      className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all"
                      title="Editar Certidão"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>
                    <button 
                      onClick={() => handleDelete(cert.id)}
                      className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Excluir Certidão"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
              </div>
            </div>
          );
        })}
        {certificates.length === 0 && (
            <div className="col-span-1 md:col-span-2 lg:col-span-3 py-16 px-6 text-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center">
                <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                    <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900">Nenhuma certidão anexada</h3>
                <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
                    Para habilitar a geração de processos de pagamento, é necessário anexar todas as certidões obrigatórias.
                </p>
                <div className="mt-8">
                  <Button onClick={() => setIsModalOpen(true)} className="px-8 shadow-lg shadow-brand-200">Adicionar Agora</Button>
                </div>
                <div className="mt-8 text-xs text-gray-400 text-left bg-white p-4 rounded-lg border border-gray-100 shadow-sm">
                    <p className="font-bold mb-2 uppercase tracking-wide">Documentação Necessária:</p>
                    <ul className="list-disc list-inside space-y-1">
                        {REQUIRED_CERTIFICATE_TYPES.map(r => (
                            <li key={r}>{r}</li>
                        ))}
                    </ul>
                </div>
            </div>
        )}
      </div>

      <AddCertificateModal 
        isOpen={isModalOpen} 
        onClose={handleCloseModal} 
        onSave={handleSave} 
        initialData={editingCert}
      />
    </div>
  );
};
