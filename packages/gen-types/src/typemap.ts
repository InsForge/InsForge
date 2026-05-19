/** Postgres type-name (`udt_name` / `pg_type.typname`) -> TypeScript scalar. */
const SCALAR_MAP: Record<string, string> = {
  int2: 'number',
  int4: 'number',
  int8: 'number',
  numeric: 'number',
  float4: 'number',
  float8: 'number',
  oid: 'number',
  bool: 'boolean',
  json: 'Json',
  jsonb: 'Json',
  void: 'undefined',
  // `money` intentionally absent: PostgREST serializes it via the locale text
  // output function ("$1,234.56"), so it arrives as a string, not a number.
};

function ref(schema: string, group: string, name: string): string {
  return `Database[${JSON.stringify(schema)}][${JSON.stringify(group)}][${JSON.stringify(name)}]`;
}

export interface TypeMapper {
  /** Map a Postgres type name to a TS type, resolving enums, composites and array wrappers. */
  (typeName: string): string;
}

/**
 * Build a mapper bound to a schema. Enum and composite names resolve to
 * `Database[...]` references; arrays (`_elem` names) recurse to `T[]`.
 */
export function createMapper(
  schema: string,
  enums: Set<string>,
  composites: Set<string>
): TypeMapper {
  const map: TypeMapper = (typeName: string): string => {
    if (typeName.startsWith('_')) {
      return `${map(typeName.slice(1))}[]`;
    }
    if (enums.has(typeName)) {
      return ref(schema, 'Enums', typeName);
    }
    if (composites.has(typeName)) {
      return ref(schema, 'CompositeTypes', typeName);
    }
    return SCALAR_MAP[typeName] ?? 'string';
  };
  return map;
}
