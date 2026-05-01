import { z } from 'zod';
import { storageBucketSchema } from './storage.schema.js';
import { realtimeChannelSchema } from './realtime.schema.js';
import { realtimePermissionsResponseSchema } from './realtime-api.schema.js';
import { getPublicAuthConfigResponseSchema } from './auth-api.schema.js';

export const authMetadataSchema = getPublicAuthConfigResponseSchema;

export const databaseMetadataSchema = z.object({
  tables: z.array(
    z.object({
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

export const realtimeMetadataSchema = z.object({
  channels: z.array(realtimeChannelSchema),
  permissions: realtimePermissionsResponseSchema,
});

// Compute services availability. The dashboard uses `enabled` to hide the
// Compute sidebar item entirely when neither a Fly token (self-host) nor
// cloud-proxy creds (PROJECT_ID + CLOUD_API_HOST + JWT_SECRET) are set —
// rather than letting users click into a page that returns 503 on every
// request.
export const computeMetadataSchema = z.object({
  enabled: z.boolean(),
});

export const appMetaDataSchema = z.object({
  auth: authMetadataSchema,
  database: databaseMetadataSchema,
  storage: storageMetadataSchema,
  aiIntegration: aiMetadataSchema.optional(),
  compute: computeMetadataSchema.optional(),
  functions: z.array(edgeFunctionMetadataSchema),
  realtime: realtimeMetadataSchema.optional(),
  version: z.string().optional(),
});

export type AuthMetadataSchema = z.infer<typeof authMetadataSchema>;
export type DatabaseMetadataSchema = z.infer<typeof databaseMetadataSchema>;
export type BucketMetadataSchema = z.infer<typeof bucketMetadataSchema>;
export type StorageMetadataSchema = z.infer<typeof storageMetadataSchema>;
export type EdgeFunctionMetadataSchema = z.infer<typeof edgeFunctionMetadataSchema>;
export type AIMetadataSchema = z.infer<typeof aiMetadataSchema>;
export type RealtimeMetadataSchema = z.infer<typeof realtimeMetadataSchema>;
export type ComputeMetadataSchema = z.infer<typeof computeMetadataSchema>;
export type AppMetadataSchema = z.infer<typeof appMetaDataSchema>;

// Database connection schemas
export const databaseConnectionParametersSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  sslmode: z.string(),
});

export const databaseConnectionInfoSchema = z.object({
  connectionURL: z.string(),
  parameters: databaseConnectionParametersSchema,
});

export const databasePasswordInfoSchema = z.object({
  databasePassword: z.string(),
});

export const apiKeyResponseSchema = z.object({
  apiKey: z.string(),
});

export const projectIdResponseSchema = z.object({
  projectId: z.string().nullable(),
});

export type DatabaseConnectionParameters = z.infer<typeof databaseConnectionParametersSchema>;
export type DatabaseConnectionInfo = z.infer<typeof databaseConnectionInfoSchema>;
export type DatabasePasswordInfo = z.infer<typeof databasePasswordInfoSchema>;
export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;
export type ProjectIdResponse = z.infer<typeof projectIdResponseSchema>;
