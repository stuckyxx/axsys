import React from 'react';

import { getDeadlineAlertsSnapshot } from '../services/deadlineAlerts.ts';
import { COMPANY_STORAGE_UPDATED_EVENT } from '../services/storageScope.ts';
import type { User } from '../types.ts';
import type { DeadlineAlert, DeadlineAlertsSummary } from '../utils/notifications.ts';

const EMPTY_SUMMARY: DeadlineAlertsSummary = {
  total: 0,
  criticalCount: 0,
  warningCount: 0,
  contractsCount: 0,
  certificatesCount: 0,
};

export const useDeadlineAlerts = (user?: Pick<User, 'id' | 'companyId'> | null) => {
  const [alerts, setAlerts] = React.useState<DeadlineAlert[]>([]);
  const [summary, setSummary] = React.useState<DeadlineAlertsSummary>(EMPTY_SUMMARY);

  React.useEffect(() => {
    let cancelled = false;

    const loadAlerts = async () => {
      const snapshot = await getDeadlineAlertsSnapshot(user);
      if (cancelled) {
        return;
      }

      setAlerts(snapshot.alerts);
      setSummary(snapshot.summary);
    };

    const handleWindowFocus = () => {
      void loadAlerts();
    };

    const handleStorageUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; companyId?: string }>).detail;
      if (!detail || (detail.key !== 'axsys_contracts_db_v2' && detail.key !== 'axsys_certificates_db_v2')) {
        return;
      }

      if (detail.companyId && detail.companyId !== (user?.companyId || 'global')) {
        return;
      }

      void loadAlerts();
    };

    void loadAlerts();
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('storage', handleWindowFocus);
    window.addEventListener(COMPANY_STORAGE_UPDATED_EVENT, handleStorageUpdate as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('storage', handleWindowFocus);
      window.removeEventListener(COMPANY_STORAGE_UPDATED_EVENT, handleStorageUpdate as EventListener);
    };
  }, [user?.companyId, user?.id]);

  return {
    alerts,
    summary,
  };
};
