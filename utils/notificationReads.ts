const NOTIFICATION_READS_STORAGE_PREFIX = 'axsys_notification_reads_v1';

const pad = (value: number) => String(value).padStart(2, '0');

export const formatNotificationReadsDay = (date: Date = new Date()) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const buildNotificationReadsStorageKey = (userId: string, day: string) =>
  `${NOTIFICATION_READS_STORAGE_PREFIX}:${userId}:${day}`;

export const mergeReadNotificationIds = (existingIds: string[], nextIds: string[]) =>
  Array.from(new Set([...existingIds, ...nextIds])).sort();

export const computeUnreadNotificationIds = (alertIds: string[], readIds: string[]) => {
  const readSet = new Set(readIds);
  return alertIds.filter((id) => !readSet.has(id));
};
