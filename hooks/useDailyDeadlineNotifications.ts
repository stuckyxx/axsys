import React from 'react';

import type { User } from '../types.ts';
import {
  buildNotificationReadsStorageKey,
  computeUnreadNotificationIds,
  formatNotificationReadsDay,
  mergeReadNotificationIds,
} from '../utils/notificationReads.ts';
import { useDeadlineAlerts } from './useDeadlineAlerts.ts';

const getMillisecondsUntilNextDay = () => {
  const now = new Date();
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 0);
  return nextDay.getTime() - now.getTime();
};

const parseReadNotificationIds = (rawValue: string | null) => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

export const useDailyDeadlineNotifications = (user?: Pick<User, 'id' | 'companyId'> | null) => {
  const { alerts, summary } = useDeadlineAlerts(user);
  const [dayKey, setDayKey] = React.useState(() => formatNotificationReadsDay());
  const [readIds, setReadIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDayKey(formatNotificationReadsDay());
    }, getMillisecondsUntilNextDay());

    return () => window.clearTimeout(timeout);
  }, [dayKey]);

  const storageKey = React.useMemo(() => {
    if (!user?.id) {
      return null;
    }

    return buildNotificationReadsStorageKey(user.id, dayKey);
  }, [dayKey, user?.id]);

  React.useEffect(() => {
    if (!storageKey) {
      setReadIds([]);
      return;
    }

    setReadIds(parseReadNotificationIds(window.localStorage.getItem(storageKey)));
  }, [storageKey]);

  const unreadIds = React.useMemo(
    () => computeUnreadNotificationIds(alerts.map((alert) => alert.id), readIds),
    [alerts, readIds],
  );

  const unreadIdsSet = React.useMemo(() => new Set(unreadIds), [unreadIds]);

  const unreadCount = unreadIds.length;

  const markAlertsAsReadToday = React.useCallback(
    (alertIds: string[]) => {
      if (!storageKey || alertIds.length === 0) {
        return;
      }

      setReadIds((current) => {
        const next = mergeReadNotificationIds(current, alertIds);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey],
  );

  return {
    alerts,
    summary,
    unreadCount,
    unreadIdsSet,
    markAllAsReadToday: () => markAlertsAsReadToday(alerts.map((alert) => alert.id)),
  };
};
