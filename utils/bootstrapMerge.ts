import { COMPANY_STORAGE_KEYS, GLOBAL_STORAGE_KEYS, getCompanyScopedBaseKey } from '../services/storageScope.ts';

interface IdentifiableRecord {
  id: string;
  [key: string]: unknown;
}

const isIdentifiableRecord = (value: unknown): value is IdentifiableRecord =>
  !!value && typeof value === 'object' && typeof (value as IdentifiableRecord).id === 'string';

const toIdentifiableRecordArray = (value: unknown): IdentifiableRecord[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.every(isIdentifiableRecord) ? value : null;
};

const parseLocalRecordArray = (rawValue: string | null) => {
  if (!rawValue) {
    return null;
  }

  try {
    return toIdentifiableRecordArray(JSON.parse(rawValue));
  } catch {
    return null;
  }
};

export const mergeRecordArraysById = <T extends IdentifiableRecord>(remote: T[], local: T[]) => {
  const merged = new Map<string, T>();

  for (const record of remote) {
    merged.set(record.id, record);
  }

  for (const record of local) {
    merged.set(record.id, record);
  }

  return Array.from(merged.values());
};

export const mergeRemoteBootstrapCollection = (
  remoteValue: unknown,
  localRawValue: string | null,
) => {
  const remoteRecords = toIdentifiableRecordArray(remoteValue);
  const localRecords = parseLocalRecordArray(localRawValue);

  if (!remoteRecords || !localRecords || localRecords.length === 0) {
    return null;
  }

  const mergedValue = mergeRecordArraysById(remoteRecords, localRecords);

  return {
    mergedValue,
    shouldSync: JSON.stringify(mergedValue) !== JSON.stringify(remoteRecords),
  };
};

const BOOTSTRAP_MERGE_BASE_KEYS = new Set<string>([
  ...GLOBAL_STORAGE_KEYS,
  ...COMPANY_STORAGE_KEYS,
]);

export const shouldMergeRemoteBootstrapKey = (storageKey: string) => {
  if (BOOTSTRAP_MERGE_BASE_KEYS.has(storageKey)) {
    return true;
  }

  const companyScopedBaseKey = getCompanyScopedBaseKey(storageKey);
  return companyScopedBaseKey ? BOOTSTRAP_MERGE_BASE_KEYS.has(companyScopedBaseKey) : false;
};
