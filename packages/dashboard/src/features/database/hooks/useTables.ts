import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import { tableService } from '#features/database/services/table.service';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { useToast } from '#lib/hooks/useToast';
import {
  ColumnSchema,
  GetTableSchemaResponse,
  UpdateTableSchemaRequest,
} from '@insforge/shared-schemas';

export function useTables(schemaName: string = DEFAULT_DATABASE_SCHEMA) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch all table names
  const {
    data: tables,
    isLoading: isLoadingTables,
    error: tablesError,
    refetch: refetchTables,
  } = useQuery({
    queryKey: databaseTableQueryKeys.tables(schemaName),
    queryFn: () => tableService.listTables(schemaName),
    staleTime: 2 * 60 * 1000,
  });

  // Query to fetch a specific table schema (cached per table)
  const useTableSchema = (
    tableName: string,
    tableSchemaName: string = schemaName,
    enabled = true
  ) => {
    return useQuery({
      queryKey: databaseTableQueryKeys.tableSchema(tableSchemaName, tableName),
      queryFn: () => tableService.getTableSchema(tableName, tableSchemaName),
      enabled: enabled && !!tableName,
      staleTime: 2 * 60 * 1000,
    });
  };

  // Mutation to create a table
  const createTableMutation = useMutation({
    mutationFn: ({ tableName, columns }: { tableName: string; columns: ColumnSchema[] }) =>
      tableService.createTable(schemaName, tableName, columns),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: databaseTableQueryKeys.tables(schemaName) });
      showToast('Table created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create table';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to delete a table
  const deleteTableMutation = useMutation({
    mutationFn: (tableName: string) => tableService.deleteTable(tableName, schemaName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: databaseTableQueryKeys.tables(schemaName) });
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
    }) => tableService.updateTableSchema(tableName, operations, schemaName),
    onSuccess: (_, { tableName }) => {
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
      });
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
    tablesCount: tables?.length || 0,

    // Loading states
    isLoadingTables,
    isCreating: createTableMutation.isPending,
    isDeleting: deleteTableMutation.isPending,
    isUpdating: updateTableSchemaMutation.isPending,

    // Errors
    tablesError,

    // Actions
    createTable: createTableMutation.mutate,
    deleteTable: deleteTableMutation.mutate,
    updateTableSchema: updateTableSchemaMutation.mutate,
    refetchTables,

    // Helpers
    useTableSchema,
  };
}

/**
 * Hook to fetch all table schemas on demand.
 * Use this only when you need ALL schemas (e.g., for visualizations).
 * For individual tables, use useTables().useTableSchema() instead.
 */
export function useAllTableSchemas(schemaName: string = DEFAULT_DATABASE_SCHEMA, enabled = true) {
  const { tables, isLoadingTables } = useTables(schemaName);

  const { allSchemas, isLoadingSchemas } = useQueries({
    queries: enabled
      ? tables.map((tableName) => ({
          queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
          queryFn: () => tableService.getTableSchema(tableName, schemaName),
          staleTime: 2 * 60 * 1000,
        }))
      : [],
    combine: (results) => ({
      allSchemas: results.filter((r) => r.data).map((r) => r.data as GetTableSchemaResponse),
      isLoadingSchemas: results.some((r) => r.isLoading),
    }),
  });

  return {
    allSchemas,
    isLoading: isLoadingTables || isLoadingSchemas,
  };
}
