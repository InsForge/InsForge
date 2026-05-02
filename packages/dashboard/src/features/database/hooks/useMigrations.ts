import { useQuery } from '@tanstack/react-query';
import { migrationService } from '#features/database/services/migration.service';

export function useMigrations(enabled = false) {
  const query = useQuery({
    queryKey: ['database', 'migrations'],
    queryFn: () => migrationService.listMigrations(),
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
