
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Button } from '../components/Button';
import { AdministrativeTabId } from '../components/contracts/AdministrativeTabs';
import { Proposals } from './Proposals';
import { Contracts } from './Contracts';
import { Registrations } from '../components/Registrations';
import { PaymentRequest, Certificate, Contract, Client } from '../types';
import { getCertificates, REQUIRED_CERTIFICATE_TYPES } from '../services/certificateService';
import { getCompanySettings, fileToBase64, getCompanyById } from '../services/companyService';
import { saveIncome, saveExpense } from '../services/financeService';
import { Company } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { ADMIN_PAYMENT_DRAFT_KEY, ADMIN_PAYMENT_FILTER_CONTRACT_KEY } from '../utils/contracts.ts';
import { readCompanyScopedValue, writeCompanyScopedValue } from '../services/storageScope';
import { ADMIN_ACTIVE_TAB_STORAGE_KEY, getSafeAdministrativeTab } from '../utils/moduleTabs.ts';
import {
    getPaymentReportPrintLabel,
    getPaymentReportSections,
    getPaymentReportTitle,
    type PaymentReportMode,
} from '../utils/paymentReport.ts';
import { evaluatePaymentRequestCertificates } from '../utils/paymentFormalization.ts';
import { buildCertificateCollections } from '../utils/certificateHistory.ts';

// --- Componente de Aviso de Certidões ---
const CertificateWarningModal = ({ expiredCertificates, missingCertificates, onClose, onProceed }: { expiredCertificates: Certificate[], missingCertificates: string[], onClose: () => void, onProceed: () => void }) => {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in zoom-in-95 duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border-t-4 border-yellow-500">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 bg-yellow-100 rounded-full text-yellow-600">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">Pendências Detectadas</h3>
                    </div>
                    <p className="text-slate-600 mb-4 text-sm">
                        O sistema detectou inconsistências nas certidões. Isso pode impedir o pagamento.
                    </p>
                    
                    <div className="bg-yellow-50 rounded-lg p-4 mb-4 border border-yellow-100 max-h-60 overflow-y-auto">
                        {missingCertificates.length > 0 && (
                            <div className="mb-3">
                                <p className="text-xs font-bold text-red-600 uppercase mb-1">Ausentes:</p>
                                <ul className="list-disc list-inside space-y-1">
                                    {missingCertificates.map(name => (
                                        <li key={name} className="text-sm font-medium text-slate-700">{name}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        
                        {expiredCertificates.length > 0 && (
                            <div>
                                <p className="text-xs font-bold text-orange-600 uppercase mb-1">Vencidas:</p>
                                <ul className="list-disc list-inside space-y-1">
                                    {expiredCertificates.map(cert => (
                                        <li key={cert.id} className="text-sm font-medium text-slate-700">
                                            {cert.name} (Venceu: {cert.validUntil ? (() => {
                                                try {
                                                    const [year, month, day] = cert.validUntil.split('T')[0].split('-');
                                                    return `${day}/${month}/${year}`;
                                                } catch {
                                                    return cert.validUntil;
                                                }
                                            })() : ''})
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    <div className="text-xs text-slate-400 mb-6">
                        Deseja interromper para regularizar ou gerar o processo assim mesmo?
                    </div>
                    <div className="flex justify-end gap-3">
                        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                        <Button 
                            className="bg-yellow-600 hover:bg-yellow-700 text-white border-transparent focus:ring-yellow-500"
                            onClick={onProceed}
                        >
                            Gerar Mesmo Assim
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const PaymentReportChoiceModal = ({
    request,
    onClose,
    onSelect,
}: {
    request: PaymentRequest;
    onClose: () => void;
    onSelect: (mode: PaymentReportMode) => void;
}) => {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-6 py-5 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">Escolha o tipo de relatório</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            Solicitação {request.invoiceNumber ? `da NF ${request.invoiceNumber}` : 'de pagamento'}.
                        </p>
                    </div>
                    <Button variant="ghost" onClick={onClose}>Fechar</Button>
                </div>

                <div className="p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => onSelect('complete')}
                            className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        >
                            <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Processo completo</p>
                            <h4 className="mt-3 text-lg font-bold text-slate-900">Carta, nota fiscal e certidões</h4>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                                Gera o pacote inteiro como hoje, incluindo a solicitação, o arquivo da nota e todas as certidões anexadas.
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => onSelect('request_only')}
                            className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        >
                            <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Somente solicitação</p>
                            <h4 className="mt-3 text-lg font-bold text-slate-900">Carta e arquivo da solicitação</h4>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                                Gera uma versão própria da solicitação com a carta e a nota fiscal, sem incluir as páginas de certidões.
                            </p>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Visualização do Processo Unificado (Simulado) ---
const PaymentDocumentPreview = ({
    request,
    onClose,
    warnings,
    contracts,
    initialMode,
}: {
    request: PaymentRequest;
    onClose: () => void;
    warnings: boolean;
    contracts: Contract[];
    initialMode: PaymentReportMode;
}) => {
    const printRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();
    const [reportMode, setReportMode] = useState<PaymentReportMode>(initialMode);
    
    const [realCertificates, setRealCertificates] = useState<Certificate[]>([]);
    
    useEffect(() => {
        const loadCerts = async () => {
            const certs = await getCertificates(user, { preferRemote: true });
            setRealCertificates(buildCertificateCollections(certs).relevant);
        };
        void loadCerts();
    }, [user]);

    useEffect(() => {
        setReportMode(initialMode);
    }, [initialMode]);

    const [companySettings] = useState<Company>(() => {
        if (user?.companyId) {
            const company = getCompanyById(user.companyId);
            if (company) return company;
        }
        return getCompanySettings();
    });

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("Por favor, permita pop-ups para imprimir.");
            return;
        }

        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map(el => el.outerHTML)
            .join('\n');

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <title>${getPaymentReportTitle(reportMode)}</title>
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
                    <script>
                        window.onload = () => {
                            setTimeout(() => {
                                window.print();
                            }, 500);
                        };
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    const todayDate = new Date();
    const day = todayDate.getDate();
    const month = todayDate.toLocaleDateString('pt-BR', { month: 'long' });
    const year = todayDate.getFullYear();
    // Capitalize month
    const monthFormatted = month.charAt(0).toUpperCase() + month.slice(1);
    const city = companySettings.city || 'São Luís';
    const state = companySettings.state || 'MA';
    const fullDate = `${city} - ${state}, ${day} de ${monthFormatted} de ${year}.`;
    const visibleSections = getPaymentReportSections(reportMode);
    const showCertificates = visibleSections.includes('certificates');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className={`px-6 py-4 border-b border-slate-200 flex justify-between items-center ${warnings ? 'bg-yellow-50' : 'bg-slate-50'}`}>
                    <div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            {warnings ? (
                                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            ) : (
                                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            )}
                            {getPaymentReportTitle(reportMode)}
                        </h3>
                        {warnings ? (
                             <p className="text-xs text-yellow-600 font-semibold mt-1">⚠ Gerado com ressalvas (Certidões Pendentes)</p>
                        ) : (
                             <p className="text-xs text-green-600 font-semibold mt-1">✓ Certidões Válidas Checadas e Anexadas</p>
                        )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setReportMode('request_only')}
                                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                                    reportMode === 'request_only'
                                        ? 'bg-brand-600 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                Somente Solicitação
                            </button>
                            <button
                                type="button"
                                onClick={() => setReportMode('complete')}
                                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                                    reportMode === 'complete'
                                        ? 'bg-brand-600 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                Processo Completo
                            </button>
                        </div>
                        <Button variant="ghost" onClick={onClose}>Fechar</Button>
                        <Button onClick={handlePrint}>
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            {getPaymentReportPrintLabel(reportMode)}
                        </Button>
                    </div>
                </div>

                <div className="overflow-y-auto p-8 bg-gray-200 flex justify-center">
                    <div ref={printRef} className="bg-white w-[210mm] min-h-[297mm] shadow-lg relative text-black font-sans print:w-full print:shadow-none">
                        
                        {/* --- PÁGINA 1: SOLICITAÇÃO --- */}
                        <div className="relative h-[297mm] flex flex-col page-break-after-always">
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
                                
                                {/* Cabeçalho Logo (Oculto se houver papel timbrado) */}
                                {!companySettings.letterheadUrl && (
                                    <div className="flex flex-col items-center justify-center text-center mb-12">
                                        {companySettings.logoUrl && (
                                            <div className="w-32 h-auto mb-2 flex items-center justify-center">
                                                <img src={companySettings.logoUrl} alt="Logo" className="max-w-full max-h-full" />
                                            </div>
                                        )}
                                        <h1 className="text-lg font-bold uppercase">{companySettings.corporateName}</h1>
                                        <p className="text-sm font-bold">CNPJ nº {companySettings.cnpj}</p>
                                    </div>
                                )}

                                {/* Título */}
                                <h2 className="text-center font-bold text-[14pt] mb-12 uppercase underline decoration-2 underline-offset-4">
                                    SOLICITAÇÃO DE PAGAMENTO
                                </h2>

                                {/* Destinatário */}
                                <div className="mb-8 font-bold text-left">
                                    <p className="uppercase">À</p>
                                    <p>{request.takerName || "Tomador não identificado"}</p>
                                </div>

                                {/* Referência */}
                                <div className="mb-8 text-left">
                                    <span className="font-bold">Ref. a Pagamento do Objeto:</span> {request.description}
                                    {request.contractId && contracts && (
                                        <>
                                            <br />
                                            <span className="font-bold">Contrato Vinculado:</span> {contracts.find(c => c.id === request.contractId)?.contractNumber || 'Desconhecido'}
                                        </>
                                    )}
                                </div>

                                {/* Corpo do Texto */}
                                <div className="mb-8 indent-0">
                                    <span className="font-bold uppercase">{companySettings.corporateName}</span>, inscrita no Cadastro Nacional de
                                    Pessoas Jurídicas sob o CNPJ: <span className="font-bold">{companySettings.cnpj}</span>, com sede na {companySettings.address}, vem através deste, solicitar o pagamento dos serviços prestados, conforme Nota
                                    Fiscal Nº <span className="font-bold">{request.invoiceNumber}</span>{request.issueDate ? `, emitida em ${request.issueDate}` : ''}.
                                    <br /><br />
                                    No valor de <span className="font-bold">{request.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>.
                                </div>

                                {/* Dados Bancários */}
                                <div className="mb-12">
                                    <p className="font-bold mb-1">Dados para depósito:</p>
                                    {companySettings.banks && companySettings.banks.length > 0 ? (
                                        <>
                                            <p className="font-bold uppercase">{companySettings.banks[0].name}</p>
                                            <p>Agência: <span className="font-bold">{companySettings.banks[0].agency}</span></p>
                                            <p>Conta Corrente: <span className="font-bold">{companySettings.banks[0].account}</span></p>
                                        </>
                                    ) : (
                                        <p className="text-red-500 italic">Nenhuma conta bancária cadastrada para esta empresa.</p>
                                    )}
                                </div>

                                {/* Data e Assinatura */}
                                <div className="mt-auto flex flex-col items-end">
                                    <p className="mb-8 text-right w-full">
                                        {fullDate}
                                    </p>

                                    <div className="flex flex-col items-center justify-center relative w-full max-w-md mx-auto mt-4">
                                        {/* Imagem da Assinatura Sobreposta */}
                                        {companySettings.signatureUrl && (
                                            <div className="h-24 flex items-end justify-center mb-0">
                                                <img 
                                                    src={companySettings.signatureUrl} 
                                                    alt="Assinatura" 
                                                    className="max-h-full mix-blend-multiply" 
                                                />
                                            </div>
                                        )}
                                        
                                        {!companySettings.signatureUrl && (
                                            <div className="w-full border-t border-black mt-12 mb-0"></div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Rodapé Endereço (Oculto se houver papel timbrado) */}
                                {!companySettings.letterheadUrl && (
                                    <div className="mt-0 text-center text-[10pt] font-bold text-[#0070c0] border-t border-[#0070c0] pt-2">
                                        <p className="italic">{companySettings.address}</p>
                                        <p className="italic">e-mail: {companySettings.email}</p>
                                        <div className="w-3/4 mx-auto border-t border-black mt-1 mb-1"></div>
                                        <p className="text-black uppercase text-[11pt]">{companySettings.representative}</p>
                                        <p className="text-black text-[10pt] font-normal">CPF: {companySettings.cpf}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- PÁGINA 2: NOTA FISCAL --- */}
                        <div className="relative min-h-[297mm] flex flex-col page-break-after-always bg-white">
                            <div className="flex-1 flex flex-col items-center justify-center w-full h-full">
                                {request.invoiceFileContent ? (
                                    request.invoiceFileContent.startsWith('data:application/pdf') ? (
                                        <embed src={request.invoiceFileContent} type="application/pdf" className="w-full h-[297mm]" />
                                    ) : (
                                        <img src={request.invoiceFileContent} alt="Nota Fiscal" className="w-full h-[297mm] object-contain" />
                                    )
                                ) : (
                                    <div className="text-center p-12 bg-slate-50 rounded-xl w-full h-full flex items-center justify-center flex-col">
                                        <svg className="w-24 h-24 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        <p className="text-slate-500 font-medium">Visualização da Nota Fiscal Nº {request.invoiceNumber}</p>
                                        <p className="text-slate-400 text-sm mt-2">(Arquivo original não disponível na simulação)</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- PÁGINAS 3+: CERTIDÕES --- */}
                        {showCertificates && (
                            realCertificates.length > 0 ? (
                                realCertificates.map((cert) => (
                                    <div key={cert.id} className="relative min-h-[297mm] flex flex-col page-break-after-always bg-white">
                                        <div className="flex-1 flex flex-col items-center justify-center w-full h-full">
                                            {cert.fileUrl ? (
                                                cert.fileUrl.startsWith('data:application/pdf') ? (
                                                    <embed src={cert.fileUrl} type="application/pdf" className="w-full h-[297mm]" />
                                                ) : (
                                                    <img src={cert.fileUrl} alt={cert.name} className="w-full h-[297mm] object-contain" />
                                                )
                                            ) : (
                                                <div className="text-center p-12 bg-slate-50 rounded-xl w-full h-full flex items-center justify-center flex-col">
                                                    <h3 className="text-xl font-bold text-slate-400 mb-4 uppercase tracking-widest">{cert.name}</h3>
                                                    <p className="text-slate-500">Imagem da certidão não disponível.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="relative min-h-[297mm] flex flex-col p-8 page-break-after-always bg-white">
                                    <div className="flex-1 flex flex-col items-center justify-center border-2 border-slate-200 border-dashed rounded-xl p-4">
                                        <h3 className="text-xl font-bold text-slate-400 mb-4 uppercase tracking-widest">Certidões</h3>
                                        <p className="text-slate-500">Nenhuma certidão anexada.</p>
                                    </div>
                                </div>
                            )
                        )}

                    </div>
                </div>
            </div>
            <style>{`
                @media print {
                    @page { margin: 0; size: A4; }
                    body { -webkit-print-color-adjust: exact; }
                    .page-break-after-always { page-break-after: always; height: 297mm; }
                }
            `}</style>
        </div>
    );
};

// --- Gerenciador de Processos de Pagamento ---

export const PaymentProcessManager = () => {
    const { user } = useAuth();
    const companyScopeId = user?.companyId ?? 'global';
    const hydratedRequestsScopeRef = useRef<string | null>(null);
    const emptyRequestForm = {
        clientId: '',
        contractId: '',
        invoiceNumber: '',
        amount: '',
        description: '',
        issueDate: '',
        invoiceFileContent: '',
        invoiceFileName: ''
    };
    const loadRequests = () => readCompanyScopedValue<PaymentRequest[]>('axsys_payment_requests_v2', [], user);
    const loadContracts = () => readCompanyScopedValue<Contract[]>('axsys_contracts_db_v2', [], user);
    const loadClients = () => readCompanyScopedValue<Client[]>('axsys_clients_db_v2', [], user);
    const normalizeDateInputValue = (value: string) => {
        if (!value) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

        const slashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (slashMatch) {
            const [, day, month, year] = slashMatch;
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return '';
        }

        return parsed.toISOString().split('T')[0];
    };

    const [requests, setRequests] = useState<PaymentRequest[]>(loadRequests);
    const [contracts, setContracts] = useState<Contract[]>(loadContracts);
    const [clients, setClients] = useState<Client[]>(loadClients);

    const [isProcessingUpload, setIsProcessingUpload] = useState(false);
    const [isFormalizing, setIsFormalizing] = useState(false);
    
    // Filters
    const [filterContract, setFilterContract] = useState(() => localStorage.getItem(ADMIN_PAYMENT_FILTER_CONTRACT_KEY) || '');
    const [filterEntity, setFilterEntity] = useState('');
    const [filterClient, setFilterClient] = useState('');

    // Edit state
    const [editingRequest, setEditingRequest] = useState<PaymentRequest | null>(null);

    // States para Modais
    const [selectedRequest, setSelectedRequest] = useState<PaymentRequest | null>(null);
    const [selectedReportMode, setSelectedReportMode] = useState<PaymentReportMode>('complete');
    const [reportChoiceRequest, setReportChoiceRequest] = useState<PaymentRequest | null>(null);
    const [pendingRequest, setPendingRequest] = useState<PaymentRequest | null>(null); 
    const [expiredCerts, setExpiredCerts] = useState<Certificate[]>([]);
    const [missingCerts, setMissingCerts] = useState<string[]>([]);
    
    const [isNewRequestModalOpen, setIsNewRequestModalOpen] = useState(() => Boolean(localStorage.getItem(ADMIN_PAYMENT_DRAFT_KEY)));
    const [newRequestForm, setNewRequestForm] = useState(() => {
        const draft = localStorage.getItem(ADMIN_PAYMENT_DRAFT_KEY);
        if (!draft) {
            return emptyRequestForm;
        }

        try {
            return { ...emptyRequestForm, ...JSON.parse(draft) };
        } catch {
            return emptyRequestForm;
        }
    });

    const refreshManagerState = React.useCallback(() => {
        hydratedRequestsScopeRef.current = null;
        setContracts(loadContracts());
        setClients(loadClients());
        setRequests(loadRequests());
    }, [user]);

    useEffect(() => {
        refreshManagerState();
    }, [companyScopeId, refreshManagerState]);

    useEffect(() => {
        if (hydratedRequestsScopeRef.current !== companyScopeId) {
            hydratedRequestsScopeRef.current = companyScopeId;
            return;
        }

        writeCompanyScopedValue('axsys_payment_requests_v2', requests, user);
    }, [companyScopeId, requests, user]);

    useTrackedStorageRefresh({
        trackedKeys: [
            'axsys_payment_requests_v2',
            'axsys_contracts_db_v2',
            'axsys_clients_db_v2',
        ],
        user,
        refresh: () => {
            refreshManagerState();
        },
    });

    useEffect(() => {
        if (!isNewRequestModalOpen) {
            return;
        }

        const hasDraftContent = Object.values(newRequestForm).some(Boolean);
        if (!hasDraftContent) {
            localStorage.removeItem(ADMIN_PAYMENT_DRAFT_KEY);
            return;
        }

        localStorage.setItem(ADMIN_PAYMENT_DRAFT_KEY, JSON.stringify(newRequestForm));
    }, [isNewRequestModalOpen, newRequestForm]);

    const handleAIUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if(e.target.files && e.target.files[0]) {
            setIsProcessingUpload(true);
            const file = e.target.files[0];
            
            try {
                const base64File = await fileToBase64(file);
                
                // Extração com Gemini
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                
                const mimeType = file.type || 'image/jpeg';
                const base64Data = base64File.split(',')[1] || base64File;

                const response = await ai.models.generateContent({
                    model: "gemini-3-flash-preview",
                    contents: {
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            },
                            {
                                text: "Extraia as seguintes informações desta nota fiscal: Número da NFS-e, Valor Líquido da NFS-e (apenas o número), Descrição (Discriminação dos Serviços), Data de Emissão (apenas a data no formato DD/MM/YYYY) e o Nome/Razão Social do TOMADOR DE SERVIÇOS."
                            }
                        ]
                    },
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                invoiceNumber: { type: Type.STRING, description: "Número da NFS-e" },
                                amount: { type: Type.NUMBER, description: "Valor Líquido da NFS-e" },
                                description: { type: Type.STRING, description: "Discriminação dos Serviços" },
                                issueDate: { type: Type.STRING, description: "Data de Emissão (DD/MM/YYYY)" },
                                takerName: { type: Type.STRING, description: "Nome/Razão Social do TOMADOR DE SERVIÇOS" }
                            },
                            required: ["invoiceNumber", "amount", "description", "issueDate", "takerName"]
                        }
                    }
                });

                let extractedData = {
                    invoiceNumber: '',
                    amount: 0,
                    description: '',
                    issueDate: '',
                    takerName: ''
                };

                if (response.text) {
                    try {
                        const parsed = JSON.parse(response.text);
                        extractedData = { ...extractedData, ...parsed };
                    } catch (e) {
                        console.error("Failed to parse Gemini response", e);
                    }
                }

                // Tentar encontrar o cliente correspondente pelo nome do tomador
                let matchedClientId = '';
                if (extractedData.takerName) {
                    const normalizedTaker = extractedData.takerName.toLowerCase().trim();
                    const matchedClient = clients.find(c => 
                        normalizedTaker.includes(c.city.toLowerCase()) || 
                        normalizedTaker.includes(c.segment.toLowerCase())
                    );
                    if (matchedClient) {
                        matchedClientId = matchedClient.id;
                    }
                }

                setNewRequestForm(prev => ({
                    ...prev,
                    clientId: matchedClientId,
                    invoiceNumber: extractedData.invoiceNumber || '',
                    amount: extractedData.amount ? extractedData.amount.toString() : '',
                    description: extractedData.description || '',
                    issueDate: normalizeDateInputValue(extractedData.issueDate || ''),
                    invoiceFileContent: base64File,
                    invoiceFileName: file.name
                }));
                
                setIsProcessingUpload(false);
            } catch (error) {
                console.error("Error reading file", error);
                setIsProcessingUpload(false);
                alert("Erro ao processar o arquivo. Tente novamente ou preencha manualmente.");
            }
        }
    };

    const handleNewRequestSubmit = () => {
        const selectedClient = clients.find(c => c.id === newRequestForm.clientId);
        const takerName = selectedClient ? `${selectedClient.segment} de ${selectedClient.city}` : 'Tomador não identificado';

        const newReq: PaymentRequest = {
            id: crypto.randomUUID(),
            invoiceFile: newRequestForm.invoiceFileName || 'Inclusão Manual',
            invoiceFileContent: newRequestForm.invoiceFileContent || undefined,
            providerName: 'G N MACHADO EMPREENDIMENTOS',
            takerName: takerName,
            clientId: newRequestForm.clientId || undefined,
            contractId: newRequestForm.contractId || undefined,
            invoiceNumber: newRequestForm.invoiceNumber,
            verificationCode: crypto.randomUUID().substring(0, 8).toUpperCase(),
            description: newRequestForm.description,
            amount: Number(newRequestForm.amount),
            issueDate: newRequestForm.issueDate,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        setRequests(current => [newReq, ...current]);
        setIsNewRequestModalOpen(false);
        setNewRequestForm(emptyRequestForm);
        localStorage.removeItem(ADMIN_PAYMENT_DRAFT_KEY);
    };

    const handleFormalizeProcess = async (req: PaymentRequest) => {
        setIsFormalizing(true);

        try {
            const currentCertificates = await getCertificates(user, { preferRemote: true });
            const { expiredCertificates, missingCertificates } = evaluatePaymentRequestCertificates(currentCertificates);
            setIsFormalizing(false);

            if (expiredCertificates.length > 0 || missingCertificates.length > 0) {
                // AVISO, MAS PERMITE CONTINUAR
                setExpiredCerts(expiredCertificates);
                setMissingCerts(missingCertificates);
                setPendingRequest(req);
            } else {
                // SUCESSO DIRETO
                const updatedReq = { ...req, status: 'formalized' as const };
                setRequests(current => current.map(r => r.id === req.id ? updatedReq : r));
                setReportChoiceRequest(updatedReq);
            }
        } catch (error) {
            console.error('Erro ao formalizar processo de pagamento', error);
            setIsFormalizing(false);
            alert('Não foi possível validar as certidões agora. Tente novamente.');
        }
    };

    const confirmForcedGeneration = () => {
        if (pendingRequest) {
            const updatedReq = { ...pendingRequest, status: 'formalized' as const };
            setRequests(current => current.map(r => r.id === pendingRequest.id ? updatedReq : r));
            setReportChoiceRequest(updatedReq);
            setExpiredCerts([]);
            setMissingCerts([]);
            setPendingRequest(null);
        }
    };

    const handleOpenReportPreview = (mode: PaymentReportMode) => {
        if (!reportChoiceRequest) {
            return;
        }

        setSelectedReportMode(mode);
        setSelectedRequest(reportChoiceRequest);
        setReportChoiceRequest(null);
    };

    const handleMarkAsPaid = (req: PaymentRequest) => {
        // 1. Update status
        const updatedReq = { ...req, status: 'paid' as const };
        setRequests(current => current.map(r => r.id === req.id ? updatedReq : r));

        // 2. Calculate tax
        const company = user?.companyId
            ? getCompanyById(user.companyId) || getCompanySettings()
            : getCompanySettings();
        const taxRate = company.taxRate || 0;
        const taxAmount = req.amount * (taxRate / 100);

        // 3. Create Income (Valor total da nota)
        saveIncome({
            id: crypto.randomUUID(),
            date: new Date().toISOString().split('T')[0],
            description: `Recebimento NF ${req.invoiceNumber || 'S/N'} - ${req.takerName}`,
            amount: req.amount,
            origin: 'payment_request',
            paymentRequestId: req.id,
            category: 'Serviços'
        }, user);

        // 4. Create Expense (Tax - Marcado como não pago)
        if (taxAmount > 0) {
            saveExpense({
                id: crypto.randomUUID(),
                date: new Date().toISOString().split('T')[0],
                description: `Imposto sobre NF ${req.invoiceNumber || 'S/N'} (${taxRate}%)`,
                amount: taxAmount,
                type: 'variable',
                category: 'Impostos',
                isPaid: false
            }, user);
        }
        
        alert('Pagamento informado com sucesso! Receita e imposto gerados no módulo financeiro.');
    };

    const handleDeleteRequest = (id: string) => {
        if (confirm('Tem certeza que deseja excluir esta solicitação?')) {
            setRequests(current => current.filter(req => req.id !== id));
        }
    };

    const handleSaveEdit = () => {
        if (editingRequest) {
            setRequests(current => current.map(req => req.id === editingRequest.id ? editingRequest : req));
            setEditingRequest(null);
        }
    };

    const filteredRequests = requests.filter(req => {
        if (filterContract && req.contractId !== filterContract) return false;
        
        if (filterEntity || filterClient) {
            const contract = contracts.find(c => c.id === req.contractId);
            const client = clients.find(c => c.id === (req.clientId || contract?.clientId));
            if (!client) return false;

            if (filterEntity && client.segment !== filterEntity) return false;
            if (filterClient && client.city !== filterClient) return false;
        }
        
        return true;
    });

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 shadow-lg shadow-blue-500/20">
                <div>
                    <h3 className="font-bold text-xl">Novo Processo de Pagamento</h3>
                    <p className="text-sm text-blue-100 opacity-90">
                        Inicie fazendo o upload da Nota Fiscal. O sistema irá ler os dados, verificar as certidões e gerar o processo completo.
                    </p>
                </div>
                <div className="relative flex gap-3">
                     <Button 
                        onClick={() => setIsNewRequestModalOpen(true)} 
                        className="bg-white text-blue-700 hover:bg-blue-50 border-0 shadow-none font-bold"
                     >
                        Nova Solicitação
                     </Button>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Filtrar por Contrato</label>
                    <select 
                        value={filterContract} 
                        onChange={(e) => setFilterContract(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    >
                        <option value="">Todos os Contratos</option>
                        {contracts.map(c => (
                            <option key={c.id} value={c.id}>{c.contractNumber} - {c.clientName}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Filtrar por Entidade</label>
                    <select 
                        value={filterEntity} 
                        onChange={(e) => setFilterEntity(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    >
                        <option value="">Todas as Entidades</option>
                        {Array.from(new Set(clients.map(c => c.segment))).map(segment => (
                            <option key={segment} value={segment}>{segment}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Filtrar por Cliente</label>
                    <select 
                        value={filterClient} 
                        onChange={(e) => setFilterClient(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                    >
                        <option value="">Todos os Clientes</option>
                        {Array.from(new Set(clients.map(c => c.city))).map(city => (
                            <option key={city} value={city}>{city}</option>
                        ))}
                    </select>
                </div>
                {(filterContract || filterEntity || filterClient) && (
                    <Button variant="secondary" onClick={() => { setFilterContract(''); setFilterEntity(''); setFilterClient(''); }}>
                        Limpar Filtros
                    </Button>
                )}
            </div>

            <div className="bg-white shadow-sm border border-slate-100 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Documento Base</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Tomador</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Valor</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Validação</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                        {filteredRequests.length === 0 && (
                            <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-medium">Nenhum processo encontrado.</td></tr>
                        )}
                        {filteredRequests.map(req => (
                            <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="p-2 bg-indigo-50 text-indigo-500 rounded-lg mr-3">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-slate-900">NFS-e #{req.invoiceNumber}</div>
                                            <div className="text-xs text-slate-500">
                                                {req.issueDate ? `Emissão: ${req.issueDate}` : `Recebido em ${new Date(req.createdAt).toLocaleDateString()}`}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    {editingRequest?.id === req.id ? (
                                        <div className="space-y-2">
                                            <input 
                                                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                                                value={editingRequest.takerName || ''}
                                                onChange={e => setEditingRequest({...editingRequest, takerName: e.target.value})}
                                                placeholder="Nome do Tomador"
                                            />
                                            <input 
                                                className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                                                value={editingRequest.description || ''}
                                                onChange={e => setEditingRequest({...editingRequest, description: e.target.value})}
                                                placeholder="Descrição"
                                            />
                                            <input 
                                                type="date"
                                                className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                                                value={editingRequest.issueDate || ''}
                                                onChange={e => setEditingRequest({...editingRequest, issueDate: e.target.value})}
                                                placeholder="Data de Emissão"
                                            />
                                            <select
                                                className="w-full border border-slate-300 rounded px-2 py-1 text-xs text-slate-600"
                                                value={editingRequest.contractId || ''}
                                                onChange={e => {
                                                    const newContractId = e.target.value;
                                                    const selectedContract = contracts.find(c => c.id === newContractId);
                                                    const selectedClient = selectedContract ? clients.find(c => c.id === selectedContract.clientId) : null;
                                                    
                                                    let newTakerName = editingRequest.takerName;
                                                    if (selectedClient && (!newTakerName || newTakerName === 'Tomador não identificado')) {
                                                        newTakerName = `${selectedClient.segment} de ${selectedClient.city}`;
                                                    }
                                                    
                                                    setEditingRequest({
                                                        ...editingRequest, 
                                                        contractId: newContractId,
                                                        clientId: selectedClient?.id,
                                                        takerName: newTakerName
                                                    });
                                                }}
                                            >
                                                <option value="">Vincular a um Contrato (Opcional)</option>
                                                {contracts.map(c => (
                                                    <option key={c.id} value={c.id}>{c.contractNumber} - {c.clientName}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="text-sm font-bold text-slate-700">{req.takerName || '---'}</div>
                                            <div className="text-xs text-slate-400 truncate w-40">{req.description}</div>
                                            {req.contractId && (() => {
                                                const contract = contracts.find(c => c.id === req.contractId);
                                                const client = contract ? clients.find(c => c.id === contract.clientId) : null;
                                                return (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full inline-block">
                                                            Contrato: {contract?.contractNumber || 'Desconhecido'}
                                                        </div>
                                                        {client && (
                                                            <>
                                                                <div className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full inline-block">
                                                                    {client.segment}
                                                                </div>
                                                                <div className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full inline-block">
                                                                    {client.city}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {editingRequest?.id === req.id ? (
                                        <input 
                                            type="number"
                                            className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right"
                                            value={editingRequest.amount || ''}
                                            onChange={e => setEditingRequest({...editingRequest, amount: Number(e.target.value)})}
                                        />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900 block">R$ {req.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {req.status === 'formalized' ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                            Formalização Feita
                                        </span>
                                    ) : req.status === 'paid' ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                            Pago
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                            Aguardando Formalização
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {editingRequest?.id === req.id ? (
                                        <div className="flex flex-col gap-2">
                                            <Button onClick={handleSaveEdit} className="text-xs py-1 px-2">Salvar</Button>
                                            <Button variant="ghost" onClick={() => setEditingRequest(null)} className="text-xs py-1 px-2">Cancelar</Button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2 items-center">
                                            {req.status === 'formalized' ? (
                                                <div className="flex flex-col items-center gap-1.5 w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                                                    <span className="text-xs font-semibold text-slate-600">Nota Paga?</span>
                                                    <div className="flex gap-2 w-full">
                                                        <Button 
                                                            onClick={() => handleMarkAsPaid(req)} 
                                                            className="text-xs py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200 shadow-sm flex-1"
                                                        >
                                                            Sim
                                                        </Button>
                                                        <Button 
                                                            variant="secondary"
                                                            onClick={() => alert('Aguardando pagamento...')} 
                                                            className="text-xs py-1.5 px-2 flex-1"
                                                        >
                                                            Não
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : req.status !== 'paid' ? (
                                                <Button 
                                                    onClick={() => handleFormalizeProcess(req)} 
                                                    isLoading={isFormalizing}
                                                    className="text-xs py-2 px-4 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200 shadow-md w-full"
                                                >
                                                    Formalizar Processo
                                                </Button>
                                            ) : null}
                                            {(req.status === 'formalized' || req.status === 'paid') && (
                                                <Button
                                                    variant="secondary"
                                                    className="text-xs py-2 w-full"
                                                    onClick={() => setReportChoiceRequest(req)}
                                                >
                                                    Relatório
                                                </Button>
                                            )}
                                            <div className="flex gap-2 w-full">
                                                {req.status !== 'paid' && (
                                                    <Button variant="secondary" className="text-xs py-1 flex-1" onClick={() => setEditingRequest(req)}>
                                                        Editar
                                                    </Button>
                                                )}
                                                <Button variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 py-1 flex-1" onClick={() => handleDeleteRequest(req.id)}>
                                                    Excluir
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>

            {/* Modal de Aviso / Confirmação */}
            {(expiredCerts.length > 0 || missingCerts.length > 0) && (
                <CertificateWarningModal 
                    expiredCertificates={expiredCerts} 
                    missingCertificates={missingCerts}
                    onClose={() => { setExpiredCerts([]); setMissingCerts([]); setPendingRequest(null); }}
                    onProceed={confirmForcedGeneration}
                />
            )}

            {reportChoiceRequest && (
                <PaymentReportChoiceModal
                    request={reportChoiceRequest}
                    onClose={() => setReportChoiceRequest(null)}
                    onSelect={handleOpenReportPreview}
                />
            )}

            {/* Modal de Sucesso (Preview do Processo) */}
            {selectedRequest && (
                <PaymentDocumentPreview 
                    request={selectedRequest} 
                    onClose={() => setSelectedRequest(null)} 
                    warnings={expiredCerts.length > 0 || missingCerts.length > 0} // Se veio do fluxo forçado, ainda mostra o aviso visual
                    contracts={contracts}
                    initialMode={selectedReportMode}
                />
            )}

            {/* Modal de Nova Solicitação */}
            {isNewRequestModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden my-8 flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800">Nova Solicitação de Pagamento</h3>
                            <button
                                onClick={() => {
                                    setIsNewRequestModalOpen(false);
                                    setNewRequestForm(emptyRequestForm);
                                    localStorage.removeItem(ADMIN_PAYMENT_DRAFT_KEY);
                                }}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-6 space-y-6 overflow-y-auto">
                            {/* Leitura com IA */}
                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-bold text-blue-800 text-sm">Preenchimento Automático com IA</h4>
                                    <p className="text-xs text-blue-600 mt-1">Faça o upload da Nota Fiscal e o sistema preencherá os dados abaixo automaticamente.</p>
                                </div>
                                <div className="shrink-0 w-full sm:w-auto">
                                    <input type="file" id="nf-ai-upload" className="hidden" accept=".pdf,.xml,.jpg,.png" onChange={handleAIUpload} />
                                    <Button 
                                        onClick={() => document.getElementById('nf-ai-upload')?.click()} 
                                        isLoading={isProcessingUpload} 
                                        className="bg-blue-600 text-white hover:bg-blue-700 text-sm w-full sm:w-auto"
                                    >
                                        {isProcessingUpload ? 'Lendo...' : 'Ler Nota Fiscal'}
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Cliente (Tomador)</label>
                                    <select 
                                        className="w-full p-2 border border-slate-300 rounded-lg"
                                        value={newRequestForm.clientId}
                                        onChange={e => setNewRequestForm({...newRequestForm, clientId: e.target.value, contractId: ''})}
                                    >
                                        <option value="">Selecione o Cliente</option>
                                        {clients.map(c => (
                                            <option key={c.id} value={c.id}>{c.segment} de {c.city}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Vincular Contrato (Opcional)</label>
                                    <select 
                                        className="w-full p-2 border border-slate-300 rounded-lg disabled:bg-slate-50 disabled:text-slate-400"
                                        value={newRequestForm.contractId}
                                        onChange={e => setNewRequestForm({...newRequestForm, contractId: e.target.value})}
                                        disabled={!newRequestForm.clientId}
                                    >
                                        <option value="">{newRequestForm.clientId ? 'Selecione o Contrato' : 'Selecione um cliente primeiro'}</option>
                                        {contracts.filter(c => c.clientId === newRequestForm.clientId).map(c => (
                                            <option key={c.id} value={c.id}>{c.contractNumber} - {c.object}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Número da Nota Fiscal</label>
                                    <input 
                                        type="text" 
                                        className="w-full p-2 border border-slate-300 rounded-lg"
                                        value={newRequestForm.invoiceNumber}
                                        onChange={e => setNewRequestForm({...newRequestForm, invoiceNumber: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Valor (R$)</label>
                                    <input 
                                        type="number" 
                                        className="w-full p-2 border border-slate-300 rounded-lg"
                                        value={newRequestForm.amount}
                                        onChange={e => setNewRequestForm({...newRequestForm, amount: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Data de Emissão</label>
                                    <input 
                                        type="date" 
                                        className="w-full p-2 border border-slate-300 rounded-lg"
                                        value={newRequestForm.issueDate}
                                        onChange={e => setNewRequestForm({...newRequestForm, issueDate: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Objeto / Descrição</label>
                                    <textarea 
                                        className="w-full p-2 border border-slate-300 rounded-lg"
                                        rows={3}
                                        value={newRequestForm.description}
                                        onChange={e => setNewRequestForm({...newRequestForm, description: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Anexo da Nota Fiscal (Opcional)</label>
                                    <input 
                                        type="file" 
                                        accept=".pdf,.xml,.jpg,.png"
                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                        onChange={async (e) => {
                                            if(e.target.files && e.target.files[0]) {
                                                const file = e.target.files[0];
                                                const base64 = await fileToBase64(file);
                                                setNewRequestForm({...newRequestForm, invoiceFileContent: base64, invoiceFileName: file.name});
                                            }
                                        }}
                                    />
                                    {newRequestForm.invoiceFileName && (
                                        <p className="text-xs text-emerald-600 mt-1 font-medium">✓ Arquivo anexado: {newRequestForm.invoiceFileName}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setIsNewRequestModalOpen(false);
                                    setNewRequestForm(emptyRequestForm);
                                    localStorage.removeItem(ADMIN_PAYMENT_DRAFT_KEY);
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button className="w-full sm:w-auto" onClick={handleNewRequestSubmit} disabled={!newRequestForm.invoiceNumber || !newRequestForm.amount || !newRequestForm.description || !newRequestForm.issueDate || !newRequestForm.clientId}>
                                Salvar e Iniciar Processo
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const Administrative: React.FC = () => {
    const [activeTab, setActiveTab] = useState<AdministrativeTabId>(() => {
        return getSafeAdministrativeTab(localStorage.getItem(ADMIN_ACTIVE_TAB_STORAGE_KEY));
    });

    useEffect(() => {
        localStorage.setItem(ADMIN_ACTIVE_TAB_STORAGE_KEY, activeTab);
    }, [activeTab]);

    return (
      <div className="max-w-7xl mx-auto space-y-8 animate-fade-in-up">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Módulo Administrativo</h1>
            <p className="mt-2 text-slate-500">Gestão de Cadastros, Propostas e Contratos.</p>
          </div>
        </div>
  
        {/* Tabs */}
        <div>
          <nav className="flex space-x-2 p-1 bg-slate-100/50 rounded-xl w-full md:w-auto overflow-x-auto" aria-label="Tabs">
              {[
                  { id: 'registrations', label: 'Cadastros' },
                  { id: 'proposals', label: 'Propostas & Orçamentos' },
                  { id: 'contracts', label: 'Contratos' }
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
            {activeTab === 'registrations' && <Registrations />}
            {activeTab === 'proposals' && <Proposals />}
            {activeTab === 'contracts' && <Contracts activeTab={activeTab} />}
        </div>
      </div>
    );
  };
