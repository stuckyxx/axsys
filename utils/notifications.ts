import type { Certificate, Contract } from '../types.ts';
import { getContractDaysRemaining, getContractStatus } from './contracts.ts';
import { buildCertificateCollections } from './certificateHistory.ts';

export const CONTRACT_ALERT_WINDOW_DAYS = 45;
export const CERTIFICATE_ALERT_WINDOW_DAYS = 5;

export type DeadlineAlertSeverity = 'warning' | 'critical';
export type DeadlineAlertCategory = 'contract' | 'certificate';

export interface DeadlineAlert {
  id: string;
  category: DeadlineAlertCategory;
  resourceId: string;
  severity: DeadlineAlertSeverity;
  daysRemaining: number;
  title: string;
  description: string;
}

export interface DeadlineAlertsSummary {
  total: number;
  criticalCount: number;
  warningCount: number;
  contractsCount: number;
  certificatesCount: number;
}

interface BuildDeadlineAlertsInput {
  contracts: Contract[];
  certificates: Certificate[];
  today?: Date;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const normalizeDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const getCertificateDaysRemaining = (certificate: Certificate, today: Date) => {
  const normalizedToday = normalizeDate(today);
  const validUntil = normalizeDate(certificate.validUntil);
  return Math.ceil((validUntil.getTime() - normalizedToday.getTime()) / DAY_IN_MS);
};

const formatDaysLabel = (daysRemaining: number, singular: string, plural: string) => {
  const absoluteDays = Math.abs(daysRemaining);
  if (absoluteDays === 0) {
    return `vence hoje`;
  }

  if (daysRemaining < 0) {
    return `venceu há ${absoluteDays} ${absoluteDays === 1 ? singular : plural}`;
  }

  return `vence em ${absoluteDays} ${absoluteDays === 1 ? singular : plural}`;
};

export const buildDeadlineAlerts = ({
  contracts,
  certificates,
  today = new Date(),
}: BuildDeadlineAlertsInput): DeadlineAlert[] => {
  const contractAlerts = contracts.flatMap<DeadlineAlert>((contract) => {
    const status = getContractStatus(contract, today);
    if (status === 'Encerrado') {
      return [];
    }

    const daysRemaining = getContractDaysRemaining(contract, today);
    if (daysRemaining > CONTRACT_ALERT_WINDOW_DAYS) {
      return [];
    }

    return [
      {
        id: `contract:${contract.id}`,
        category: 'contract',
        resourceId: contract.id,
        severity: daysRemaining < 0 ? 'critical' : 'warning',
        daysRemaining,
        title: `${contract.clientName} ${contract.contractNumber ? `· ${contract.contractNumber}` : ''}`.trim(),
        description: `Contrato ${formatDaysLabel(daysRemaining, 'dia', 'dias')}.`,
      },
    ];
  });

  const relevantCertificates = buildCertificateCollections(certificates, today).relevant;

  const certificateAlerts = relevantCertificates.flatMap<DeadlineAlert>((certificate) => {
    const daysRemaining = getCertificateDaysRemaining(certificate, today);
    if (daysRemaining > CERTIFICATE_ALERT_WINDOW_DAYS) {
      return [];
    }

    return [
      {
        id: `certificate:${certificate.id}`,
        category: 'certificate',
        resourceId: certificate.id,
        severity: daysRemaining < 0 ? 'critical' : 'warning',
        daysRemaining,
        title: certificate.name,
        description: `Certidão ${formatDaysLabel(daysRemaining, 'dia', 'dias')}.`,
      },
    ];
  });

  return [...contractAlerts, ...certificateAlerts].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === 'critical' ? -1 : 1;
    }

    return left.daysRemaining - right.daysRemaining;
  });
};

export const summarizeDeadlineAlerts = (alerts: DeadlineAlert[]): DeadlineAlertsSummary =>
  alerts.reduce<DeadlineAlertsSummary>(
    (summary, alert) => {
      summary.total += 1;

      if (alert.severity === 'critical') {
        summary.criticalCount += 1;
      } else {
        summary.warningCount += 1;
      }

      if (alert.category === 'contract') {
        summary.contractsCount += 1;
      } else {
        summary.certificatesCount += 1;
      }

      return summary;
    },
    {
      total: 0,
      criticalCount: 0,
      warningCount: 0,
      contractsCount: 0,
      certificatesCount: 0,
    },
  );
