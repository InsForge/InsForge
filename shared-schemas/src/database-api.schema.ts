import { z } from "zod";
import { columnSchema, foreignKeySchema, tableSchema } from "./database.schema";

export const createTableRequestSchema = z.object({
  table_name: z.string().min(1, "table_name cannot be empty"),
  columns: z.array(columnSchema).min(1, "At least one column is required"),
  rls_enabled: z.boolean().default(true),
});

export const createTableResponseSchema = tableSchema
  .pick({
    table_name: true,
    columns: true,
  })
  .extend({
    message: z.string(),
    auto_fields: z.array(z.string()),
    nextAction: z.string(),
  });

export const getTableSchemaResponseSchema = tableSchema;

export const updateTableSchemaRequest = z
  .object({
    add_columns: z.array(columnSchema).optional(),
    drop_columns: z
      .array(
        z.object({
          name: z.string().min(1, "Column name is required for drop operation"),
        })
      )
      .optional(),
    rename_columns: z
      .record(
        z.string().min(1, "Old column name cannot be empty"),
        z.string().min(1, "New column name cannot be empty")
      )
      .optional(),
    add_fkey_columns: z
      .array(
        z.object({
          name: z
            .string()
            .min(1, "Column name is required for adding foreign key"),
          foreign_key: foreignKeySchema,
        })
      )
      .optional(),
    drop_fkey_columns: z
      .array(
        z.object({
          name: z
            .string()
            .min(1, "Column name is required for dropping foreign key"),
        })
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.add_columns ||
      data.drop_columns ||
      data.rename_columns ||
      data.add_fkey_columns ||
      data.drop_fkey_columns,
    {
      message:
        "At least one operation (add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns) is required. Please check the request body.",
    }
  );

export const updateTableSchemaResponse = z.object({
  message: z.string(),
  table_name: z.string(),
  operations: z.array(z.string()),
});

export const deleteTableResponse = z.object({
  message: z.string(),
  table_name: z.string(),
  nextAction: z.string(),
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
