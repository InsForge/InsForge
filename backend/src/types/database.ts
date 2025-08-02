// Type definitions for database schema management
import { ColumnType } from '@insforge/shared-schemas';

// Column schema information from database
export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  default_value?: string;
  primary_key?: boolean;
  is_unique?: boolean;
  foreign_key?: {
    table: string;
    column: string;
    on_delete?: string;
    on_update?: string;
  };
}

// Table schema including columns and statistics
export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  record_count?: number | string;
  created_at?: string;
  updated_at?: string;
}

// Database schema containing all tables
export interface DatabaseSchema {
  tables: TableSchema[];
}

// Database metadata format returned by getDatabaseMetadata
export interface DatabaseMetadata {
  tables: Record<
    string,
    {
      columns: ColumnSchema[];
      record_count: number;
    }
  >;
}

export interface ColumnTypeInfo {
  type: ColumnType;
  sqlType: string;
  defaultValue: string | null;
  description: string;
  icon?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// Map frontend types to PostgreSQL types with metadata
export const COLUMN_TYPES: Record<ColumnType, ColumnTypeInfo> = {
  [ColumnType.STRING]: {
    type: ColumnType.STRING,
    sqlType: 'TEXT',
    defaultValue: null,
    description: 'Text up to 255 characters',
    icon: 'text',
  },
  [ColumnType.DATETIME]: {
    type: ColumnType.DATETIME,
    sqlType: 'TIMESTAMPTZ',
    defaultValue: 'CURRENT_TIMESTAMP',
    description: 'Date and time with timezone',
    icon: 'calendar',
  },
  [ColumnType.INTEGER]: {
    type: ColumnType.INTEGER,
    sqlType: 'INTEGER',
    defaultValue: null,
    description: 'Whole numbers',
    icon: 'hash',
  },
  [ColumnType.FLOAT]: {
    type: ColumnType.FLOAT,
    sqlType: 'DOUBLE PRECISION',
    defaultValue: null,
    description: 'Decimal numbers with double precision',
    icon: 'percent',
  },
  [ColumnType.BOOLEAN]: {
    type: ColumnType.BOOLEAN,
    sqlType: 'BOOLEAN',
    defaultValue: 'false',
    description: 'True/false values',
    icon: 'toggle',
  },
  [ColumnType.UUID]: {
    type: ColumnType.UUID,
    sqlType: 'UUID',
    defaultValue: 'gen_random_uuid()',
    description: 'Unique identifier (auto-generated)',
    icon: 'fingerprint',
  },
  [ColumnType.JSON]: {
    type: ColumnType.JSON,
    sqlType: 'JSONB',
    defaultValue: null,
    description: 'Structured JSON data with indexing support',
    icon: 'code',
  },
};

export interface ForeignKeyDefinition {
  column: string;
  references_table: string;
  references_column: string;
  on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  on_update?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  nullable: boolean;
  is_unique?: boolean;
  default_value?: string;
  foreign_key?: {
    table: string;
    column: string;
    on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    on_update?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  };
}

export interface CreateTableRequest {
  table_name: string;
  columns: ColumnDefinition[];
  rls_decl?: boolean; // Use RLS policies for this table
}

// Type definition for foreign key information
export interface ForeignKeyInfo {
  constraint_name: string;
  reference_table: string;
  reference_column: string;
  on_delete: string;
  on_update: string;
}

// Type definition for foreign key row from database
export interface ForeignKeyRow {
  constraint_name: string;
  from_column: string;
  foreign_table: string;
  foreign_column: string;
  on_delete: string;
  on_update: string;
}

// Type definition for column information from database
export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

// Type definition for primary key information
export interface PrimaryKeyInfo {
  column_name: string;
}

// Valid types for database column values
export type DatabaseValue =
  | string
  | number
  | boolean
  | null
  | Date
  | DatabaseValue[]
  | { [key: string]: DatabaseValue }; // jsonB type

// Generic database record type - used when we don't know the exact table structure
export type DatabaseRecord = Record<string, DatabaseValue>;

// Response types for table operations
export interface CreateTableResponse {
  message: string;
  table_name: string;
  columns: Array<ColumnDefinition & { sql_type: string }>;
  auto_fields: string[];
  nextAction: string;
}

export interface GetTableSchemaResponse {
  table_name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    primary_key: boolean;
    is_unique: boolean;
    default_value: string | null;
    foreign_key?: ForeignKeyInfo;
  }>;
}

export interface UpdateTableSchemaRequest {
  add_columns?: ColumnDefinition[];
  drop_columns?: Array<{ name: string }>;
  rename_columns?: Record<string, string>;
  add_fkey_columns?: ColumnDefinition[];
  drop_fkey_columns?: Array<{ name: string }>;
}

export interface UpdateTableSchemaResponse {
  message: string;
  table_name: string;
  operations: string[];
}

export interface DeleteTableResponse {
  message: string;
  table_name: string;
  nextAction: string;
}
