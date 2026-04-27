import { useQuery } from '@tanstack/react-query';
import { useDashboardHost } from '../../../lib/config/DashboardHostContext';
import type { DashboardBackup } from '../../../types';

export const LAST_BACKUP_QUERY_KEY = ['dashboard-last-backup'] as const;

export function useLastBackup() {
  const host = useDashboardHost();
  const fetcher = host.onRequestBackupInfo;

  return useQuery<DashboardBackup | null, Error>({
    queryKey: LAST_BACKUP_QUERY_KEY,
    queryFn: async () => {
      if (!fetcher) {
        return null;
      }
      const info = await fetcher();
      const all = [...info.manualBackups, ...info.scheduledBackups];
      if (all.length === 0) {
        return null;
      }
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    },
    enabled: !!fetcher,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
