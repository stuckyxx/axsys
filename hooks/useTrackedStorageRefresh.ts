import React from 'react';

import { COMPANY_STORAGE_UPDATED_EVENT } from '../services/storageScope.ts';
import type { User } from '../types.ts';
import {
  buildTrackedStorageKeys,
  matchesCompanyStorageUpdate,
  type CompanyStorageUpdateDetail,
} from '../utils/companyStorageEvents.ts';

type RefreshOptions = {
  trackedKeys: readonly string[];
  user?: Pick<User, 'companyId'> | null;
  refresh: (preferRemote: boolean) => void | Promise<void>;
};

export const useTrackedStorageRefresh = ({
  trackedKeys,
  user,
  refresh,
}: RefreshOptions) => {
  const refreshRef = React.useRef(refresh);

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  React.useEffect(() => {
    const resolvedTrackedKeys = buildTrackedStorageKeys(trackedKeys, user);

    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        void refreshRef.current(true);
      }
    };

    const handleFocusSync = () => {
      void refreshRef.current(true);
    };

    const handleCompanyStorageSync = (event: Event) => {
      const detail = (event as CustomEvent<CompanyStorageUpdateDetail>).detail;

      if (!matchesCompanyStorageUpdate({
        detail,
        trackedKeys: resolvedTrackedKeys,
        companyId: user?.companyId,
      })) {
        return;
      }

      void refreshRef.current(false);
    };

    window.addEventListener('focus', handleFocusSync);
    window.addEventListener(COMPANY_STORAGE_UPDATED_EVENT, handleCompanyStorageSync as EventListener);
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      window.removeEventListener('focus', handleFocusSync);
      window.removeEventListener(COMPANY_STORAGE_UPDATED_EVENT, handleCompanyStorageSync as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
  }, [trackedKeys, user]);
};
