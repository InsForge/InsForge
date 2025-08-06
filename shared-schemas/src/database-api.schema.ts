import { z } from "zod";
import { columnSchema, foreignKeySchema, tableSchema } from "./database.schema";

export const createTableRequestSchema = tableSchema
  .pick({
    tableName: true,
    columns: true,
  })
  .extend({
    rlsEnabled: z.boolean().default(true),
  });

export const createTableResponseSchema = tableSchema
  .pick({
    tableName: true,
    columns: true,
  })
  .extend({
    message: z.string(),
    autoFields: z.array(z.string()),
    nextActions: z.string(),
  });

export const getTableSchemaResponseSchema = tableSchema;

// Base schema without refinement - for MCP tool definition
export const updateTableSchemaBase = z.object({
  addColumns: z.array(columnSchema).optional(),
  dropColumns: z
    .array(
      z.object({
        columnName: z.string().min(1, "Column name is required for drop operation"),
      })
    )
    .optional(),
  renameColumns: z
    .record(
      z
        .string()
        .min(1, "Old column name cannot be empty")
        .max(64, "Old column name must be less than 64 characters"),
      z
        .string()
        .min(1, "New column name cannot be empty")
        .max(64, "New column name must be less than 64 characters")
    )
    .optional(),
  addFkeyColumns: z
    .array(
      z.object({
        columnName: z
          .string()
          .min(1, "Column name is required for adding foreign key"),
        foreignKey: foreignKeySchema,
      })
    )
    .optional(),
  dropFkeyColumns: z
    .array(
      z.object({
        columnName: z
          .string()
          .min(1, "Column name is required for dropping foreign key"),
      })
    )
    .optional(),
});

// Full schema with refinement - for validation
export const updateTableSchemaRequest = updateTableSchemaBase
  .refine(
    (data) =>
      data.addColumns ||
      data.dropColumns ||
      data.renameColumns ||
      data.addFkeyColumns ||
      data.dropFkeyColumns,
    {
      message:
        "At least one operation (addColumns, dropColumns, renameColumns, addFkeyColumns, dropFkeyColumns) is required. Please check the request body.",
    }
  );

export const updateTableSchemaResponse = z.object({
  message: z.string(),
  tableName: z.string(),
  operations: z.array(z.string()),
});

export const deleteTableResponse = z.object({
  message: z.string(),
  tableName: z.string(),
  nextActions: z.string(),
});

export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;
export type CreateTableResponse = z.infer<typeof createTableResponseSchema>;
export type GetTableSchemaResponse = z.infer<
  typeof getTableSchemaResponseSchema
>;
export type UpdateTableSchemaRequest = z.infer<typeof updateTableSchemaRequest>;
export type UpdateTableSchemaResponse = z.infer<
  typeof updateTableSchemaResponse
>;
export type DeleteTableResponse = z.infer<typeof deleteTableResponse>;
