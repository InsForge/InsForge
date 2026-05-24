import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { databaseService } from '#features/database/services/database.service';
import { databaseSchemaQueryKeys } from '#features/database/queryKeys';

export function useDatabaseSchemas(enabled = true) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: databaseSchemaQueryKeys.allSchemas,
    queryFn: () => databaseService.getSchemas(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data,
    schemas: data?.schemas ?? [],
    isLoading,
    error,
    refetch,
  };
}

export function useFunctions(schemaName: string, enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'functions', schemaName],
    queryFn: () => databaseService.getFunctions(schemaName),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}

export function useIndexes(schemaName: string, enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'indexes', schemaName],
    queryFn: () => databaseService.getIndexes(schemaName),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}

export function usePolicies(schemaName: string, enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'policies', schemaName],
    queryFn: () => databaseService.getPolicies(schemaName),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}

export function useTriggers(schemaName: string, enabled = false) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['database', 'triggers', schemaName],
    queryFn: () => databaseService.getTriggers(schemaName),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}

export function useIndexMutations(schemaName: string) {
  const queryClient = useQueryClient();
  const QUERY_KEY = ['database', 'indexes', schemaName];

  const createMutation = useMutation({
    mutationFn: (args: {
      tableName: string;
      indexName: string;
      columns: string[];
      method?: string;
      unique?: boolean;
      concurrently?: boolean;
    }) =>
      databaseService.createIndex(schemaName, args.tableName, args.indexName, args.columns, {
        method: args.method,
        unique: args.unique,
        concurrently: args.concurrently,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const dropMutation = useMutation({
    mutationFn: (indexName: string) => databaseService.dropIndex(schemaName, indexName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    createIndex: createMutation.mutateAsync,
    dropIndex: dropMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDropping: dropMutation.isPending,
  };
}
