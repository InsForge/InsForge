import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMigrationRequest } from '@insforge/shared-schemas';
import { migrationService } from '../services/migration.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useMigrations(enabled = false) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const query = useQuery({
    queryKey: ['database', 'migrations'],
    queryFn: () => migrationService.listMigrations(),
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateMigrationRequest) => migrationService.createMigration(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['database', 'migrations'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['database', 'indexes'] }),
        queryClient.invalidateQueries({ queryKey: ['database', 'functions'] }),
        queryClient.invalidateQueries({ queryKey: ['database', 'policies'] }),
        queryClient.invalidateQueries({ queryKey: ['database', 'triggers'] }),
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['metadata', 'full'] }),
      ]);
      showToast('Migration executed successfully', 'success');
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createMigration: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
