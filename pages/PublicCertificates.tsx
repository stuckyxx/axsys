import React from 'react';
import { useParams } from 'react-router-dom';

import { getCertificates } from '../services/certificateService';
import { getCompanyByPublicCertificatesIdentifier } from '../services/companyService.ts';
import type { Certificate, Company } from '../types.ts';
import {
  buildPublicCertificatesSections,
  formatCertificateDate,
  getCertificateStatus,
} from '../utils/publicCertificates.ts';

const CertificateCard = ({ certificate }: { certificate: Certificate }) => {
  const status = getCertificateStatus(certificate.validUntil);

  return (
    <article className="flex h-full flex-col justify-between rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className={`rounded-2xl p-3 ${status === 'valid' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${status === 'valid' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {status === 'valid' ? 'Valida' : 'Vencida'}
          </span>
        </div>

        <h2 className="text-lg font-bold text-slate-900">{certificate.name}</h2>
        <p className="mt-3 text-sm text-slate-500">
          Validade: <span className="font-semibold text-slate-700">{formatCertificateDate(certificate.validUntil)}</span>
        </p>
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        {certificate.fileUrl ? (
          <a
            href={certificate.fileUrl}
            download={`${certificate.name}.pdf`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Baixar certidao
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Arquivo indisponivel
          </span>
        )}
      </div>
    </article>
  );
};

export const PublicCertificates: React.FC = () => {
  const { identifier } = useParams();
  const [company, setCompany] = React.useState<Company | null>(null);
  const [certificates, setCertificates] = React.useState<Certificate[]>([]);
  const [showHistory, setShowHistory] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadPublicCertificates = async () => {
      if (!identifier) {
        setCompany(null);
        setCertificates([]);
        setIsLoading(false);
        return;
      }

      const resolvedCompany = getCompanyByPublicCertificatesIdentifier(identifier);
      if (!resolvedCompany) {
        setCompany(null);
        setCertificates([]);
        setIsLoading(false);
        return;
      }

      setCompany(resolvedCompany);
      const companyCertificates = await getCertificates({ companyId: resolvedCompany.id });
      setCertificates(companyCertificates);
      setIsLoading(false);
    };

    setIsLoading(true);
    void loadPublicCertificates();
  }, [identifier]);

  const { current, history } = React.useMemo(
    () => buildPublicCertificatesSections(certificates),
    [certificates],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-white" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Certidoes publicas</p>
          <h1 className="mt-4 text-3xl font-bold">Pagina nao encontrada</h1>
          <p className="mt-4 text-sm text-slate-300">
            O link informado nao corresponde a uma empresa publica cadastrada no sistema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.15),_transparent_35%),linear-gradient(180deg,#020617_0%,#0f172a_45%,#e2e8f0_45%,#f8fafc_100%)] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/85 p-8 text-white shadow-2xl backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Link publico direto</p>
          <h1 className="mt-4 text-3xl font-bold md:text-5xl">{company.corporateName}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            Consulte e baixe as certidoes anexadas no sistema. As vigentes atuais aparecem primeiro; o historico continua disponivel quando necessario.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Validas</p>
              <p className="mt-2 text-3xl font-bold">{current.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Historico</p>
              <p className="mt-2 text-3xl font-bold">{history.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Codigo publico</p>
              <p className="mt-2 break-all text-sm font-semibold text-slate-200">{company.publicCertificatesShareId}</p>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] bg-white p-8 shadow-xl ring-1 ring-slate-200/70">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Certidoes disponiveis</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Documentos com acesso publico</h2>
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((currentValue) => !currentValue)}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                {showHistory ? 'Ocultar historico' : `Mostrar historico (${history.length})`}
              </button>
            )}
          </div>

          {current.length > 0 ? (
            <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {current.map((certificate) => (
                <CertificateCard key={certificate.id} certificate={certificate} />
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
              <p className="text-lg font-semibold text-slate-900">Nenhuma certidao valida disponivel</p>
              <p className="mt-2 text-sm text-slate-500">No momento, nao ha documentos publicos validos para consulta.</p>
            </div>
          )}

          {showHistory && history.length > 0 && (
            <div className="mt-10">
              <div className="mb-5 border-t border-slate-200 pt-8">
                <h3 className="text-xl font-bold text-slate-900">Historico de certidoes</h3>
                <p className="mt-2 text-sm text-slate-500">Versoes anteriores e documentos mantidos para consulta historica.</p>
              </div>
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {history.map((certificate) => (
                  <CertificateCard key={certificate.id} certificate={certificate} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
