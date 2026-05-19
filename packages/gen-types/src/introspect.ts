import { Client } from 'pg';
import { createMapper } from './typemap.js';
import type {
  ColumnIR,
  CompositeTypeIR,
  FunctionIR,
  RelationshipIR,
  SchemaIR,
  TableIR,
} from './types.js';

interface ColumnRow {
  table_name: string;
  table_type: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
  udt_name: string;
}

interface FkRow {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface EnumRow {
  typname: string;
  enumlabel: string;
}

interface CompositeRow {
  typname: string;
  attname: string;
  attnotnull: boolean;
  fieldtype: string;
}

interface FunctionRow {
  proname: string;
  proargnames: string[] | null;
  proargmodes: string[] | null;
  argtypes: number[] | null;
  rettypename: string;
  proretset: boolean;
}

/** Introspect a single schema into the formatter-ready IR. */
async function introspectSchema(client: Client, schema: string): Promise<SchemaIR> {
  // --- oid -> type name lookup (for function argument types) ---
  const typeRes = await client.query<{ oid: number; typname: string }>(
    `SELECT oid::int AS oid, typname FROM pg_type`
  );
  const oidToType = new Map<number, string>();
  for (const row of typeRes.rows) {
    oidToType.set(row.oid, row.typname);
  }

  // --- enums ---
  const enumRes = await client.query<EnumRow>(
    `SELECT t.typname, e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      ORDER BY t.typname, e.enumsortorder`,
    [schema]
  );
  const enums: Record<string, string[]> = {};
  for (const row of enumRes.rows) {
    (enums[row.typname] ??= []).push(row.enumlabel);
  }

  // --- composite types ---
  const compositeRes = await client.query<CompositeRow>(
    `SELECT t.typname, a.attname, a.attnotnull, ft.typname AS fieldtype
       FROM pg_type t
       JOIN pg_class c ON c.oid = t.typrelid AND c.relkind = 'c'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       JOIN pg_type ft ON ft.oid = a.atttypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typtype = 'c'
      ORDER BY t.typname, a.attnum`,
    [schema]
  );

  const enumNames = new Set(Object.keys(enums));
  const compositeNames = new Set(compositeRes.rows.map((r) => r.typname));
  const mapType = createMapper(schema, enumNames, compositeNames);

  const compositeMap = new Map<string, CompositeTypeIR>();
  for (const row of compositeRes.rows) {
    const composite = compositeMap.get(row.typname) ?? { name: row.typname, fields: [] };
    compositeMap.set(row.typname, composite);
    composite.fields.push({
      name: row.attname,
      tsType: mapType(row.fieldtype),
      nullable: !row.attnotnull,
    });
  }

  // --- which views accept inserts ---
  const viewRes = await client.query<{ table_name: string; is_insertable_into: string }>(
    `SELECT table_name, is_insertable_into
       FROM information_schema.views
      WHERE table_schema = $1`,
    [schema]
  );
  const viewWritable = new Map<string, boolean>();
  for (const row of viewRes.rows) {
    viewWritable.set(row.table_name, row.is_insertable_into === 'YES');
  }

  // --- foreign keys ---
  const fkRes = await client.query<FkRow>(
    `SELECT tc.constraint_name,
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
      ORDER BY tc.constraint_name`,
    [schema]
  );
  // Group FK columns by (table, constraint) so multi-column keys collapse to one entry.
  const fkByTable = new Map<string, Map<string, RelationshipIR>>();
  for (const fk of fkRes.rows) {
    const perTable = fkByTable.get(fk.table_name) ?? new Map<string, RelationshipIR>();
    fkByTable.set(fk.table_name, perTable);
    const rel = perTable.get(fk.constraint_name) ?? {
      foreignKeyName: fk.constraint_name,
      columns: [],
      referencedRelation: fk.foreign_table_name,
      referencedColumns: [],
    };
    rel.columns.push(fk.column_name);
    rel.referencedColumns.push(fk.foreign_column_name);
    perTable.set(fk.constraint_name, rel);
  }

  // --- tables & views ---
  const colRes = await client.query<ColumnRow>(
    `SELECT c.table_name,
            t.table_type,
            c.column_name,
            c.is_nullable,
            c.column_default,
            c.is_identity,
            c.is_generated,
            c.udt_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = $1
        AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY c.table_name, c.ordinal_position`,
    [schema]
  );
  const tableMap = new Map<string, TableIR>();
  for (const row of colRes.rows) {
    const isView = row.table_type === 'VIEW';
    const table = tableMap.get(row.table_name) ?? {
      name: row.table_name,
      isView,
      writable: isView ? (viewWritable.get(row.table_name) ?? false) : true,
      columns: [],
      relationships: [...(fkByTable.get(row.table_name)?.values() ?? [])],
    };
    tableMap.set(row.table_name, table);

    const column: ColumnIR = {
      name: row.column_name,
      tsType: mapType(row.udt_name),
      nullable: row.is_nullable === 'YES',
      hasDefault:
        row.column_default !== null || row.is_identity === 'YES' || row.is_generated === 'ALWAYS',
    };
    table.columns.push(column);
  }

  // --- functions (RPCs) ---
  // A function returning a table/view rowtype maps to that relation's `Row`.
  const tableNames = new Set([...tableMap.values()].filter((t) => !t.isView).map((t) => t.name));
  const viewNames = new Set([...tableMap.values()].filter((t) => t.isView).map((t) => t.name));
  const resolveReturn = (typeName: string): string => {
    if (tableNames.has(typeName)) {
      return `Database[${JSON.stringify(schema)}]["Tables"][${JSON.stringify(typeName)}]["Row"]`;
    }
    if (viewNames.has(typeName)) {
      return `Database[${JSON.stringify(schema)}]["Views"][${JSON.stringify(typeName)}]["Row"]`;
    }
    if (typeName === 'record') {
      return 'Record<string, unknown>';
    }
    return mapType(typeName);
  };

  const funcRes = await client.query<FunctionRow>(
    `SELECT p.proname,
            p.proargnames,
            p.proargmodes::text[] AS proargmodes,
            COALESCE(
              p.proallargtypes::oid[],
              string_to_array(NULLIF(p.proargtypes::text, ''), ' ')::oid[]
            ) AS argtypes,
            rt.typname AS rettypename,
            p.proretset
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_type rt ON rt.oid = p.prorettype
      WHERE n.nspname = $1
        AND p.prokind = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
        )
      ORDER BY p.proname`,
    [schema]
  );
  // De-dupe overloaded names deterministically (sorted query -> last wins).
  const functionMap = new Map<string, FunctionIR>();
  for (const row of funcRes.rows) {
    if (row.rettypename === 'trigger') {
      continue; // trigger functions are not callable RPCs
    }
    const args: FunctionIR['args'] = [];
    const argtypes = row.argtypes ?? [];
    for (let i = 0; i < argtypes.length; i++) {
      const mode = row.proargmodes?.[i];
      if (mode && mode !== 'i' && mode !== 'b') {
        continue; // skip OUT / TABLE / VARIADIC-out params
      }
      const typeName = oidToType.get(argtypes[i]) ?? 'text';
      args.push({
        name: row.proargnames?.[i] || `arg${i + 1}`,
        tsType: mapType(typeName),
      });
    }
    let returns = resolveReturn(row.rettypename);
    if (row.proretset) {
      returns = `${returns}[]`;
    }
    functionMap.set(row.proname, { name: row.proname, args, returns });
  }

  const all = [...tableMap.values()];
  return {
    name: schema,
    tables: all.filter((t) => !t.isView),
    views: all.filter((t) => t.isView),
    enums,
    functions: [...functionMap.values()],
    compositeTypes: [...compositeMap.values()],
  };
}

export interface IntrospectOptions {
  connectionString: string;
  schemas: string[];
}

export async function introspect(options: IntrospectOptions): Promise<SchemaIR[]> {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    const result: SchemaIR[] = [];
    for (const schema of options.schemas) {
      result.push(await introspectSchema(client, schema));
    }
    return result;
  } finally {
    await client.end();
  }
}
