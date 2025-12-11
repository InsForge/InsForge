import { z } from 'zod';

export enum ColumnType {
  STRING = 'string',
  DATE = 'date',
  DATETIME = 'datetime',
  INTEGER = 'integer',
  FLOAT = 'float',
  BOOLEAN = 'boolean',
  UUID = 'uuid',
  JSON = 'json',
}

export const onUpdateActionSchema = z.enum(['CASCADE', 'RESTRICT', 'NO ACTION']);
export const onDeleteActionSchema = z.enum([
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
  'RESTRICT',
  'NO ACTION',
]);

export const columnTypeSchema = z.enum([
  ColumnType.STRING,
  ColumnType.DATE,
  ColumnType.DATETIME,
  ColumnType.INTEGER,
  ColumnType.FLOAT,
  ColumnType.BOOLEAN,
  ColumnType.UUID,
  ColumnType.JSON,
]);

export const foreignKeySchema = z.object({
  referenceTable: z.string().min(1, 'Target table cannot be empty'),
  referenceColumn: z.string().min(1, 'Target column cannot be empty'),
  onDelete: onDeleteActionSchema,
  onUpdate: onUpdateActionSchema,
});

export const columnSchema = z.object({
  columnName: z
    .string()
    .min(1, 'Column name cannot be empty')
    .max(64, 'Column name must be less than 64 characters'),
  type: z.union([columnTypeSchema, z.string()]),
  defaultValue: z.string().optional(),
  isPrimaryKey: z.boolean().optional(),
  isNullable: z.boolean(),
  isUnique: z.boolean(),
  foreignKey: foreignKeySchema.optional(),
});

export const tableSchema = z.object({
  tableName: z
    .string()
    .min(1, 'Table name cannot be empty')
    .max(64, 'Table name must be less than 64 characters'),
  columns: z.array(columnSchema).min(1, 'At least one column is required'),
  recordCount: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type TableSchema = z.infer<typeof tableSchema>;
export type ColumnSchema = z.infer<typeof columnSchema>;
export type ForeignKeySchema = z.infer<typeof foreignKeySchema>;
export type OnUpdateActionSchema = z.infer<typeof onUpdateActionSchema>;
export type OnDeleteActionSchema = z.infer<typeof onDeleteActionSchema>;

// Database Metadata Object Schemas
export const databaseFunctionSchema = z.object({
  functionName: z.string(),
  functionDef: z.string(),
  kind: z.string(),
});

export const databaseIndexSchema = z.object({
  tableName: z.string(),
  indexName: z.string(),
  indexDef: z.string(),
  isUnique: z.boolean().nullable(),
  isPrimary: z.boolean().nullable(),
});

export const databasePolicySchema = z.object({
  tableName: z.string(),
  policyName: z.string(),
  cmd: z.string(),
  roles: z.array(z.string()),
  qual: z.string().nullable(),
  withCheck: z.string().nullable(),
});

export const databaseTriggerSchema = z.object({
  tableName: z.string(),
  triggerName: z.string(),
  actionTiming: z.string(),
  eventManipulation: z.string(),
  actionOrientation: z.string(),
  actionCondition: z.string().nullable(),
  actionStatement: z.string(),
});

export type DatabaseFunction = z.infer<typeof databaseFunctionSchema>;
export type DatabaseIndex = z.infer<typeof databaseIndexSchema>;
export type DatabasePolicy = z.infer<typeof databasePolicySchema>;
export type DatabaseTrigger = z.infer<typeof databaseTriggerSchema>;
