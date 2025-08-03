import { z } from 'zod';

export enum ColumnType {
  STRING = 'string',
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

export const columnTypeSchema = z.enum(ColumnType);

export const foreignKeySchema = z.object({
  reference_table: z.string(),
  reference_column: z.string(),
  on_delete: onDeleteActionSchema,
  on_update: onUpdateActionSchema,
});

export const columnSchema = z.object({
  name: z.string(),
  type: columnTypeSchema,
  nullable: z.boolean(),
  default_value: z.string().optional(),
  primary_key: z.boolean().optional(),
  is_unique: z.boolean(),
  foreign_key: foreignKeySchema.optional(),
});

export const tableSchema = z.object({
  table_name: z.string(),
  columns: z.array(columnSchema),
  record_count: z.number().default(0),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type TableSchema = z.infer<typeof tableSchema>;
export type ColumnSchema = z.infer<typeof columnSchema>;
export type ForeignKeySchema = z.infer<typeof foreignKeySchema>;
export type OnUpdateActionSchema = z.infer<typeof onUpdateActionSchema>;
export type OnDeleteActionSchema = z.infer<typeof onDeleteActionSchema>;
