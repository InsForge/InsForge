import { ColumnType } from '@insforge/shared-schemas';

export const convertSqlTypeToColumnType = (sqlType: string) => {
  switch (sqlType.toLowerCase()) {
    case 'uuid':
      return ColumnType.UUID;
    case 'timestamp with time zone':
      return ColumnType.DATETIME;
    case 'integer':
      return ColumnType.INTEGER;
    case 'double precision':
      return ColumnType.FLOAT;
    case 'boolean':
      return ColumnType.BOOLEAN;
    case 'jsonb':
      return ColumnType.JSON;
    case 'text':
    default:
      return ColumnType.STRING;
  }
};
