import { useQuery } from '@tanstack/react-query';
import { advanceService } from '../services/advance.service';

export function useFullMetadata(enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'metadata', 'full'],
    queryFn: () => advanceService.getDatabaseFullMetadata(),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    enabled,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}
