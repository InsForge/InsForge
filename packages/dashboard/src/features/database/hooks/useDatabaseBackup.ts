import { useQuery } from '@tanstack/react-query';
import { useDashboardHost, useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import type { DashboardBackupInfo, DashboardInstanceInfo } from '#types';

export function useDatabaseBackupInfo() {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestBackupInfo = host.mode === 'cloud-hosting' ? host.onRequestBackupInfo : undefined;
  const isBackupInfoQueryEnabled = isCloudHostingMode && !!onRequestBackupInfo;

  const query = useQuery({
    queryKey: ['database-backup', 'backup-info'],
    queryFn: (): Promise<DashboardBackupInfo | null> => {
      if (!onRequestBackupInfo) {
        return Promise.resolve(null);
      }

      return onRequestBackupInfo();
    },
    enabled: isBackupInfoQueryEnabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    backupInfo: isBackupInfoQueryEnabled ? (query.data ?? null) : null,
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
  const isInstanceInfoQueryEnabled = isCloudHostingMode && !!onRequestInstanceInfo;

  const query = useQuery({
    queryKey: ['database-backup', 'instance-info'],
    queryFn: (): Promise<DashboardInstanceInfo | null> => {
      if (!onRequestInstanceInfo) {
        return Promise.resolve(null);
      }

      return onRequestInstanceInfo();
    },
    enabled: isInstanceInfoQueryEnabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    instanceInfo: isInstanceInfoQueryEnabled ? (query.data ?? null) : null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
