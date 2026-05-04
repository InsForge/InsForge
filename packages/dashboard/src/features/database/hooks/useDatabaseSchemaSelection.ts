import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';

interface SetDatabaseSchemaOptions {
  replace?: boolean;
  clearTable?: boolean;
}

export function useDatabaseSchemaSelection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSchema = searchParams.get('schema')?.trim() || DEFAULT_DATABASE_SCHEMA;

  const setSelectedSchema = useCallback(
    (schemaName: string, options: SetDatabaseSchemaOptions = {}) => {
      const nextSearchParams = new URLSearchParams(searchParams);

      if (schemaName === DEFAULT_DATABASE_SCHEMA) {
        nextSearchParams.delete('schema');
      } else {
        nextSearchParams.set('schema', schemaName);
      }

      if (options.clearTable) {
        nextSearchParams.delete('table');
      }

      setSearchParams(nextSearchParams, { replace: options.replace });
    },
    [searchParams, setSearchParams]
  );

  return {
    searchParams,
    selectedSchema,
    setSelectedSchema,
  };
}
