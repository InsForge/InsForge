import { z } from 'zod';
import { storageBucketSchema } from './storage.schema.js';
import { realtimeChannelSchema } from './realtime.schema.js';
import { realtimePermissionsResponseSchema } from './realtime-api.schema.js';
import { authConfigAdminResponseSchema } from './auth-api.schema.js';
import { computeCapabilitiesSchema, computeProviderEnum } from './compute-services.schema.js';

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

/**
 * Compute slice for the admin metadata response.
 *
 * Omitted entirely when no compute provider is configured, so presence/absence is
 * the coarse "is compute available here" signal — the same mechanism the
 * deployments slice uses, which lets a caller gate a whole feature without first
 * making a request that would 503.
 *
 * When present it carries content rather than just existing, because two things
 * are not derivable by a caller that already knows the provider enum:
 *
 *   - `defaultProvider`, and which providers are active, depend on the operator's
 *     environment (is a Docker socket mounted, are Fly credentials set).
 *   - Capabilities are not frozen per provider name. `sourceBuild` for Docker
 *     changed from 'none' to 'context-upload' when server-side builds landed, and
 *     `deployTokenIssuance` differs for the *same* provider name — false on
 *     self-hosted Fly, true on cloud-managed. A caller-side constant table keyed
 *     by provider cannot express either, and would be silently wrong across a
 *     version skew, which is routine when an operator's backend and a developer's
 *     CLI upgrade on different schedules.
 */
export const computeMetadataSchema = z.object({
  defaultProvider: computeProviderEnum,
  providers: z.record(computeProviderEnum, computeCapabilitiesSchema),
});

export const appMetaDataSchema = z.object({
  auth: authMetadataSchema,
  database: databaseMetadataSchema,
  storage: storageMetadataSchema,
  functions: z.array(edgeFunctionMetadataSchema),
  realtime: realtimeMetadataSchema.optional(),
  deployments: deploymentsMetadataSchema.optional(),
  compute: computeMetadataSchema.optional(),
  version: z.string().optional(),
});

export type AuthMetadataSchema = z.infer<typeof authMetadataSchema>;
export type DatabaseMetadataSchema = z.infer<typeof databaseMetadataSchema>;
export type BucketMetadataSchema = z.infer<typeof bucketMetadataSchema>;
export type StorageMetadataSchema = z.infer<typeof storageMetadataSchema>;
export type EdgeFunctionMetadataSchema = z.infer<typeof edgeFunctionMetadataSchema>;
export type RealtimeMetadataSchema = z.infer<typeof realtimeMetadataSchema>;
export type DeploymentsMetadataSchema = z.infer<typeof deploymentsMetadataSchema>;
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

export const anonKeyResponseSchema = z.object({
  anonKey: z.string(),
});

export const projectIdResponseSchema = z.object({
  projectId: z.string().nullable(),
});

export type DatabaseConnectionParameters = z.infer<typeof databaseConnectionParametersSchema>;
export type DatabaseConnectionInfo = z.infer<typeof databaseConnectionInfoSchema>;
export type DatabasePasswordInfo = z.infer<typeof databasePasswordInfoSchema>;
export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;
export type AnonKeyResponse = z.infer<typeof anonKeyResponseSchema>;
export type ProjectIdResponse = z.infer<typeof projectIdResponseSchema>;
