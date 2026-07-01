import React, { useState } from 'react';

import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { useTrackedStorageRefresh } from '../hooks/useTrackedStorageRefresh.ts';
import { getCompanyById } from '../services/companyService.ts';
import {
  REQUIRED_CERTIFICATE_TYPES,
  deleteCertificate,
  fileToBase64,
  getCertificates,
  saveCertificate,
} from '../services/certificateService';
import type { Certificate } from '../types';
import { buildCertificateCollections } from '../utils/certificateHistory.ts';
import {
  buildPublicCertificatesUrl,
  formatCertificateDate,
  getCertificateStatus,
} from '../utils/publicCertificates.ts';

type CertificateViewMode = 'current' | 'expired' | 'all';

const CERTIFICATE_VIEW_OPTIONS: Array<{ value: CertificateViewMode; label: string }> = [
  { value: 'current', label: 'Vigentes atuais' },
  { value: 'expired', label: 'Somente vencidas' },
  { value: 'all', label: 'Historico completo' },
];

const AddCertificateModal = ({
  isOpen,
  onClose,
  onSave,
  presetType,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (certificate: Certificate) => void;
  presetType?: string | null;
}) => {
  const [type, setType] = useState(presetType || REQUIRED_CERTIFICATE_TYPES[0]);
  const [validUntil, setValidUntil] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    setType(presetType || REQUIRED_CERTIFICATE_TYPES[0]);
    setValidUntil('');
    setFile(null);
  }, [isOpen, presetType]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validUntil || !file) {
      return;
    }

    setIsLoading(true);
    try {
      const base64File = await fileToBase64(file);
      onSave({
        id: crypto.randomUUID(),
        name: type,
        validUntil,
        fileUrl: base64File,
        createdAt: new Date().toISOString(),
      });
      onClose();
    } catch {
      alert('Erro ao processar arquivo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h3 className="font-bold text-slate-800">Nova Certidao</h3>
            <p className="mt-1 text-sm text-slate-500">Cada envio cria um novo registro e preserva o historico anterior.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-slate-600">Tipo de Certidao</label>
            <select
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {REQUIRED_CERTIFICATE_TYPES.map((certificateType) => (
                <option key={certificateType} value={certificateType}>
                  {certificateType}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Data de Validade"
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
            required
          />

          <div>
            <label className="mb-2 block text-[13px] font-semibold text-slate-600">Arquivo (PDF/Imagem)</label>
            <input
              type="file"
              accept=".pdf,.jpg,.png,.jpeg"
              onChange={(event) => setFile(event.target.files ? event.target.files[0] : null)}
              className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-brand-700 transition-all hover:file:bg-brand-100"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
            <Button type="submit" isLoading={isLoading}>Salvar nova certidao</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Certificates: React.FC = () => {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [presetType, setPresetType] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CertificateViewMode>('current');
  const [selectedType, setSelectedType] = useState('all');
  const { user } = useAuth();

  const company = user?.companyId ? getCompanyById(user.companyId) : undefined;
  const publicCertificatesUrl = typeof window !== 'undefined' && company?.publicCertificatesSlug
    ? buildPublicCertificatesUrl(window.location.origin, window.location.pathname, company.publicCertificatesSlug)
    : '';
  const fallbackPublicCertificatesUrl = typeof window !== 'undefined' && company?.publicCertificatesShareId
    ? buildPublicCertificatesUrl(window.location.origin, window.location.pathname, company.publicCertificatesShareId)
    : '';

  const loadCertificates = React.useCallback(async (preferRemote: boolean) => {
    const loadedCertificates = await getCertificates(user, { preferRemote });
    setCertificates(loadedCertificates);
  }, [user]);

  React.useEffect(() => {
    void loadCertificates(true);
  }, [loadCertificates]);

  useTrackedStorageRefresh({
    trackedKeys: ['axsys_certificates_db_v2'],
    user,
    refresh: loadCertificates,
  });

  const collections = React.useMemo(
    () => buildCertificateCollections(certificates),
    [certificates],
  );

  const currentCertificateIds = React.useMemo(
    () => new Set(collections.current.map((certificate) => certificate.id)),
    [collections.current],
  );

  const typeOptions = React.useMemo(
    () => Array.from(new Set([...REQUIRED_CERTIFICATE_TYPES, ...certificates.map((certificate) => certificate.name)])),
    [certificates],
  );

  const visibleCertificates = React.useMemo(() => {
    const baseCertificates = viewMode === 'current'
      ? collections.current
      : viewMode === 'expired'
        ? collections.expired
        : collections.all;

    if (selectedType === 'all') {
      return baseCertificates;
    }

    return baseCertificates.filter((certificate) => certificate.name === selectedType);
  }, [collections.all, collections.current, collections.expired, selectedType, viewMode]);

  const handleSave = async (newCertificate: Certificate) => {
    await saveCertificate(newCertificate, user);
    const updatedCertificates = await getCertificates(user, { preferRemote: true });
    setCertificates(updatedCertificates);
  };

  const handleOpenAddModal = (certificateType?: string) => {
    setPresetType(certificateType || null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setPresetType(null);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta certidao?')) {
      await deleteCertificate(id, user);
      const updatedCertificates = await getCertificates(user, { preferRemote: true });
      setCertificates(updatedCertificates);
    }
  };

  const handleCopyPublicLink = async () => {
    if (!publicCertificatesUrl) {
      setShareMessage('Link publico indisponivel para esta empresa.');
      return;
    }

    try {
      await navigator.clipboard.writeText(publicCertificatesUrl);
      setShareMessage('Link publico copiado.');
    } catch {
      setShareMessage('Nao foi possivel copiar automaticamente. Use o link exibido abaixo.');
    }
  };

  const emptyStateTitle = viewMode === 'current'
    ? 'Nenhuma certidao vigente encontrada'
    : viewMode === 'expired'
      ? 'Nenhuma certidao vencida encontrada'
      : 'Nenhuma certidao anexada';

  const emptyStateDescription = viewMode === 'current'
    ? 'As versoes atuais aparecem aqui em uma unica visao por tipo. O historico continua salvo.'
    : viewMode === 'expired'
      ? 'Quando houver documentos vencidos, eles ficarao disponiveis neste filtro.'
      : 'Para habilitar a geracao de processos de pagamento, anexe as certidoes obrigatorias.';

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Certidoes Negativas</h1>
          <p className="mt-1 text-sm text-gray-500">Mantenha a regularidade fiscal sem perder o historico das versoes anteriores.</p>
        </div>
        <Button onClick={() => handleOpenAddModal()}>+ Adicionar Nova Certidao</Button>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Vigentes atuais</p>
          <p className="mt-3 text-3xl font-bold text-emerald-900">{collections.current.length}</p>
          <p className="mt-2 text-sm text-emerald-800">Uma versao ativa por tipo para uso operacional.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Historico</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">{collections.history.length}</p>
          <p className="mt-2 text-sm text-slate-500">Registros anteriores preservados para consulta.</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Vencidas</p>
          <p className="mt-3 text-3xl font-bold text-amber-900">{collections.expired.length}</p>
          <p className="mt-2 text-sm text-amber-800">Use este filtro para localizar o que precisa renovar.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Total salvo</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">{collections.all.length}</p>
          <p className="mt-2 text-sm text-slate-500">Todas as versoes enviadas pela empresa.</p>
        </div>
      </section>

      {company && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Link publico direto</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Compartilhe as certidoes desta empresa sem depender de site externo</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Esse endereco pode ser enviado direto ao cliente. A pagina publica mostra as vigentes atuais primeiro e deixa o historico disponivel quando necessario.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={handleCopyPublicLink}>Copiar Link Publico</Button>
              {publicCertificatesUrl && (
                <a
                  href={publicCertificatesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Abrir Pagina Publica
                </a>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">URL principal</p>
              <p className="mt-2 break-all text-sm font-semibold text-slate-700">{publicCertificatesUrl || 'Link nao disponivel.'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Codigo de fallback</p>
              <p className="mt-2 break-all text-sm font-semibold text-slate-700">{company.publicCertificatesShareId || 'Nao gerado.'}</p>
            </div>
            {fallbackPublicCertificatesUrl && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">URL alternativa estavel</p>
                <p className="mt-2 break-all text-sm font-semibold text-slate-700">{fallbackPublicCertificatesUrl}</p>
              </div>
            )}
            {shareMessage && <p className="text-sm font-medium text-brand-700">{shareMessage}</p>}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.2fr,1fr,auto]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Exibicao</label>
            <select
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as CertificateViewMode)}
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            >
              {CERTIFICATE_VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Tipo de certidao</label>
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="all">Todos os tipos</option>
              {typeOptions.map((certificateType) => (
                <option key={certificateType} value={certificateType}>
                  {certificateType}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Exibindo <span className="font-bold text-slate-900">{visibleCertificates.length}</span> registro(s).
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleCertificates.map((certificate) => {
          const status = getCertificateStatus(certificate.validUntil);
          const isCurrent = currentCertificateIds.has(certificate.id);

          return (
            <div
              key={certificate.id}
              className="group flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-lg"
            >
              <div>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className={`rounded-xl p-3 ${status === 'valid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${status === 'valid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {status === 'valid' ? 'Valida' : 'Vencida'}
                    </span>
                    {!isCurrent && (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">
                        Historico
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="min-h-[3rem] text-lg font-bold leading-tight text-gray-900">{certificate.name}</h3>
                <p className="mt-2 flex items-center text-sm text-gray-500">
                  <svg className="mr-1.5 h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Vence em:
                  <span className="ml-1 font-semibold">{certificate.validUntil ? formatCertificateDate(certificate.validUntil) : ''}</span>
                </p>
                {certificate.createdAt && (
                  <p className="mt-1 text-sm text-slate-500">
                    Anexada em: <span className="font-semibold text-slate-700">{formatCertificateDate(certificate.createdAt)}</span>
                  </p>
                )}
              </div>

              <div className="mt-6 space-y-4 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  {certificate.fileUrl ? (
                    <a
                      href={certificate.fileUrl}
                      download={`${certificate.name}.pdf`}
                      className="flex items-center text-sm font-bold text-brand-600 transition-colors hover:text-brand-700"
                    >
                      <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Baixar
                    </a>
                  ) : (
                    <span
                      className="flex items-center text-sm font-medium text-slate-400"
                      title="Arquivo nao salvo devido ao limite de armazenamento do navegador"
                    >
                      <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Sem arquivo
                    </span>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    className="px-3 py-2 text-brand-700 hover:bg-brand-50 hover:text-brand-800"
                    onClick={() => handleOpenAddModal(certificate.name)}
                  >
                    Nova versao
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-center text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => handleDelete(certificate.id)}
                >
                  Excluir registro
                </Button>
              </div>
            </div>
          );
        })}

        {visibleCertificates.length === 0 && (
          <div className="col-span-1 flex flex-col items-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center md:col-span-2 lg:col-span-3">
            <div className="mb-4 rounded-full bg-white p-4 shadow-sm">
              <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{emptyStateTitle}</h3>
            <p className="mt-2 max-w-xl text-sm text-gray-500">{emptyStateDescription}</p>
            <div className="mt-8">
              <Button onClick={() => handleOpenAddModal()} className="px-8 shadow-lg shadow-brand-200">Adicionar agora</Button>
            </div>
            <div className="mt-8 rounded-lg border border-gray-100 bg-white p-4 text-left text-xs text-gray-400 shadow-sm">
              <p className="mb-2 font-bold uppercase tracking-wide">Documentacao necessaria:</p>
              <ul className="list-inside list-disc space-y-1">
                {REQUIRED_CERTIFICATE_TYPES.map((requiredCertificate) => (
                  <li key={requiredCertificate}>{requiredCertificate}</li>
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
        presetType={presetType}
      />
    </div>
  );
};
