/** Intermediate representation produced by introspection, consumed by the formatter. */

export interface ColumnIR {
  name: string;
  /** Mapped TypeScript type, e.g. `string`, `number`, `Json`, an enum/composite ref. */
  tsType: string;
  nullable: boolean;
  /** True when the column has a default, is an identity column, or is generated. */
  hasDefault: boolean;
}

export interface RelationshipIR {
  foreignKeyName: string;
  columns: string[];
  referencedRelation: string;
  referencedColumns: string[];
}

export interface TableIR {
  name: string;
  isView: boolean;
  /** Whether rows can be inserted. Always true for base tables; varies for views. */
  insertable: boolean;
  /** Whether rows can be updated. Always true for base tables; varies for views. */
  updatable: boolean;
  columns: ColumnIR[];
  relationships: RelationshipIR[];
}

export interface FunctionArgIR {
  name: string;
  tsType: string;
}

export interface FunctionIR {
  name: string;
  args: FunctionArgIR[];
  /** Mapped TypeScript return type. */
  returns: string;
}

export interface CompositeFieldIR {
  name: string;
  tsType: string;
  nullable: boolean;
}

export interface CompositeTypeIR {
  name: string;
  fields: CompositeFieldIR[];
}

export interface SchemaIR {
  name: string;
  tables: TableIR[];
  views: TableIR[];
  /** enum type name -> ordered member labels */
  enums: Record<string, string[]>;
  functions: FunctionIR[];
  compositeTypes: CompositeTypeIR[];
}
