import { useQuery } from '@tanstack/react-query';
import { databaseService } from '../services/database.service';

export function useFunctions(enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'functions'],
    queryFn: () => databaseService.getFunctions(),
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

export function useIndexes(enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'indexes'],
    queryFn: () => databaseService.getIndexes(),
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

export function usePolicies(enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'policies'],
    queryFn: () => databaseService.getPolicies(),
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

export function useTriggers(enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'triggers'],
    queryFn: () => databaseService.getTriggers(),
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
