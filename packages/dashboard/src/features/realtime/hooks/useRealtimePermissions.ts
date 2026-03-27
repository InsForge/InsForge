import { useQuery } from '@tanstack/react-query';
import { realtimeService, type RealtimePermissionsResponse } from '../services/realtime.service';

export function useRealtimePermissions() {
  const {
    data: permissions,
    isLoading: isLoadingPermissions,
    error: permissionsError,
    refetch: refetchPermissions,
  } = useQuery<RealtimePermissionsResponse>({
    queryKey: ['realtime', 'permissions'],
    queryFn: () => realtimeService.getPermissions(),
    staleTime: 2 * 60 * 1000,
  });

  return {
    permissions,
    isLoadingPermissions,
    permissionsError,
    refetchPermissions,
  };
}
