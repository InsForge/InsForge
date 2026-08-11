import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditService } from '#features/logs/services/audit.service';
import { GetAuditLogsRequest } from '@insforge/shared-schemas';
import { useToast } from '@insforge/ui';

export const useAuditLogs = (filters?: Partial<GetAuditLogsRequest>) => {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => auditService.getAuditLogs({ limit: 100, offset: 0, ...filters }),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useAuditLogStats = (days = 7) => {
  return useQuery({
    queryKey: ['audit-log-stats', days],
    queryFn: () => auditService.getAuditLogStats(days),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

export const useClearAuditLogs = () => {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (daysToKeep?: number) => auditService.clearAuditLogs(daysToKeep),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-log-stats'] });
      showToast(
        t('logs.clearedAuditLogs', {
          count: data.deleted,
          defaultValue: 'Cleared {{count}} audit logs',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        t('logs.failedToClearAuditLogs', {
          error: error.message,
          defaultValue: 'Failed to clear audit logs: {{error}}',
        }),
        'error'
      );
    },
  });
};
