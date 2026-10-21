// Type definitions for database schema management
import { ColumnType } from '@insforge/shared-schemas';

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
  [ColumnType.DATE]: {
    type: ColumnType.DATE,
    sqlType: 'DATE',
    defaultValue: 'now()',
    description: 'Date',
    icon: 'calendar',
  },
  [ColumnType.DATETIME]: {
    type: ColumnType.DATETIME,
    sqlType: 'TIMESTAMPTZ',
    defaultValue: 'now()',
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

// Type definition for foreign key row from database
export interface ForeignKeyRow {
  constraint_name: string;
  from_column: string;
  foreign_schema: string;
  foreign_table: string;
  foreign_column: string;
  ordinal_position: number;
  on_delete: string;
  on_update: string;
}

// Type definition for column information from database
export interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
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
