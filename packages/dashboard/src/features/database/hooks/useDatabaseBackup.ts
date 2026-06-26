import { useQuery } from '@tanstack/react-query';
import type { DatabaseBackup } from '@insforge/shared-schemas';
import { backupService } from '#features/database/services/backup.service';
import { useDashboardHost, useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import type { DashboardBackup, DashboardBackupInfo, DashboardInstanceInfo } from '#types';

function toDashboardBackup(backup: DatabaseBackup): DashboardBackup {
  return {
    id: backup.id,
    name: backup.name,
    triggerSource: backup.triggerSource,
    status: backup.status,
    sizeBytes: backup.sizeBytes,
    errorMessage: backup.errorMessage,
    createdAt: backup.createdAt,
    createdBy: backup.createdBy,
  };
}

export function hasRunningBackup(info: DashboardBackupInfo | null | undefined): boolean {
  if (!info) {
    return false;
  }
  return [...info.manualBackups, ...info.scheduledBackups].some((b) => b.status === 'running');
}

async function fetchSelfHostingBackupInfo(): Promise<DashboardBackupInfo> {
  const { backups } = await backupService.listBackups();

  return {
    manualBackups: backups.filter((b) => b.triggerSource === 'manual').map(toDashboardBackup),
    scheduledBackups: backups.filter((b) => b.triggerSource === 'scheduled').map(toDashboardBackup),
  };
}

export function useDatabaseBackupInfo() {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();
  const onRequestBackupInfo = host.mode === 'cloud-hosting' ? host.onRequestBackupInfo : undefined;
  const isBackupInfoQueryEnabled = !isCloudHostingMode || !!onRequestBackupInfo;

  const query = useQuery({
    queryKey: ['database-backup', 'backup-info'],
    queryFn: (): Promise<DashboardBackupInfo | null> => {
      if (!isCloudHostingMode) {
        return fetchSelfHostingBackupInfo();
      }

      if (!onRequestBackupInfo) {
        return Promise.resolve(null);
      }

      return onRequestBackupInfo();
    },
    enabled: isBackupInfoQueryEnabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (q) => (hasRunningBackup(q.state.data) ? 5000 : false),
  });

  return {
    backupInfo: isBackupInfoQueryEnabled ? (query.data ?? null) : null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Mode-aware backup mutations: cloud-hosting delegates to the host callbacks
 * (the cloud control plane owns backups there), self-hosting calls the OSS
 * backend directly.
 */
export function useDatabaseBackupActions() {
  const host = useDashboardHost();
  const isCloudHostingMode = useIsCloudHostingMode();

  if (!isCloudHostingMode) {
    return {
      createBackup: async (name: string) => {
        await backupService.createBackup(name.trim() ? name.trim() : undefined);
      },
      renameBackup: async (backupId: string, name: string | null) => {
        await backupService.renameBackup(backupId, name);
      },
      deleteBackup: async (backupId: string) => {
        await backupService.deleteBackup(backupId);
      },
      restoreBackup: async (backupId: string) => {
        await backupService.restoreBackup(backupId);
      },
    };
  }

  return {
    createBackup: host.onCreateBackup,
    renameBackup: host.onRenameBackup,
    deleteBackup: host.onDeleteBackup,
    restoreBackup: host.onRestoreBackup,
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
