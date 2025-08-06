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

export const columnTypeSchema = z.enum([
  ColumnType.STRING,
  ColumnType.DATETIME,
  ColumnType.INTEGER,
  ColumnType.FLOAT,
  ColumnType.BOOLEAN,
  ColumnType.UUID,
  ColumnType.JSON,
]);

export const foreignKeySchema = z.object({
  referenceTable: z.string().min(1, "Target table cannot be empty"),
  referenceColumn: z.string().min(1, "Target column cannot be empty"),
  onDelete: onDeleteActionSchema,
  onUpdate: onUpdateActionSchema,
});

export const columnSchema = z.object({
  columnName: z
    .string()
    .min(1, "Column name cannot be empty")
    .max(64, "Column name must be less than 64 characters"),
  type: columnTypeSchema,
  defaultValue: z.string().optional(),
  isPrimaryKey: z.boolean().optional(),
  isNullable: z.boolean(),
  isUnique: z.boolean(),
  foreignKey: foreignKeySchema.optional(),
});

export const tableSchema = z.object({
  tableName: z
    .string()
    .min(1, "Table name cannot be empty")
    .max(64, "Table name must be less than 64 characters"),
  columns: z.array(columnSchema).min(1, "At least one column is required"),
  recordCount: z.number().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
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
