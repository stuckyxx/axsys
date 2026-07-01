import React, { useEffect, useRef, useState } from 'react';

import { DownloadIcon, EyeIcon, LinkIcon, MoreIcon, PaperclipIcon, SparkIcon, XIcon } from './ContractIcons';

interface ContractActionsMenuProps {
  canClose: boolean;
  onAttach: () => void;
  onCloseContract: () => void;
  onDownload: () => void;
  onGeneratePaymentRequest: () => void;
  onGeneratePublicLink: () => void;
  onViewCertificates: () => void;
  onViewDetails: () => void;
  onViewPayments: () => void;
}

export const ContractActionsMenu: React.FC<ContractActionsMenuProps> = ({
  canClose,
  onAttach,
  onCloseContract,
  onDownload,
  onGeneratePaymentRequest,
  onGeneratePublicLink,
  onViewCertificates,
  onViewDetails,
  onViewPayments,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const closeAndRun = (callback: () => void) => {
    setIsOpen(false);
    callback();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-all duration-200 hover:border-brand-100 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Abrir menu de ações do contrato"
      >
        <MoreIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-14 z-40 w-72 rounded-[1.4rem] border border-slate-200 bg-white p-2 shadow-[0_35px_80px_-40px_rgba(15,23,42,0.4)]"
        >
          <button
            type="button"
            onClick={() => closeAndRun(onViewDetails)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <EyeIcon className="h-4 w-4 text-slate-500" />
            Ver detalhes
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onAttach)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <PaperclipIcon className="h-4 w-4 text-slate-500" />
            Anexar contrato
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onGeneratePaymentRequest)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <SparkIcon className="h-4 w-4 text-slate-500" />
            Gerar solicitação de pagamento
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onViewPayments)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <SparkIcon className="h-4 w-4 text-slate-500" />
            Ver pagamentos
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onViewCertificates)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <SparkIcon className="h-4 w-4 text-slate-500" />
            Ver certidões
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onGeneratePublicLink)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <LinkIcon className="h-4 w-4 text-slate-500" />
            Gerar link público
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onDownload)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            role="menuitem"
          >
            <DownloadIcon className="h-4 w-4 text-slate-500" />
            Baixar PDF
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(onCloseContract)}
            disabled={!canClose}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            role="menuitem"
          >
            <XIcon className="h-4 w-4" />
            Encerrar contrato
          </button>
        </div>
      )}
    </div>
  );
};
