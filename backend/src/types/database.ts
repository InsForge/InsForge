// Type definitions for database schema management
import { ColumnType, ColumnSchema, ForeignKeySchema } from '@insforge/shared-schemas';

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

// Type definition for foreign key information
export type ForeignKeyInfo = ForeignKeySchema & {
  constraint_name: string;
};

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
