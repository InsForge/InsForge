export const databaseTableQueryKeys = {
  tables: (schemaName: string) => ['database', 'tables', schemaName] as const,
  tableSchema: (schemaName: string, tableName: string) =>
    ['database', 'table-schemas', schemaName, tableName] as const,
};

export const databaseSchemaQueryKeys = {
  allSchemas: ['database', 'schemas'] as const,
};
