import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateDatabaseBackupConfig } from '@insforge/shared-schemas';
import { useToast } from '@insforge/ui';
import { backupService } from '#features/database/services/backup.service';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';

const BACKUP_CONFIG_QUERY_KEY = ['database-backup', 'config'] as const;

/**
 * Scheduled backup configuration. Self-hosting only: the cloud control plane
 * owns backups there and the OSS config endpoint is not mounted. Pass
 * `enabled: false` to keep the query idle while a consumer (e.g. a closed
 * settings dialog) is mounted but inactive.
 */
export function useBackupConfig(options?: { enabled?: boolean }) {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isCloudHostingMode = useIsCloudHostingMode();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: BACKUP_CONFIG_QUERY_KEY,
    queryFn: () => backupService.getBackupConfig(),
    enabled: !isCloudHostingMode && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });

  const updateBackupConfigMutation = useMutation({
    mutationFn: (patch: UpdateDatabaseBackupConfig) => backupService.updateBackupConfig(patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BACKUP_CONFIG_QUERY_KEY });
      showToast(
        t('database.backupSettingsSaved', {
          defaultValue: 'Backup settings saved successfully.',
        }),
        'success'
      );
    },
    onError: (mutationError: Error) => {
      showToast(
        mutationError.message ||
          t('database.failedToSaveBackupSettings', {
            defaultValue: 'Failed to save backup settings.',
          }),
        'error'
      );
    },
  });

  return {
    config: config ?? null,
    isLoading,
    isUpdating: updateBackupConfigMutation.isPending,
    error,
    updateConfig: updateBackupConfigMutation.mutateAsync,
    refetch,
  };
}
