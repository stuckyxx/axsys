import type { User, Contract } from '../types.ts';
import { getCertificates } from './certificateService.ts';
import { readCompanyScopedValue } from './storageScope.ts';
import { buildDeadlineAlerts, summarizeDeadlineAlerts } from '../utils/notifications.ts';

const CONTRACTS_STORAGE_KEY = 'axsys_contracts_db_v2';

export const getDeadlineAlertsSnapshot = async (user?: Pick<User, 'companyId'> | null) => {
  const contracts = readCompanyScopedValue<Contract[]>(CONTRACTS_STORAGE_KEY, [], user);
  const certificates = await getCertificates(user);
  const alerts = buildDeadlineAlerts({ contracts, certificates });

  return {
    alerts,
    summary: summarizeDeadlineAlerts(alerts),
  };
};
