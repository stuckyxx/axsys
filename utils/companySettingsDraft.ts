import type { Company } from '../types.ts';

const COMPANY_SETTINGS_DRAFT_PREFIX = 'axsys_company_settings_draft_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const getStorage = (): StorageLike | null => {
  if (typeof window !== 'undefined') {
    return window.localStorage;
  }

  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }

  return null;
};

export const buildCompanySettingsDraftKey = (companyId: string) =>
  `${COMPANY_SETTINGS_DRAFT_PREFIX}:${companyId}`;

export const readCompanySettingsDraft = (companyId: string): Company | null => {
  const storage = getStorage();
  const storedDraft = storage?.getItem(buildCompanySettingsDraftKey(companyId));

  if (!storedDraft) {
    return null;
  }

  try {
    return JSON.parse(storedDraft) as Company;
  } catch {
    return null;
  }
};

export const saveCompanySettingsDraft = (company: Company): void => {
  getStorage()?.setItem(buildCompanySettingsDraftKey(company.id), JSON.stringify(company));
};

export const clearCompanySettingsDraft = (companyId: string): void => {
  getStorage()?.removeItem(buildCompanySettingsDraftKey(companyId));
};

export const applyCompanySettingsDraft = (company: Company): Company =>
  readCompanySettingsDraft(company.id) || company;
