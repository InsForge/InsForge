import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tableService } from '../services/table.service';
import { useToast } from '@/lib/hooks/useToast';
import {
  ColumnSchema,
  GetTableSchemaResponse,
  UpdateTableSchemaRequest,
} from '@insforge/shared-schemas';
import { useMemo } from 'react';

export function useTables() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch all table names
  const {
    data: tables,
    isLoading: isLoadingTables,
    error: tablesError,
    refetch: refetchTables,
  } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tableService.listTables(),
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Query to fetch all table schemas
  const {
    data: allSchemas,
    isLoading: isLoadingSchemas,
    error: schemasError,
    refetch: refetchAllSchemas,
  } = useQuery({
    queryKey: ['tables', 'schemas'],
    queryFn: () => tableService.getAllTableSchemas(),
    staleTime: 2 * 60 * 1000,
  });

  // Query to fetch a specific table schema
  const useTableSchema = (tableName: string, enabled = true) => {
    return useQuery({
      queryKey: ['tables', tableName, 'schema'],
      queryFn: () => tableService.getTableSchema(tableName),
      enabled: enabled && !!tableName,
      staleTime: 2 * 60 * 1000,
    });
  };

  // Mutation to create a table
  const createTableMutation = useMutation({
    mutationFn: ({ tableName, columns }: { tableName: string; columns: ColumnSchema[] }) =>
      tableService.createTable(tableName, columns),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['tables', 'schemas'] });
      showToast('Table created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create table';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to delete a table
  const deleteTableMutation = useMutation({
    mutationFn: (tableName: string) => tableService.deleteTable(tableName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['tables', 'schemas'] });
      showToast('Table deleted successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete table';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to update table schema
  const updateTableSchemaMutation = useMutation({
    mutationFn: ({
      tableName,
      operations,
    }: {
      tableName: string;
      operations: UpdateTableSchemaRequest;
    }) => tableService.updateTableSchema(tableName, operations),
    onSuccess: (_, { tableName }) => {
      void queryClient.invalidateQueries({ queryKey: ['tables', 'schemas'] });
      void queryClient.invalidateQueries({ queryKey: ['tables', tableName, 'schema'] });
      showToast('Table schema updated successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update table schema';
      showToast(errorMessage, 'error');
    },
  });

  return {
    // Data
    tables: tables || [],
    allSchemas: useMemo(
      () => allSchemas?.filter((schema) => schema.tableName !== 'users') || [],
      [allSchemas]
    ),
    tablesCount: tables?.length || 0,

    // Loading states
    isLoadingTables,
    isLoadingSchemas,
    isCreating: createTableMutation.isPending,
    isDeleting: deleteTableMutation.isPending,
    isUpdating: updateTableSchemaMutation.isPending,

    // Errors
    tablesError,
    schemasError,

    // Actions
    createTable: createTableMutation.mutate,
    deleteTable: deleteTableMutation.mutate,
    updateTableSchema: updateTableSchemaMutation.mutate,
    refetchTables,
    refetchAllSchemas,

    // Helpers
    useTableSchema,
    getSchemaByTableName: (tableName: string): GetTableSchemaResponse | undefined => {
      return allSchemas?.find((schema) => schema.tableName === tableName);
    },
  };
}
