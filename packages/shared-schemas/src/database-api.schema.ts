import { z } from 'zod';
import {
  columnSchema,
  foreignKeySchema,
  tableSchema,
  databaseSchemaInfoSchema,
  databaseFunctionSchema,
  databaseIndexSchema,
  databasePolicySchema,
  databaseTriggerSchema,
  migrationSchema,
  databaseBackupSchema,
} from './database.schema.js';

export const createTableRequestSchema = tableSchema
  .pick({
    tableName: true,
    columns: true,
    foreignKeys: true,
  })
  .extend({
    rlsEnabled: z.boolean().default(true),
  });

export const createTableResponseSchema = tableSchema
  .pick({
    schemaName: true,
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
  addColumns: z.array(columnSchema).optional(),
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
  // Each entry is a full foreign-key constraint (composite keys are one entry).
  addForeignKeys: z.array(foreignKeySchema).optional(),
  // Constraint names to drop.
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
  schemaName: z.string().optional(),
  message: z.string(),
  tableName: z.string(),
  operations: z.array(z.string()),
});

export const deleteTableResponse = z.object({
  schemaName: z.string().optional(),
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
      // Table-level foreign keys: one entry per constraint (composite keys list
      // multiple column mappings), consistent with the rest of the schema model.
      foreignKeys: z.array(foreignKeySchema),
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
  schema: z.string().default('public'),
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

export const adminTableRecordSchema = z.record(z.string(), z.unknown());

export const adminTableRecordsSortClauseSchema = z.object({
  columnName: z.string().trim().min(1, 'Column name is required'),
  direction: z.enum(['asc', 'desc']),
});

export const adminTableRecordsListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().optional(),
    sort: z.string().trim().optional(),
    filterColumn: z.string().trim().optional(),
    filterValue: z.string().optional(),
  })
  .refine(
    (value) =>
      (value.filterColumn === undefined && value.filterValue === undefined) ||
      (value.filterColumn !== undefined && value.filterValue !== undefined),
    {
      message: 'filterColumn and filterValue must be provided together.',
      path: ['filterColumn'],
    }
  );

export const adminTableRecordLookupQuerySchema = z
  .object({
    column: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
    value: z.union([z.string(), z.array(z.string()).min(1)]),
  })
  .refine(
    (data) => {
      const cols = Array.isArray(data.column) ? data.column : [data.column];
      const vals = Array.isArray(data.value) ? data.value : [data.value];
      return cols.length === vals.length;
    },
    {
      message: 'column and value must have the same number of entries',
      path: ['value'],
    }
  );

export const adminTableRecordsCreateRequestSchema = z
  .array(adminTableRecordSchema)
  .min(1, 'At least one record is required');

// A primary-key value. Restricted to scalar types that survive a JSON round-trip
// through the query string and that node-postgres can bind as a query parameter.
// `null` is excluded: PK columns are NOT NULL, and `WHERE col = NULL` never matches,
// so a null key would silently affect zero rows instead of failing loudly.
export const adminTableRecordPkValueSchema = z.union([z.string(), z.number(), z.boolean()]);

// A single record's primary key as a map of pk column name -> value.
// Supports composite primary keys (more than one column).
export const adminTableRecordPrimaryKeySchema = z
  .record(z.string().trim().min(1, 'Primary key column is required'), adminTableRecordPkValueSchema)
  .refine((key) => Object.keys(key).length > 0, {
    message: 'Primary key must include at least one column.',
  });

// The columns to set on update (at least one).
export const adminTableRecordUpdateDataSchema = adminTableRecordSchema.refine(
  (record) => Object.keys(record).length > 0,
  {
    message: 'At least one field is required.',
  }
);

// Update request body: the primary-key tuple identifying the row plus the columns
// to set. Carried in the body (not the query string) so composite keys are
// validated structurally, e.g. { "pkKeys": {"tenant_id":"t1","item_id":"i2"}, "data": {...} }.
export const adminTableRecordUpdateRequestSchema = z.object({
  pkKeys: adminTableRecordPrimaryKeySchema,
  data: adminTableRecordUpdateDataSchema,
});

// Delete request body: one primary-key tuple per record to delete,
// e.g. { "pkKeys": [{"tenant_id":"t1","item_id":"i2"},{"tenant_id":"t1","item_id":"i3"}] }.
export const adminTableRecordsDeleteRequestSchema = z.object({
  pkKeys: z.array(adminTableRecordPrimaryKeySchema).min(1, 'At least one primary key is required'),
});

export const adminTableRecordResponseSchema = adminTableRecordSchema;

export const adminTableRecordLookupResponseSchema = adminTableRecordSchema.nullable();

export const adminTableRecordsCreateResponseSchema = z.array(adminTableRecordSchema);

export const adminTableRecordsListResponseSchema = z.object({
  data: z.array(adminTableRecordSchema),
  pagination: z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
  }),
});

export const adminTableRecordsDeleteResponseSchema = z.object({
  deletedCount: z.number().int().min(0),
});

export const createMigrationRequestSchema = z.object({
  version: z
    .string()
    .regex(
      /^\d{1,64}$/,
      'Migration version must be a numeric string of at most 64 digits (e.g. 0001 or 20260418091500).'
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Migration name is required')
    .refine((value) => value.length === 0 || /^[a-z0-9-]+$/.test(value), {
      message: 'Use lowercase letters, numbers, and hyphens only.',
    }),
  sql: z.string().trim().min(1, 'Migration SQL is required'),
});

export const createMigrationResponseSchema = migrationSchema.extend({
  message: z.string(),
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
export type AdminTableRecord = z.infer<typeof adminTableRecordSchema>;
export type AdminTableRecordsSortClause = z.infer<typeof adminTableRecordsSortClauseSchema>;
export type AdminTableRecordsListQuery = z.infer<typeof adminTableRecordsListQuerySchema>;
export type AdminTableRecordLookupQuery = z.infer<typeof adminTableRecordLookupQuerySchema>;
export type AdminTableRecordsCreateRequest = z.infer<typeof adminTableRecordsCreateRequestSchema>;
export type AdminTableRecordPrimaryKey = z.infer<typeof adminTableRecordPrimaryKeySchema>;
export type AdminTableRecordUpdateRequest = z.infer<typeof adminTableRecordUpdateRequestSchema>;
export type AdminTableRecordsDeleteRequest = z.infer<typeof adminTableRecordsDeleteRequestSchema>;
export type AdminTableRecordResponse = z.infer<typeof adminTableRecordResponseSchema>;
export type AdminTableRecordLookupResponse = z.infer<typeof adminTableRecordLookupResponseSchema>;
export type AdminTableRecordsCreateResponse = z.infer<typeof adminTableRecordsCreateResponseSchema>;
export type AdminTableRecordsListResponse = z.infer<typeof adminTableRecordsListResponseSchema>;
export type AdminTableRecordsDeleteResponse = z.infer<typeof adminTableRecordsDeleteResponseSchema>;
export type CreateMigrationRequest = z.infer<typeof createMigrationRequestSchema>;
export type CreateMigrationResponse = z.infer<typeof createMigrationResponseSchema>;

// Database Metadata Response Schemas
export const databaseFunctionsResponseSchema = z.object({
  functions: z.array(databaseFunctionSchema),
});

export const databaseSchemasResponseSchema = z.object({
  schemas: z.array(databaseSchemaInfoSchema),
});

export const databaseIndexesResponseSchema = z.object({
  indexes: z.array(databaseIndexSchema),
});

export const databasePoliciesResponseSchema = z.object({
  policies: z.array(databasePolicySchema),
});

export const databaseTriggersResponseSchema = z.object({
  triggers: z.array(databaseTriggerSchema),
});

export const databaseMigrationsResponseSchema = z.object({
  migrations: z.array(migrationSchema),
});

// Database Backup Schemas
export const createDatabaseBackupRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Backup name cannot be empty')
    .max(64, 'Backup name must be less than 64 characters')
    .optional(),
});

export const renameDatabaseBackupRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Backup name cannot be empty')
    .max(64, 'Backup name must be less than 64 characters')
    .nullable(),
});

export const databaseBackupsResponseSchema = z.object({
  backups: z.array(databaseBackupSchema),
});

export const createDatabaseBackupResponseSchema = databaseBackupSchema;

export const updateDatabaseBackupResponseSchema = databaseBackupSchema;

export const deleteDatabaseBackupResponseSchema = z.object({
  message: z.string(),
});

export const restoreDatabaseBackupResponseSchema = z.object({
  message: z.string(),
});

// Database Metadata Response Types
export type DatabaseFunctionsResponse = z.infer<typeof databaseFunctionsResponseSchema>;
export type DatabaseSchemasResponse = z.infer<typeof databaseSchemasResponseSchema>;
export type DatabaseIndexesResponse = z.infer<typeof databaseIndexesResponseSchema>;
export type DatabasePoliciesResponse = z.infer<typeof databasePoliciesResponseSchema>;
export type DatabaseTriggersResponse = z.infer<typeof databaseTriggersResponseSchema>;
export type DatabaseMigrationsResponse = z.infer<typeof databaseMigrationsResponseSchema>;

// Database Backup Types
export type CreateDatabaseBackupRequest = z.infer<typeof createDatabaseBackupRequestSchema>;
export type RenameDatabaseBackupRequest = z.infer<typeof renameDatabaseBackupRequestSchema>;
export type DatabaseBackupsResponse = z.infer<typeof databaseBackupsResponseSchema>;
export type CreateDatabaseBackupResponse = z.infer<typeof createDatabaseBackupResponseSchema>;
export type UpdateDatabaseBackupResponse = z.infer<typeof updateDatabaseBackupResponseSchema>;
export type DeleteDatabaseBackupResponse = z.infer<typeof deleteDatabaseBackupResponseSchema>;
export type RestoreDatabaseBackupResponse = z.infer<typeof restoreDatabaseBackupResponseSchema>;
