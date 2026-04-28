export const databaseTableQueryKeys = {
  list: ['database', 'tables', 'list'] as const,
  schemaRoot: ['database', 'tables', 'schema'] as const,
  schema: (tableName: string) => ['database', 'tables', 'schema', tableName] as const,
};
