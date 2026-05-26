import { z } from 'zod';
import { storageBucketSchema } from './storage.schema.js';
import { realtimeChannelSchema } from './realtime.schema.js';
import { realtimePermissionsResponseSchema } from './realtime-api.schema.js';
import { authConfigAdminResponseSchema } from './auth-api.schema.js';

// Admin metadata for /api/metadata/auth (gated behind verifyAdmin). Identical
// shape to the canonical admin auth response — public response in
// auth-api.schema.ts is derived from the same source by omitting sensitive
// fields, so they can't drift.
export const authMetadataSchema = authConfigAdminResponseSchema;

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

export const realtimeMetadataSchema = z.object({
  channels: z.array(realtimeChannelSchema),
  permissions: realtimePermissionsResponseSchema,
});

/**
 * Deployments slice for the admin metadata response. Cloud-only: this slice
 * is omitted entirely in self-hosted backends (where custom slugs are not
 * available). The CLI's capability probe uses presence/absence of this slice
 * to decide whether to apply `[deployments]` TOML sections.
 *
 * `customSlug: null` means cloud + slug not set (project uses default URL).
 * Absent slice means self-host (feature doesn't exist).
 */
export const deploymentsMetadataSchema = z.object({
  customSlug: z.string().nullable(),
});

export const appMetaDataSchema = z.object({
  auth: authMetadataSchema,
  database: databaseMetadataSchema,
  storage: storageMetadataSchema,
  functions: z.array(edgeFunctionMetadataSchema),
  realtime: realtimeMetadataSchema.optional(),
  deployments: deploymentsMetadataSchema.optional(),
  version: z.string().optional(),
});

export type AuthMetadataSchema = z.infer<typeof authMetadataSchema>;
export type DatabaseMetadataSchema = z.infer<typeof databaseMetadataSchema>;
export type BucketMetadataSchema = z.infer<typeof bucketMetadataSchema>;
export type StorageMetadataSchema = z.infer<typeof storageMetadataSchema>;
export type EdgeFunctionMetadataSchema = z.infer<typeof edgeFunctionMetadataSchema>;
export type RealtimeMetadataSchema = z.infer<typeof realtimeMetadataSchema>;
export type DeploymentsMetadataSchema = z.infer<typeof deploymentsMetadataSchema>;
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
