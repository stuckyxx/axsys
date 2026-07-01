import React from 'react';
import { Link } from 'react-router-dom';

import type { DeadlineAlert, DeadlineAlertsSummary } from '../../utils/notifications.ts';

const ADMIN_ACTIVE_TAB_STORAGE_KEY = 'adminActiveTab';

interface DeadlineAlertsCardProps {
  alerts: DeadlineAlert[];
  summary: DeadlineAlertsSummary;
  canAccessContracts?: boolean;
  canAccessCertificates?: boolean;
}

const openContractsTab = () => {
  window.localStorage.setItem(ADMIN_ACTIVE_TAB_STORAGE_KEY, 'contracts');
};

const getBadgeClasses = (severity: DeadlineAlert['severity']) =>
  severity === 'critical'
    ? 'bg-red-100 text-red-700'
    : 'bg-amber-100 text-amber-700';

export const DeadlineAlertsCard: React.FC<DeadlineAlertsCardProps> = ({
  alerts,
  summary,
  canAccessContracts = true,
  canAccessCertificates = true,
}) => {
  if (summary.total === 0) {
    return (
      <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-emerald-100 p-2 text-emerald-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-800">Prazos em dia</h3>
            <p className="mt-1 text-sm text-gray-500">
              Nenhum contrato ou certidão está na faixa de alerta agora.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Alertas de vencimento</h3>
          <p className="mt-1 text-sm text-gray-500">
            Contratos com até 45 dias e certidões com até 5 dias já entram em acompanhamento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{summary.criticalCount} crítico(s)</span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{summary.warningCount} aviso(s)</span>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {alerts.slice(0, 4).map((alert) => (
          <div key={alert.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-800">{alert.title}</h4>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${getBadgeClasses(alert.severity)}`}>
                  {alert.severity === 'critical' ? 'Crítico' : 'Acompanhamento'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{alert.description}</p>
            </div>
            {alert.category === 'contract' && canAccessContracts ? (
              <Link
                to="/administrative"
                onClick={openContractsTab}
                className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-100"
              >
                Abrir contratos
              </Link>
            ) : alert.category === 'certificate' && canAccessCertificates ? (
              <Link
                to="/certificates"
                className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-100"
              >
                Abrir certidões
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-400 shadow-sm ring-1 ring-gray-200">
                Acompanhar com administrador
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
