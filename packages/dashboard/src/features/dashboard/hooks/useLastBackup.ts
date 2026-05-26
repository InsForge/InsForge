import { useQuery } from '@tanstack/react-query';
import { useDashboardHost, useDashboardProject } from '#lib/config/DashboardHostContext';
import type { DashboardBackup } from '#types';

export const LAST_BACKUP_QUERY_KEY = ['dashboard-last-backup'] as const;

export function useLastBackup() {
  const host = useDashboardHost();
  const project = useDashboardProject();
  const fetcher = host.onRequestBackupInfo;

  return useQuery<DashboardBackup | null, Error>({
    queryKey: [...LAST_BACKUP_QUERY_KEY, project?.id],
    queryFn: async () => {
      if (!fetcher) {
        return null;
      }
      const info = await fetcher();
      const all = [...info.manualBackups, ...info.scheduledBackups];
      if (all.length === 0) {
        return null;
      }
      const toEpoch = (iso: string) => {
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? -Infinity : t;
      };
      return all.sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt))[0];
    },
    enabled: !!fetcher,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
