import {
  getCompanyScopedBaseKey,
  getScopeCompanyId,
  getScopedStorageKey,
  isCompanyScopedBaseKey,
} from '../services/storageScope.ts';
import type { User } from '../types.ts';

export type CompanyStorageUpdateDetail = {
  key?: string;
  scopedKey?: string;
  companyId?: string;
};

const expandTrackedKey = (
  key: string,
  user?: Pick<User, 'companyId'> | null,
) => {
  if (isCompanyScopedBaseKey(key)) {
    return [key, getScopedStorageKey(key, user)];
  }

  const baseKey = getCompanyScopedBaseKey(key);
  if (baseKey) {
    return [baseKey, key];
  }

  return [key];
};

export const buildTrackedStorageKeys = (
  trackedKeys: readonly string[],
  user?: Pick<User, 'companyId'> | null,
) => {
  return new Set(
    trackedKeys.flatMap((key) => expandTrackedKey(key, user)),
  );
};

export const matchesCompanyStorageUpdate = ({
  detail,
  trackedKeys,
  companyId,
}: {
  detail?: CompanyStorageUpdateDetail | null;
  trackedKeys: Iterable<string>;
  companyId?: string | null;
}) => {
  if (!detail) {
    return false;
  }

  const resolvedCompanyId = getScopeCompanyId(companyId ? { companyId } : null);
  const eventCompanyId = getScopeCompanyId(detail.companyId ? { companyId: detail.companyId } : null);

  if (eventCompanyId !== resolvedCompanyId) {
    return false;
  }

  const trackedKeySet = trackedKeys instanceof Set ? trackedKeys : new Set(trackedKeys);

  return (
    (typeof detail.key === 'string' && trackedKeySet.has(detail.key))
    || (typeof detail.scopedKey === 'string' && trackedKeySet.has(detail.scopedKey))
  );
};
