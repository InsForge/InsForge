import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditService } from '#features/logs/services/audit.service';
import { GetAuditLogsRequest } from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';

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
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (daysToKeep?: number) => auditService.clearAuditLogs(daysToKeep),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-log-stats'] });
      showToast(`Cleared ${data.deleted} audit logs`, 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to clear audit logs: ${error.message}`, 'error');
    },
  });
};
