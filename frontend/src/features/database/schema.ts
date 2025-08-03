import { z } from 'zod';
import { columnSchema, foreignKeySchema } from '@insforge/shared-schemas';

// Foreign key schema
export const tableFormForeignKeySchema = foreignKeySchema.extend({
  columnName: z.string().optional(),
});

export const tableFormColumnSchema = columnSchema.extend({
  // Internal tracking field (not sent to backend)
  originalName: z.string().optional(),
  isSystemColumn: z.boolean(),
  isNewColumn: z.boolean(),
});

// Table form schema
export const tableFormSchema = z.object({
  name: z.string(),
  columns: z.array(tableFormColumnSchema),
});

// Type exports
export type TableFormForeignKeySchema = z.infer<typeof tableFormForeignKeySchema>;
export type TableFormColumnSchema = z.infer<typeof tableFormColumnSchema>;
export type TableFormSchema = z.infer<typeof tableFormSchema>;
