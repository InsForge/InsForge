import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { ColumnSchema } from '@insforge/shared-schemas';

interface SchemaResponse {
  table_name: string;
  columns: ColumnSchema[];
}

export function useTableSchema(tableName: string) {
  return useQuery({
    queryKey: ['table-schema', tableName],
    queryFn: async () => {
      const response = (await apiClient.request(
        `/database/tables/${tableName}/schema`
      )) as SchemaResponse;
      return response;
    },
    enabled: !!tableName,
    staleTime: 30 * 1000, // Reduce from 5 minutes to 30 seconds
  });
}
