import React, { useState } from 'react';

import { Button } from '../Button';
import { FileTextIcon, PaperclipIcon, XIcon } from './ContractIcons';

interface ContractAttachmentModalProps {
  existingAttachmentName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void> | void;
  title: string;
}

export const ContractAttachmentModal: React.FC<ContractAttachmentModalProps> = ({
  existingAttachmentName,
  isOpen,
  onClose,
  onSave,
  title,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleSave = async () => {
    if (!selectedFile) {
      return;
    }

    setIsSaving(true);
    await onSave(selectedFile);
    setIsSaving(false);
    setSelectedFile(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_40px_100px_-50px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Anexo do contrato</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            aria-label="Fechar modal de anexo"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-white p-3 text-brand-600 shadow-sm ring-1 ring-slate-200">
                <PaperclipIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">Anexe o PDF ou arquivo oficial do contrato</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  O arquivo será armazenado no modelo local atual para download posterior e compartilhamento interno.
                </p>
                {existingAttachmentName && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    <FileTextIcon className="h-4 w-4 text-brand-600" />
                    {existingAttachmentName}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Arquivo do contrato</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 file:mr-4 file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
            {selectedFile && <p className="mt-2 text-xs font-medium text-emerald-600">Arquivo selecionado: {selectedFile.name}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-5">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selectedFile} isLoading={isSaving}>
            Salvar anexo
          </Button>
        </div>
      </div>
    </div>
  );
};
