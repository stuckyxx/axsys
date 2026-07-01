import React from 'react';
import { Link } from 'react-router-dom';

import type { DeadlineAlert } from '../../utils/notifications.ts';

const ADMIN_ACTIVE_TAB_STORAGE_KEY = 'adminActiveTab';

interface NotificationBellProps {
  alerts: DeadlineAlert[];
  unreadCount: number;
  unreadIdsSet: Set<string>;
  canAccessContracts?: boolean;
  canAccessCertificates?: boolean;
  onOpen?: () => void;
}

const openContractsTab = () => {
  window.localStorage.setItem(ADMIN_ACTIVE_TAB_STORAGE_KEY, 'contracts');
};

const getAlertTone = (alert: DeadlineAlert) =>
  alert.severity === 'critical'
    ? 'border-red-100 bg-red-50/70 text-red-700'
    : 'border-amber-100 bg-amber-50/70 text-amber-700';

export const NotificationBell: React.FC<NotificationBellProps> = ({
  alerts,
  unreadCount,
  unreadIdsSet,
  canAccessContracts = true,
  canAccessCertificates = true,
  onOpen,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    onOpen?.();
  }, [isOpen, onOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-900 hover:shadow-md"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Abrir notificações"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white shadow">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/80">
          <div className="border-b border-slate-100 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Notificações</p>
                <p className="mt-1 text-xs text-slate-500">
                  {unreadCount > 0
                    ? `${unreadCount} alerta(s) novo(s) hoje`
                    : 'Tudo visto hoje'}
                </p>
              </div>
              {alerts.length > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {alerts.length} total
                </span>
              )}
            </div>
          </div>

          {alerts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700">Nenhum alerta no momento</p>
              <p className="mt-1 text-xs text-slate-500">Quando houver contrato ou certidão perto do vencimento, ele aparece aqui.</p>
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto px-2 py-2">
              {alerts.map((alert) => {
                const isUnread = unreadIdsSet.has(alert.id);
                const canOpenContract = alert.category === 'contract' && canAccessContracts;
                const canOpenCertificate = alert.category === 'certificate' && canAccessCertificates;
                const commonClasses = `block rounded-xl border px-3 py-3 transition-colors hover:border-slate-200 hover:bg-slate-50 ${isUnread ? 'ring-1 ring-brand-100' : ''}`;

                const content = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${getAlertTone(alert)}`}>
                            {alert.category === 'contract' ? 'Contrato' : 'Certidão'}
                          </span>
                          {isUnread && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                        </div>
                        <p className="mt-2 truncate text-sm font-semibold text-slate-800">{alert.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{alert.description}</p>
                      </div>
                      <svg className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </>
                );

                if (canOpenContract) {
                  return (
                    <Link
                      key={alert.id}
                      to="/administrative"
                      onClick={() => {
                        openContractsTab();
                        setIsOpen(false);
                      }}
                      className={commonClasses}
                    >
                      {content}
                    </Link>
                  );
                }

                if (canOpenCertificate) {
                  return (
                    <Link
                      key={alert.id}
                      to="/certificates"
                      onClick={() => setIsOpen(false)}
                      className={commonClasses}
                    >
                      {content}
                    </Link>
                  );
                }

                return (
                  <div key={alert.id} className={`${commonClasses} cursor-default opacity-80`}>
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
