import { z } from 'zod';
import { storageBucketSchema } from './storage.schema';
import { oAuthConfigSchema } from './auth.schema';

export const authMetadataSchema = z.object({
  oauths: z.array(oAuthConfigSchema),
});

export const databaseMetadataSchema = z.object({
  tables: z.array(
    z.object({
      schema: z.string(),
      tableName: z.string(),
      recordCount: z.number(),
    })
  ),
  totalSizeInGB: z.number(),
  hint: z.string().optional(),
});

export const bucketMetadataSchema = storageBucketSchema.extend({
  objectCount: z.number().optional(),
});

export const storageMetadataSchema = z.object({
  buckets: z.array(bucketMetadataSchema),
  totalSizeInGB: z.number(),
});

export const edgeFunctionMetadataSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
});

export const aiMetadataSchema = z.object({
  models: z.array(
    z.object({
      inputModality: z.array(z.string()),
      outputModality: z.array(z.string()),
      modelId: z.string(),
    })
  ),
});

export const appMetaDataSchema = z.object({
  auth: authMetadataSchema,
  database: databaseMetadataSchema,
  storage: storageMetadataSchema,
  aiIntegration: aiMetadataSchema.optional(),
  functions: z.array(edgeFunctionMetadataSchema),
  version: z.string().optional(),
});

export type AuthMetadataSchema = z.infer<typeof authMetadataSchema>;
export type DatabaseMetadataSchema = z.infer<typeof databaseMetadataSchema>;
export type BucketMetadataSchema = z.infer<typeof bucketMetadataSchema>;
export type StorageMetadataSchema = z.infer<typeof storageMetadataSchema>;
export type EdgeFunctionMetadataSchema = z.infer<typeof edgeFunctionMetadataSchema>;
export type AIMetadataSchema = z.infer<typeof aiMetadataSchema>;
export type AppMetadataSchema = z.infer<typeof appMetaDataSchema>;
