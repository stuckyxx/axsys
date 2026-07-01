import React from 'react';
import { Link } from 'react-router-dom';

import type { DeadlineAlert, DeadlineAlertsSummary } from '../../utils/notifications.ts';

const ADMIN_ACTIVE_TAB_STORAGE_KEY = 'adminActiveTab';

interface DeadlineAlertsBannerProps {
  alerts: DeadlineAlert[];
  summary: DeadlineAlertsSummary;
  canAccessContracts?: boolean;
  canAccessCertificates?: boolean;
}

const openContractsTab = () => {
  window.localStorage.setItem(ADMIN_ACTIVE_TAB_STORAGE_KEY, 'contracts');
};

export const DeadlineAlertsBanner: React.FC<DeadlineAlertsBannerProps> = ({
  alerts,
  summary,
  canAccessContracts = true,
  canAccessCertificates = true,
}) => {
  if (summary.total === 0) {
    return null;
  }

  const previewAlerts = alerts.slice(0, 2);

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {summary.criticalCount > 0
                ? `${summary.criticalCount} alerta(s) crítico(s) exigem atenção imediata.`
                : `${summary.total} alerta(s) de vencimento em acompanhamento.`}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              {summary.contractsCount > 0 && `${summary.contractsCount} contrato(s)`}
              {summary.contractsCount > 0 && summary.certificatesCount > 0 && ' e '}
              {summary.certificatesCount > 0 && `${summary.certificatesCount} certidão(ões)`}
              {' '}estão perto do vencimento.
            </p>
            <div className="mt-2 flex flex-col gap-1 text-xs text-amber-900 sm:flex-row sm:flex-wrap sm:gap-3">
              {previewAlerts.map((alert) => (
                <span key={alert.id} className="rounded-full bg-white/80 px-3 py-1 font-medium">
                  {alert.title}: {alert.description}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {summary.contractsCount > 0 && canAccessContracts && (
            <Link
              to="/administrative"
              onClick={openContractsTab}
              className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
            >
              Ver contratos
            </Link>
          )}
          {summary.certificatesCount > 0 && canAccessCertificates && (
            <Link
              to="/certificates"
              className="inline-flex items-center rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
            >
              Ver certidões
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
