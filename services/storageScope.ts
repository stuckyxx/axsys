import type { User } from '../types.ts';

export const SESSION_USER_STORAGE_KEY = 'sgi_user_v2';
export const COMPANY_STORAGE_UPDATED_EVENT = 'axsys:company-storage-updated';

export const GLOBAL_STORAGE_KEYS = [
  'axsys_users_db_v3',
  'axsys_companies_db_v2',
] as const;

export const COMPANY_STORAGE_KEYS = [
  'axsys_clients_db_v2',
  'axsys_services_db_v2',
  'axsys_income_db_v2',
  'axsys_expense_db_v2',
  'axsys_contracts_db_v2',
  'axsys_proposals_db_v2',
  'axsys_payment_requests_v2',
  'axsys_certificates_db_v2',
] as const;

export type CompanyScopedStorageKey = (typeof COMPANY_STORAGE_KEYS)[number];

type StorageSyncHandler = (storageKey: string, user?: Pick<User, 'companyId'> | null) => void;

const COMPANY_SCOPE_PREFIX = 'company';
const DEFAULT_COMPANY_SCOPE = 'global';
let storageSyncHandler: StorageSyncHandler | null = null;

export const dispatchCompanyStorageUpdatedEvent = (
  key: string,
  scopedKey: string,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (
    typeof window === 'undefined'
    || typeof window.dispatchEvent !== 'function'
    || typeof window.CustomEvent !== 'function'
  ) {
    return;
  }

  window.dispatchEvent(
    new window.CustomEvent(COMPANY_STORAGE_UPDATED_EVENT, {
      detail: {
        key,
        scopedKey,
        companyId: getScopeCompanyId(user ?? getStoredSessionUser()),
      },
    }),
  );
};

export const dispatchTrackedStorageUpdatedEvent = (
  storageKey: string,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (isCompanyScopedBaseKey(storageKey)) {
    dispatchCompanyStorageUpdatedEvent(
      storageKey,
      getScopedStorageKey(storageKey, user),
      user,
    );
    return;
  }

  const baseKey = getCompanyScopedBaseKey(storageKey);
  if (baseKey) {
    dispatchCompanyStorageUpdatedEvent(baseKey, storageKey, user);
    return;
  }

  if ((GLOBAL_STORAGE_KEYS as readonly string[]).includes(storageKey)) {
    dispatchCompanyStorageUpdatedEvent(storageKey, storageKey, user);
  }
};

export const getStoredSessionUser = (): User | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(SESSION_USER_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
};

export const getScopeCompanyId = (user?: Pick<User, 'companyId'> | null) => {
  return user?.companyId || DEFAULT_COMPANY_SCOPE;
};

export const registerStorageSyncHandler = (handler: StorageSyncHandler | null) => {
  storageSyncHandler = handler;
};

export const getScopedStorageKey = (
  key: CompanyScopedStorageKey,
  user?: Pick<User, 'companyId'> | null,
) => {
  return `${COMPANY_SCOPE_PREFIX}:${getScopeCompanyId(user)}:${key}`;
};

export const resolveCompanyScopedKey = (
  key: CompanyScopedStorageKey,
  user?: Pick<User, 'companyId'> | null,
) => getScopedStorageKey(key, user ?? getStoredSessionUser());

const parseStoredJson = <T>(rawValue: string | null, fallback: T) => {
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
};

export const readCompanyScopedValue = <T>(
  key: CompanyScopedStorageKey,
  fallback: T,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const scopedKey = resolveCompanyScopedKey(key, user);
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue) {
    return parseStoredJson(scopedValue, fallback);
  }

  const legacyValue = window.localStorage.getItem(key);
  if (legacyValue) {
    window.localStorage.setItem(scopedKey, legacyValue);
    storageSyncHandler?.(scopedKey, user ?? getStoredSessionUser());
    dispatchTrackedStorageUpdatedEvent(scopedKey, user);
    return parseStoredJson(legacyValue, fallback);
  }

  return fallback;
};

export const writeCompanyScopedValue = <T>(
  key: CompanyScopedStorageKey,
  value: T,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (typeof window === 'undefined') {
    return;
  }

  const scopedKey = resolveCompanyScopedKey(key, user);
  window.localStorage.setItem(scopedKey, JSON.stringify(value));
  storageSyncHandler?.(scopedKey, user ?? getStoredSessionUser());
  dispatchTrackedStorageUpdatedEvent(scopedKey, user);
};

export const isCompanyScopedBaseKey = (key: string): key is CompanyScopedStorageKey =>
  (COMPANY_STORAGE_KEYS as readonly string[]).includes(key);

export const getCompanyScopedBaseKey = (key: string) => {
  const segments = key.split(':');
  if (segments.length < 3 || segments[0] !== COMPANY_SCOPE_PREFIX) {
    return null;
  }

  const baseKey = segments.slice(2).join(':');
  return isCompanyScopedBaseKey(baseKey) ? baseKey : null;
};

export const isKeyTrackedForPersistence = (key: string) =>
  (GLOBAL_STORAGE_KEYS as readonly string[]).includes(key) || getCompanyScopedBaseKey(key) !== null;

export const requestTrackedStorageSync = (key: string, user?: Pick<User, 'companyId'> | null) => {
  if (!isKeyTrackedForPersistence(key)) {
    return;
  }

  storageSyncHandler?.(key, user ?? getStoredSessionUser());
  dispatchTrackedStorageUpdatedEvent(key, user);
};
