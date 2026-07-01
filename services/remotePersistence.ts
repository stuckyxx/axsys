import type { User } from '../types.ts';
import { supabase } from './supabaseClient';
import { mergeRemoteBootstrapCollection, shouldMergeRemoteBootstrapKey } from '../utils/bootstrapMerge.ts';
import {
  COMPANY_STORAGE_KEYS,
  dispatchTrackedStorageUpdatedEvent,
  GLOBAL_STORAGE_KEYS,
  getCompanyScopedBaseKey,
  getScopedStorageKey,
  getStoredSessionUser,
  isCompanyScopedBaseKey,
  isKeyTrackedForPersistence,
  registerStorageSyncHandler,
} from './storageScope';
import { getLocalStorageKeysForRemoteStateRow, getRelevantRemoteStateKeys } from '../utils/remoteStateSync.ts';

const TABLE_NAME = 'app_state';

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let initializedScope: string | null = null;
let syncing = false;
let hooksInstalled = false;
let originalSetItem: Storage['setItem'] | null = null;
let originalRemoveItem: Storage['removeItem'] | null = null;
let activeSessionUser: Pick<User, 'companyId'> | null = null;
let remoteStateChannel: ReturnType<typeof supabase.channel> | null = null;
const ANONYMOUS_SCOPE = '__anonymous__';

const serialize = (value: unknown) => JSON.stringify(value);

const getScopedRowKey = (baseKey: string, sessionUser: Pick<User, 'companyId'> | null) =>
  isCompanyScopedBaseKey(baseKey) ? getScopedStorageKey(baseKey, sessionUser) : baseKey;

const syncKeyToRemote = async (
  storage: LocalStorageLike,
  storageKey: string,
  sessionUser: Pick<User, 'companyId'> | null,
) => {
  if (!isKeyTrackedForPersistence(storageKey)) return;

  const rawValue = storage.getItem(storageKey);
  const parsedValue = rawValue ? JSON.parse(rawValue) : null;

  const { error } = await supabase.from(TABLE_NAME).upsert(
    {
      key: storageKey,
      value: parsedValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

  if (error) {
    console.error(`Failed to sync "${storageKey}" to Supabase`, error);
  }

  const legacyBaseKey = getCompanyScopedBaseKey(storageKey);
  if (!legacyBaseKey || !parsedValue) {
    return;
  }

  const legacyRowKey = legacyBaseKey;
  const existingLegacyValue = storage.getItem(legacyRowKey);
  if (existingLegacyValue) {
    return;
  }

  const scopedLegacyValue = storage.getItem(getScopedRowKey(legacyBaseKey, sessionUser));
  if (scopedLegacyValue) {
    storage.setItem(legacyRowKey, scopedLegacyValue);
  }
};

const installStorageHooks = (storage: Storage) => {
  if (hooksInstalled && originalSetItem && originalRemoveItem) {
    return;
  }

  originalSetItem = storage.setItem.bind(storage);
  originalRemoveItem = storage.removeItem.bind(storage);

  storage.setItem = ((key: string, value: string) => {
    originalSetItem?.(key, value);
    if (!syncing) {
      void syncKeyToRemote(storage, key, activeSessionUser);
    }
  }) as Storage['setItem'];

  storage.removeItem = ((key: string) => {
    originalRemoveItem?.(key);
    if (!syncing && isKeyTrackedForPersistence(key)) {
      void syncKeyToRemote(storage, key, activeSessionUser);
    }
  }) as Storage['removeItem'];

  hooksInstalled = true;
};

const installTrackedStorageSyncHandler = () => {
  registerStorageSyncHandler((storageKey, sessionUser) => {
    if (typeof window === 'undefined' || syncing) {
      return;
    }

    const storage = window.localStorage;
    const resolvedUser = sessionUser ?? activeSessionUser ?? getStoredSessionUser();
    void syncKeyToRemote(storage, storageKey, resolvedUser);
  });
};

const mirrorRemoteRowToLocalStorage = (
  storage: Storage,
  storageKey: string,
  value: unknown,
  sessionUser: Pick<User, 'companyId'> | null,
) => {
  const localKeys = getLocalStorageKeysForRemoteStateRow(storageKey, sessionUser);
  if (localKeys.length === 0) {
    return;
  }

  const baseKey = getCompanyScopedBaseKey(storageKey) ?? (isCompanyScopedBaseKey(storageKey) ? storageKey : null);

  for (const localKey of localKeys) {
    if (value === null) {
      storage.removeItem(localKey);
    } else {
      storage.setItem(localKey, serialize(value));
    }
  }

  if (baseKey || (GLOBAL_STORAGE_KEYS as readonly string[]).includes(storageKey)) {
    dispatchTrackedStorageUpdatedEvent(storageKey, sessionUser);
  }
};

const installRemoteStateSubscription = (sessionUser: Pick<User, 'companyId'> | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  const relevantKeys = new Set(getRelevantRemoteStateKeys(sessionUser));

  if (remoteStateChannel) {
    void supabase.removeChannel(remoteStateChannel);
    remoteStateChannel = null;
  }

  remoteStateChannel = supabase
    .channel(`app-state-sync:${sessionUser?.companyId || 'global'}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABLE_NAME,
      },
      (payload) => {
        const row = payload.new && typeof payload.new === 'object' ? payload.new : payload.old;
        const storageKey = typeof row?.key === 'string' ? row.key : null;

        if (!storageKey || !relevantKeys.has(storageKey)) {
          return;
        }

        const value = payload.eventType === 'DELETE' ? null : row.value;
        syncing = true;
        try {
          mirrorRemoteRowToLocalStorage(window.localStorage, storageKey, value, sessionUser);
        } finally {
          syncing = false;
        }
      },
    )
    .subscribe();
};

const migrateLegacyLocalData = (storage: Storage, sessionUser: Pick<User, 'companyId'> | null) => {
  for (const baseKey of COMPANY_STORAGE_KEYS) {
    const scopedKey = getScopedStorageKey(baseKey, sessionUser);
    const scopedValue = storage.getItem(scopedKey);
    const legacyValue = storage.getItem(baseKey);

    if (!scopedValue && legacyValue) {
      storage.setItem(scopedKey, legacyValue);
    }
  }
};

export const initializeRemotePersistence = async (sessionUser?: Pick<User, 'companyId'> | null) => {
  if (typeof window === 'undefined') return;

  const storage = window.localStorage;
  const resolvedUser = sessionUser ?? getStoredSessionUser();
  const scopeCompanyId = resolvedUser?.companyId || 'global';
  const scopeMarker = resolvedUser ? scopeCompanyId : ANONYMOUS_SCOPE;
  activeSessionUser = resolvedUser;
  installTrackedStorageSyncHandler();
  installRemoteStateSubscription(resolvedUser);

  if (initializedScope === scopeMarker) {
    return;
  }

  if (resolvedUser) {
    migrateLegacyLocalData(storage, resolvedUser);
  }

  const globalKeys = [...GLOBAL_STORAGE_KEYS];
  const scopedKeys = resolvedUser
    ? COMPANY_STORAGE_KEYS.map((key) => getScopedStorageKey(key, resolvedUser))
    : [];
  const trackedKeys = [...globalKeys, ...scopedKeys];
  const legacyCompanyKeys = resolvedUser ? [...COMPANY_STORAGE_KEYS] : [];

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('key, value')
    .in('key', [...trackedKeys, ...legacyCompanyKeys]);

  if (error) {
    console.error('Failed to bootstrap Supabase state', error);
  } else {
    const remoteMap = new Map<string, unknown>((data || []).map((row) => [row.key as string, row.value]));

    syncing = true;
    try {
      for (const key of trackedKeys) {
        if (remoteMap.has(key)) {
          const remoteValue = remoteMap.get(key);
          const mergedBootstrapValue = shouldMergeRemoteBootstrapKey(key)
            ? mergeRemoteBootstrapCollection(remoteValue, storage.getItem(key))
            : null;

          storage.setItem(
            key,
            serialize(mergedBootstrapValue ? mergedBootstrapValue.mergedValue : remoteValue),
          );
          dispatchTrackedStorageUpdatedEvent(key, resolvedUser);

          if (mergedBootstrapValue?.shouldSync) {
            await syncKeyToRemote(storage, key, resolvedUser);
          }

          continue;
        }

        const legacyBaseKey = getCompanyScopedBaseKey(key);
        if (legacyBaseKey && remoteMap.has(legacyBaseKey)) {
          const legacyValue = remoteMap.get(legacyBaseKey);
          storage.setItem(key, serialize(legacyValue));
          dispatchTrackedStorageUpdatedEvent(key, resolvedUser);
          await syncKeyToRemote(storage, key, resolvedUser);
          continue;
        }

        const localValue = storage.getItem(key);
        if (localValue) {
          await syncKeyToRemote(storage, key, resolvedUser);
        }
      }
    } finally {
      syncing = false;
    }
  }

  installStorageHooks(storage);
  initializedScope = scopeMarker;
};

export const resetRemotePersistenceScope = () => {
  initializedScope = null;
  syncing = false;
  activeSessionUser = null;
  if (remoteStateChannel) {
    void supabase.removeChannel(remoteStateChannel);
    remoteStateChannel = null;
  }
};
