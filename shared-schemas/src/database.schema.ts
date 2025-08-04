import { z } from "zod";

export enum ColumnType {
  STRING = "string",
  DATETIME = "datetime",
  INTEGER = "integer",
  FLOAT = "float",
  BOOLEAN = "boolean",
  UUID = "uuid",
  JSON = "json",
}

export const onUpdateActionSchema = z.enum([
  "CASCADE",
  "RESTRICT",
  "NO ACTION",
]);
export const onDeleteActionSchema = z.enum([
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
  "RESTRICT",
  "NO ACTION",
]);

export const columnTypeSchema = z.enum(ColumnType);

export const foreignKeySchema = z.object({
  reference_table: z.string().min(1, "Target table cannot be empty"),
  reference_column: z.string().min(1, "Target column cannot be empty"),
  on_delete: onDeleteActionSchema,
  on_update: onUpdateActionSchema,
});

export const columnSchema = z.object({
  name: z.string().min(1, "Column name cannot be empty"),
  type: columnTypeSchema,
  nullable: z.boolean(),
  default_value: z.string().optional(),
  primary_key: z.boolean().optional(),
  is_unique: z.boolean(),
  foreign_key: foreignKeySchema.optional(),
});

export const tableSchema = z.object({
  table_name: z.string().min(1, "Table name cannot be empty"),
  columns: z.array(columnSchema),
  record_count: z.number().default(0),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const databaseSchema = z.object({
  tables: z.array(tableSchema),
});

export type DatabaseSchema = z.infer<typeof databaseSchema>;
export type TableSchema = z.infer<typeof tableSchema>;
export type ColumnSchema = z.infer<typeof columnSchema>;
export type ForeignKeySchema = z.infer<typeof foreignKeySchema>;
export type OnUpdateActionSchema = z.infer<typeof onUpdateActionSchema>;
export type OnDeleteActionSchema = z.infer<typeof onDeleteActionSchema>;
