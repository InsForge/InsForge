import { ConvertedValue } from '#components/datagrid/datagridTypes';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { recordService } from '#features/database/services/record.service';
import { useToast } from '#lib/hooks/useToast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useRecords(tableName: string, schemaName: string = DEFAULT_DATABASE_SCHEMA) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const recordsQueryKeyPrefix = ['records', schemaName, tableName] as const;

  // Hook to fetch table records with pagination, search, and sorting
  const useTableRecords = (
    limit = 10,
    offset = 0,
    searchQuery?: string,
    sortColumns?: { columnKey: string; direction: string }[],
    enabled = true
  ) => {
    return useQuery({
      queryKey: [
        'records',
        schemaName,
        tableName,
        limit,
        offset,
        searchQuery,
        JSON.stringify(sortColumns),
      ],
      queryFn: () =>
        recordService.getTableRecords(
          tableName,
          schemaName,
          limit,
          offset,
          searchQuery,
          sortColumns
        ),
      enabled: enabled && !!tableName,
      staleTime: 30 * 1000,
    });
  };

  // Hook to fetch records with custom query params
  const useRecordsWithQuery = (queryParams: string = '', enabled = true) => {
    return useQuery({
      queryKey: ['records', schemaName, tableName, 'query', queryParams],
      queryFn: () => recordService.getRecords(tableName, schemaName, queryParams),
      enabled: enabled && !!tableName,
      staleTime: 30 * 1000,
    });
  };

  // Hook to fetch a single record by foreign key value
  const useRecordByForeignKey = (columnName: string, value: string, enabled = true) => {
    return useQuery({
      queryKey: ['records', schemaName, tableName, 'foreignKey', columnName, value],
      queryFn: () =>
        recordService.getRecordByForeignKeyValue(tableName, columnName, value, schemaName),
      enabled: enabled && !!tableName && !!columnName && !!value,
      staleTime: 30 * 1000,
    });
  };

  // Mutation to create a single record
  const createRecordMutation = useMutation({
    mutationFn: (data: { [key: string]: ConvertedValue }) =>
      recordService.createRecord(tableName, data, schemaName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordsQueryKeyPrefix });
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
      });
      showToast('Record created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create record';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to create multiple records
  const createRecordsMutation = useMutation({
    mutationFn: (records: { [key: string]: ConvertedValue }[]) =>
      recordService.createRecords(tableName, records, schemaName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordsQueryKeyPrefix });
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
      });
      showToast('Records created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create records';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to update a record
  const updateRecordMutation = useMutation({
    mutationFn: ({
      pkColumn,
      pkValue,
      data,
    }: {
      pkColumn: string;
      pkValue: string;
      data: { [key: string]: ConvertedValue };
    }) => recordService.updateRecord(tableName, pkColumn, pkValue, data, schemaName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordsQueryKeyPrefix });
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
      });
      showToast('Record updated successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update record';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to delete a record
  const deleteRecordsMutation = useMutation({
    mutationFn: (variables: { pkColumn: string; pkValues: string[] }) =>
      recordService.deleteRecords(tableName, variables.pkColumn, variables.pkValues, schemaName),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: recordsQueryKeyPrefix });
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.tableSchema(schemaName, tableName),
      });
      const count = variables.pkValues.length;
      if (count === 1) {
        showToast('Record deleted successfully', 'success');
      } else {
        showToast(`${count} records deleted successfully`, 'success');
      }
    },
    onError: (error: Error, variables) => {
      const count = variables.pkValues.length;
      const recordText = count === 1 ? 'record' : 'records';
      const errorMessage =
        error instanceof Error ? error.message : `Failed to delete ${recordText}`;
      showToast(errorMessage, 'error');
    },
  });

  return {
    // Hooks for fetching
    useTableRecords,
    useRecordsWithQuery,
    useRecordByForeignKey,

    // Loading states
    isCreating: createRecordMutation.isPending,
    isCreatingMultiple: createRecordsMutation.isPending,
    isUpdating: updateRecordMutation.isPending,
    isDeleting: deleteRecordsMutation.isPending,

    // Actions - all using mutateAsync for consistency
    createRecord: createRecordMutation.mutateAsync,
    createRecords: createRecordsMutation.mutateAsync,
    updateRecord: updateRecordMutation.mutateAsync,
    deleteRecords: deleteRecordsMutation.mutateAsync,
  };
}
