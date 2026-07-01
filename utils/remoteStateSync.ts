import type { User } from '../types.ts';
import {
  COMPANY_STORAGE_KEYS,
  GLOBAL_STORAGE_KEYS,
  getScopedStorageKey,
  isCompanyScopedBaseKey,
  isKeyTrackedForPersistence,
} from '../services/storageScope.ts';

export const getRelevantRemoteStateKeys = (user?: Pick<User, 'companyId'> | null) => {
  if (!user?.companyId) {
    return [...GLOBAL_STORAGE_KEYS];
  }

  return [
    ...GLOBAL_STORAGE_KEYS,
    ...COMPANY_STORAGE_KEYS.map((key) => getScopedStorageKey(key, user)),
    ...COMPANY_STORAGE_KEYS,
  ];
};

export const getLocalStorageKeysForRemoteStateRow = (
  remoteKey: string,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (isCompanyScopedBaseKey(remoteKey) && user?.companyId) {
    return [remoteKey, getScopedStorageKey(remoteKey, user)];
  }

  if (!isKeyTrackedForPersistence(remoteKey)) {
    return [];
  }

  return [remoteKey];
};
