import { GetTableSchemaResponse } from '@insforge/shared-schemas';

export interface DatabaseTemplate {
  id: string;
  title: string;
  description: string;
  tableCount: number;
  sql: string;
  visualizerSchema: GetTableSchemaResponse[];
}
