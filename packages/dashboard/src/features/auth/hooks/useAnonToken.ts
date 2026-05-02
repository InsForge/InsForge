import { useQuery } from '@tanstack/react-query';
import { anonTokenService } from '#features/auth/services/anonToken.service';

interface UseAnonTokenOptions {
  enabled?: boolean;
}

export function useAnonToken(options: UseAnonTokenOptions = {}) {
  const { enabled = true } = options;

  const {
    data: tokenData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['anon-token'],
    queryFn: () => anonTokenService.generateAnonToken(),
    enabled,
    staleTime: 30 * 60 * 1000, // Cache for 30 minutes since token never expires
  });

  return {
    accessToken: tokenData?.accessToken,
    message: tokenData?.message,
    isLoading,
    error,
    refetch,
  };
}
