import { z } from 'zod';
import { columnSchema, foreignKeySchema } from '@insforge/shared-schemas';

// Foreign key form schema — single-column FK creation from the UI
// Uses referenceColumns array (always 1 entry for dashboard-created FKs)
export const tableFormForeignKeySchema = foreignKeySchema.extend({
  columnName: z.string(),
  // Stable client-side identity for a form FK row. Existing constraints reuse their
  // constraintName; newly added ones get a generated id. Used so constraints that
  // share a first source column (e.g. multi-tenant `tenant_id`) stay distinct.
  uid: z.string().optional(),
});

export const tableFormColumnSchema = columnSchema.extend({
  // Internal tracking field (not sent to backend)
  originalName: z.string().optional(),
  isSystemColumn: z.boolean(),
  isNewColumn: z.boolean(),
});

// Table form schema
export const tableFormSchema = z.object({
  tableName: z.string(),
  columns: z.array(tableFormColumnSchema),
});

// Type exports
export type TableFormForeignKeySchema = z.infer<typeof tableFormForeignKeySchema>;
export type TableFormColumnSchema = z.infer<typeof tableFormColumnSchema>;
export type TableFormSchema = z.infer<typeof tableFormSchema>;
