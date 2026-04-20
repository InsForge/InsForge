import { useQuery } from '@tanstack/react-query';
import { useDashboardHost, useIsCloudHostingMode } from '../../../lib/config/DashboardHostContext';
import type { DashboardBackupInfo, DashboardInstanceInfo } from '../../../types';

export function useDatabaseBackupInfo() {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestBackupInfo = host.mode === 'cloud-hosting' ? host.onRequestBackupInfo : undefined;

  const query = useQuery({
    queryKey: ['database-backup', 'backup-info'],
    queryFn: async (): Promise<DashboardBackupInfo | null> => {
      if (!onRequestBackupInfo) {
        return null;
      }

      return onRequestBackupInfo();
    },
    enabled: isCloudHostingMode && !!onRequestBackupInfo,
    staleTime: 5 * 60 * 1000,
  });

  return {
    backupInfo: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useDatabaseBackupInstanceInfo() {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestInstanceInfo =
    host.mode === 'cloud-hosting' ? host.onRequestInstanceInfo : undefined;

  const query = useQuery({
    queryKey: ['database-backup', 'instance-info'],
    queryFn: async (): Promise<DashboardInstanceInfo | null> => {
      if (!onRequestInstanceInfo) {
        return null;
      }

      return onRequestInstanceInfo();
    },
    enabled: isCloudHostingMode && !!onRequestInstanceInfo,
    staleTime: 5 * 60 * 1000,
  });

  return {
    instanceInfo: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
