import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recordService } from '../services/record.service';
import { useToast } from '@/lib/hooks/useToast';
import { ConvertedValue } from '@/components/datagrid/datagridTypes';

export function useRecords(tableName: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Hook to fetch table records with pagination, search, and sorting
  const useTableRecords = (
    limit = 10,
    offset = 0,
    searchQuery?: string,
    sortColumns?: { columnKey: string; direction: string }[],
    enabled = true
  ) => {
    return useQuery({
      queryKey: ['records', tableName, limit, offset, searchQuery, JSON.stringify(sortColumns)],
      queryFn: () =>
        recordService.getTableRecords(tableName, limit, offset, searchQuery, sortColumns),
      enabled: enabled && !!tableName,
      staleTime: 30 * 1000, // Cache for 30 seconds
    });
  };

  // Hook to fetch records with custom query params
  const useRecordsWithQuery = (queryParams: string = '', enabled = true) => {
    return useQuery({
      queryKey: ['records', tableName, 'query', queryParams],
      queryFn: () => recordService.getRecords(tableName, queryParams),
      enabled: enabled && !!tableName,
      staleTime: 30 * 1000,
    });
  };

  // Hook to fetch a single record by foreign key value
  const useRecordByForeignKey = (columnName: string, value: string, enabled = true) => {
    return useQuery({
      queryKey: ['records', tableName, 'foreignKey', columnName, value],
      queryFn: () => recordService.getRecordByForeignKeyValue(tableName, columnName, value),
      enabled: enabled && !!tableName && !!columnName && !!value,
      staleTime: 30 * 1000,
    });
  };

  // Mutation to create a single record
  const createRecordMutation = useMutation({
    mutationFn: (data: { [key: string]: ConvertedValue }) =>
      recordService.createRecord(tableName, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
      void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
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
      recordService.createRecords(tableName, records),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
      void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
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
    }) => recordService.updateRecord(tableName, pkColumn, pkValue, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
      void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
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
      recordService.deleteRecords(tableName, variables.pkColumn, variables.pkValues),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['records', tableName] });
      void queryClient.invalidateQueries({ queryKey: ['table', tableName] });
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
    updateRecord: updateRecordMutation.mutateAsync,
    deleteRecords: deleteRecordsMutation.mutateAsync,
  };
}
