export { introspect } from './introspect.js';
export type { IntrospectOptions } from './introspect.js';
export { format } from './format.js';
export type {
  ColumnIR,
  CompositeTypeIR,
  FunctionArgIR,
  FunctionIR,
  RelationshipIR,
  SchemaIR,
  TableIR,
} from './types.js';

import { introspect } from './introspect.js';
import { format } from './format.js';

export interface GenTypesOptions {
  connectionString: string;
  schemas?: string[];
}

/** Introspect a Postgres database and return a TypeScript `Database` module as a string. */
export async function genTypes(options: GenTypesOptions): Promise<string> {
  const schemas = await introspect({
    connectionString: options.connectionString,
    schemas: options.schemas?.length ? options.schemas : ['public'],
  });
  return format(schemas);
}
