import { z } from 'zod';
import { columnSchema, foreignKeySchema, tableSchema } from './database.schema';

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

export const updateTableSchemaRequestSchema = z.object({
  addColumns: z
    .array(
      columnSchema.omit({
        foreignKey: true,
      })
    )
    .optional(),
  dropColumns: z.array(z.string()).optional(),
  updateColumns: z
    .array(
      z.object({
        columnName: z.string(),
        defaultValue: z.string().optional(),
        newColumnName: z
          .string()
          .min(1, 'New column name cannot be empty')
          .max(64, 'New column name must be less than 64 characters')
          .optional(),
      })
    )
    .optional(),
  addForeignKeys: z
    .array(
      z.object({
        columnName: z.string().min(1, 'Column name is required for adding foreign key'),
        foreignKey: foreignKeySchema,
      })
    )
    .optional(),
  dropForeignKeys: z.array(z.string()).optional(),
  renameTable: z
    .object({
      newTableName: z
        .string()
        .min(1, 'New table name cannot be empty')
        .max(64, 'New table name must be less than 64 characters'),
    })
    .optional(),
});

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

// Raw SQL Schemas
export const rawSQLRequestSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  params: z.array(z.unknown()).optional(),
});

export const rawSQLResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().nullable(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        dataTypeID: z.number(),
      })
    )
    .optional(),
});

// Export Schemas
export const exportRequestSchema = z.object({
  tables: z.array(z.string()).optional(),
  format: z.enum(['sql', 'json']).default('sql'),
  includeData: z.boolean().default(true),
  includeFunctions: z.boolean().default(false),
  includeSequences: z.boolean().default(false),
  includeViews: z.boolean().default(false),
  rowLimit: z.number().int().positive().max(10000).default(1000),
});

export const exportJsonDataSchema = z.object({
  timestamp: z.string(),
  tables: z.record(
    z.string(),
    z.object({
      schema: z.array(
        z.object({
          columnName: z.string(),
          dataType: z.string(),
          characterMaximumLength: z.number().nullable(),
          isNullable: z.string(),
          columnDefault: z.string().nullable(),
        })
      ),
      indexes: z.array(
        z.object({
          indexname: z.string(),
          indexdef: z.string(),
          isUnique: z.boolean().nullable(),
          isPrimary: z.boolean().nullable(),
        })
      ),
      foreignKeys: z.array(
        z.object({
          constraintName: z.string(),
          columnName: z.string(),
          foreignTableName: z.string(),
          foreignColumnName: z.string(),
          deleteRule: z.string().nullable(),
          updateRule: z.string().nullable(),
        })
      ),
      rlsEnabled: z.boolean().optional(),
      policies: z.array(
        z.object({
          policyname: z.string(),
          cmd: z.string(),
          roles: z.array(z.string()),
          qual: z.string().nullable(),
          withCheck: z.string().nullable(),
        })
      ),
      triggers: z.array(
        z.object({
          triggerName: z.string(),
          actionTiming: z.string(),
          eventManipulation: z.string(),
          actionOrientation: z.string(),
          actionCondition: z.string().nullable(),
          actionStatement: z.string(),
          newTable: z.string().nullable(),
          oldTable: z.string().nullable(),
        })
      ),
      rows: z.array(z.record(z.string(), z.unknown())).optional(),
      recordCount: z.number().optional(),
    })
  ),
  functions: z.array(
    z.object({
      functionName: z.string(),
      functionDef: z.string(),
      kind: z.string(),
    })
  ),
  sequences: z.array(
    z.object({
      sequenceName: z.string(),
      startValue: z.string(),
      increment: z.string(),
      minValue: z.string().nullable(),
      maxValue: z.string().nullable(),
      cycle: z.string(),
    })
  ),
  views: z.array(
    z.object({
      viewName: z.string(),
      definition: z.string(),
    })
  ),
});

export const exportResponseSchema = z.object({
  format: z.enum(['sql', 'json']),
  data: z.union([z.string(), exportJsonDataSchema]),
  timestamp: z.string(),
});

// Import Schemas
export const importRequestSchema = z.object({
  truncate: z
    .union([
      z.boolean(),
      z.string().transform((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        throw new Error('Invalid boolean string');
      }),
    ])
    .default(false),
});

export const importResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  filename: z.string(),
  tables: z.array(z.string()),
  rowsImported: z.number(),
  fileSize: z.number(),
});

// Bulk Upsert Schemas
export const bulkUpsertRequestSchema = z.object({
  table: z.string().min(1, 'Table name is required'),
  upsertKey: z.string().optional(),
  // Note: File handling is done at the API layer via multipart/form-data
});

export const bulkUpsertResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  table: z.string(),
  rowsAffected: z.number(),
  totalRecords: z.number(),
  filename: z.string(),
});

export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;
export type CreateTableResponse = z.infer<typeof createTableResponseSchema>;
export type GetTableSchemaResponse = z.infer<typeof getTableSchemaResponseSchema>;
export type UpdateTableSchemaRequest = z.infer<typeof updateTableSchemaRequestSchema>;
export type UpdateTableSchemaResponse = z.infer<typeof updateTableSchemaResponse>;
export type DeleteTableResponse = z.infer<typeof deleteTableResponse>;

// Raw SQL Types
export type RawSQLRequest = z.infer<typeof rawSQLRequestSchema>;
export type RawSQLResponse = z.infer<typeof rawSQLResponseSchema>;

// Export Types
export type ExportDatabaseRequest = z.infer<typeof exportRequestSchema>;
export type ExportDatabaseJsonData = z.infer<typeof exportJsonDataSchema>;
export type ExportDatabaseResponse = z.infer<typeof exportResponseSchema>;

// Import Types
export type ImportDatabaseRequest = z.infer<typeof importRequestSchema>;
export type ImportDatabaseResponse = z.infer<typeof importResponseSchema>;

// Bulk Upsert Types
export type BulkUpsertRequest = z.infer<typeof bulkUpsertRequestSchema>;
export type BulkUpsertResponse = z.infer<typeof bulkUpsertResponseSchema>;
