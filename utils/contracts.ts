import type { Contract } from '../types.ts';

export type ContractStatus = 'Todos' | 'Ativo' | 'A vencer' | 'Vencido' | 'Encerrado';
export type ContractEntity = 'Todos' | 'Prefeitura' | 'Câmara' | 'Empresa';

export interface ContractFilters {
  search: string;
  status: ContractStatus;
  entity: ContractEntity;
}

export interface ContractSummary {
  activeCount: number;
  expiringCount: number;
  expiredCount: number;
  closedCount: number;
  totalValue: number;
}

export interface PaginatedContracts<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const ADMIN_PAYMENT_FILTER_CONTRACT_KEY = 'axsys_payment_requests_contract_filter_v1';
export const ADMIN_PAYMENT_DRAFT_KEY = 'axsys_payment_request_draft_v1';

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const normalizeDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const deriveContractEntity = (clientName: string): Exclude<ContractEntity, 'Todos'> => {
  const normalized = clientName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  if (normalized.includes('prefeitura')) {
    return 'Prefeitura';
  }

  if (normalized.includes('camara')) {
    return 'Câmara';
  }

  return 'Empresa';
};

export const getContractStatus = (
  contract: Contract,
  today: Date = new Date(),
): Exclude<ContractStatus, 'Todos'> => {
  if (contract.closedAt) {
    return 'Encerrado';
  }

  const normalizedToday = normalizeDate(today);
  const endDate = normalizeDate(contract.endDate);

  if (normalizedToday.getTime() > endDate.getTime()) {
    return 'Vencido';
  }

  const remainingMs = endDate.getTime() - normalizedToday.getTime();

  if (remainingMs <= THIRTY_DAYS_IN_MS) {
    return 'A vencer';
  }

  return 'Ativo';
};

export const getContractProgress = (contract: Contract, today: Date = new Date()) => {
  const startDate = normalizeDate(contract.startDate);
  const endDate = normalizeDate(contract.endDate);
  const normalizedToday = normalizeDate(today);

  if (normalizedToday.getTime() <= startDate.getTime()) {
    return 0;
  }

  if (normalizedToday.getTime() >= endDate.getTime() || contract.closedAt) {
    return 100;
  }

  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = normalizedToday.getTime() - startDate.getTime();

  if (totalDuration <= 0) {
    return 100;
  }

  return Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
};

export const getContractDaysRemaining = (contract: Contract, today: Date = new Date()) => {
  const normalizedToday = normalizeDate(today);
  const endDate = normalizeDate(contract.endDate);
  return Math.ceil((endDate.getTime() - normalizedToday.getTime()) / DAY_IN_MS);
};

export const summarizeContracts = (contracts: Contract[], today: Date = new Date()): ContractSummary =>
  contracts.reduce<ContractSummary>(
    (summary, contract) => {
      const status = getContractStatus(contract, today);

      if (status === 'Ativo') {
        summary.activeCount += 1;
      }

      if (status === 'A vencer') {
        summary.expiringCount += 1;
      }

      if (status === 'Vencido') {
        summary.expiredCount += 1;
      }

      if (status === 'Encerrado') {
        summary.closedCount += 1;
      }

      summary.totalValue += contract.totalValue;

      return summary;
    },
    {
      activeCount: 0,
      expiringCount: 0,
      expiredCount: 0,
      closedCount: 0,
      totalValue: 0,
    },
  );

export const filterContracts = (
  contracts: Contract[],
  filters: ContractFilters,
  today: Date = new Date(),
) => {
  const query = filters.search.trim().toLowerCase();

  return contracts.filter((contract) => {
    const status = getContractStatus(contract, today);
    const entity = deriveContractEntity(contract.clientName);

    if (filters.status !== 'Todos' && status !== filters.status) {
      return false;
    }

    if (filters.entity !== 'Todos' && entity !== filters.entity) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [contract.clientName, contract.contractNumber, contract.object]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
};

export const paginateContracts = <T,>(items: T[], page: number, pageSize: number): PaginatedContracts<T> => {
  const safePageSize = Math.max(1, pageSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * safePageSize;

  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
};

export const formatContractCurrency = (value: number) =>
  value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });

export const formatContractDate = (value: string) => {
  if (!value) {
    return '';
  }

  try {
    return normalizeDate(value).toLocaleDateString('pt-BR', {
      timeZone: 'UTC',
    });
  } catch {
    return value;
  }
};
