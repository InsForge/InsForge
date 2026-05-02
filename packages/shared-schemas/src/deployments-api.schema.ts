import { z } from 'zod';
import { deploymentSchema } from './deployments.schema.js';

export const projectSettingsSchema = z.object({
  buildCommand: z.string().nullable().optional(),
  outputDirectory: z.string().nullable().optional(),
  installCommand: z.string().nullable().optional(),
  devCommand: z.string().nullable().optional(),
  rootDirectory: z.string().nullable().optional(),
});

export const envVarSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/**
 * Relative file path used by direct deployment uploads.
 */
export const deploymentFilePathSchema = z
  .string()
  .min(1, 'path is required')
  .max(2048, 'path is too long')
  .refine((value) => !value.includes('\0'), 'path cannot contain null bytes')
  .refine((value) => !value.includes('\\'), 'path must use forward slashes')
  .refine((value) => !value.startsWith('/'), 'path must be relative')
  .refine(
    (value) => value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'path cannot contain empty, current, or parent directory segments'
  );

export const deploymentManifestFileEntrySchema = z.object({
  path: deploymentFilePathSchema,
  sha: z.string().regex(/^[a-f0-9]{40}$/i, 'sha must be a SHA-1 hex digest'),
  size: z.number().int().nonnegative(),
});

export const deploymentManifestFileSchema = deploymentManifestFileEntrySchema.extend({
  fileId: z.string().uuid(),
  uploadedAt: z.string().datetime().nullable(),
});

/**
 * Response from creating a legacy deployment session.
 * Includes presigned upload info for source zip upload.
 */
export const createDeploymentResponseSchema = z.object({
  id: z.string().uuid(),
  uploadUrl: z.string().url(),
  uploadFields: z.record(z.string()),
});

/**
 * Request to create a direct-upload deployment with its file manifest.
 */
export const createDirectDeploymentRequestSchema = z
  .object({
    files: z.array(deploymentManifestFileEntrySchema).min(1),
  })
  .superRefine(({ files }, ctx) => {
    const firstSeenByPath = new Map<string, number>();

    files.forEach((file, index) => {
      const existingIndex = firstSeenByPath.get(file.path);

      if (existingIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate file path',
          path: ['files', index, 'path'],
        });
        return;
      }

      firstSeenByPath.set(file.path, index);
    });
  });

/**
 * Response from creating a direct-upload deployment session.
 */
export const createDirectDeploymentResponseSchema = z.object({
  id: z.string().uuid(),
  status: deploymentSchema.shape.status,
  files: z.array(deploymentManifestFileSchema),
});

/**
 * Response from uploading a direct deployment file through the proxy.
 */
export const uploadDeploymentFileResponseSchema = deploymentManifestFileSchema.extend({
  uploadedAt: z.string().datetime(),
});

/**
 * Request to start a deployment after either legacy zip upload or direct file uploads.
 * Creates the actual Vercel deployment after source files are available.
 */
export const startDeploymentRequestSchema = z.object({
  projectSettings: projectSettingsSchema.optional(),
  envVars: z.array(envVarSchema).optional(),
  meta: z.record(z.string()).optional(),
});

/**
 * Response from starting a deployment
 */
export const startDeploymentResponseSchema = deploymentSchema;

export const listDeploymentsResponseSchema = z.object({
  data: z.array(deploymentSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
});

// ============================================================================
// Environment Variables Management API
// ============================================================================

/**
 * Environment variable schema for list response (without value for security)
 */
export const deploymentEnvVarSchema = z.object({
  id: z.string(), // Vercel env var ID (needed for delete/get)
  key: z.string(),
  type: z.enum(['plain', 'encrypted', 'secret', 'sensitive', 'system']),
  updatedAt: z.number().optional(), // Unix timestamp (milliseconds)
});

/**
 * Environment variable schema with decrypted value (for single env var fetch)
 */
export const deploymentEnvVarWithValueSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  type: z.enum(['plain', 'encrypted', 'secret', 'sensitive', 'system']),
  updatedAt: z.number().optional(),
});

/**
 * Response from listing environment variables
 */
export const listEnvVarsResponseSchema = z.object({
  envVars: z.array(deploymentEnvVarSchema),
});

/**
 * Response from getting a single environment variable with value
 */
export const getEnvVarResponseSchema = z.object({
  envVar: deploymentEnvVarWithValueSchema,
});

/**
 * Request to create or update an environment variable
 */
export const upsertEnvVarRequestSchema = z.object({
  key: z.string().trim().min(1, 'key is required'),
  value: z.string(),
});

/**
 * Request to create or update multiple environment variables
 */
export const upsertEnvVarsRequestSchema = z
  .object({
    envVars: z.array(upsertEnvVarRequestSchema).min(1),
  })
  .superRefine(({ envVars }, ctx) => {
    const firstSeenByKey = new Map<string, number>();

    envVars.forEach((envVar, index) => {
      const existingIndex = firstSeenByKey.get(envVar.key);

      if (existingIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate environment variable key',
          path: ['envVars', index, 'key'],
        });
        return;
      }

      firstSeenByKey.set(envVar.key, index);
    });
  });

/**
 * Response from upserting an environment variable
 */
export const upsertEnvVarResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

/**
 * Response from upserting multiple environment variables
 */
export const upsertEnvVarsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  count: z.number().int().positive(),
});

/**
 * Response from deleting an environment variable
 */
export const deleteEnvVarResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// ============================================================================
// Custom Slug/Domain Management API
// ============================================================================

/**
 * Request to update the custom slug
 */
export const updateSlugRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3, 'slug must be at least 3 characters')
    .max(63, 'slug must be at most 63 characters')
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      'slug must be lowercase alphanumeric with hyphens, not starting or ending with hyphen'
    )
    .nullable(),
});

/**
 * Response from updating the custom slug
 */
export const updateSlugResponseSchema = z.object({
  success: z.boolean(),
  slug: z.string().nullable(),
  domain: z.string().nullable(),
});

/**
 * Response from getting deployment metadata
 */
export const deploymentMetadataResponseSchema = z.object({
  currentDeploymentId: z.string().uuid().nullable(),
  defaultDomainUrl: z.string().nullable(),
  customDomainUrl: z.string().nullable(),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type DeploymentManifestFileEntry = z.infer<typeof deploymentManifestFileEntrySchema>;
export type DeploymentManifestFile = z.infer<typeof deploymentManifestFileSchema>;
export type CreateDeploymentResponse = z.infer<typeof createDeploymentResponseSchema>;
export type CreateDirectDeploymentRequest = z.infer<typeof createDirectDeploymentRequestSchema>;
export type CreateDirectDeploymentResponse = z.infer<typeof createDirectDeploymentResponseSchema>;
export type UploadDeploymentFileResponse = z.infer<typeof uploadDeploymentFileResponseSchema>;
export type StartDeploymentRequest = z.infer<typeof startDeploymentRequestSchema>;
export type StartDeploymentResponse = z.infer<typeof startDeploymentResponseSchema>;
export type ListDeploymentsResponse = z.infer<typeof listDeploymentsResponseSchema>;
export type DeploymentEnvVar = z.infer<typeof deploymentEnvVarSchema>;
export type DeploymentEnvVarWithValue = z.infer<typeof deploymentEnvVarWithValueSchema>;
export type ListEnvVarsResponse = z.infer<typeof listEnvVarsResponseSchema>;
export type GetEnvVarResponse = z.infer<typeof getEnvVarResponseSchema>;
export type UpsertEnvVarRequest = z.infer<typeof upsertEnvVarRequestSchema>;
export type UpsertEnvVarResponse = z.infer<typeof upsertEnvVarResponseSchema>;
export type UpsertEnvVarsRequest = z.infer<typeof upsertEnvVarsRequestSchema>;
export type UpsertEnvVarsResponse = z.infer<typeof upsertEnvVarsResponseSchema>;
export type DeleteEnvVarResponse = z.infer<typeof deleteEnvVarResponseSchema>;
export type UpdateSlugRequest = z.infer<typeof updateSlugRequestSchema>;
export type UpdateSlugResponse = z.infer<typeof updateSlugResponseSchema>;
export type DeploymentMetadataResponse = z.infer<typeof deploymentMetadataResponseSchema>;

// ============================================================================
// Custom Domain Management API (user-owned domains)
// ============================================================================

/**
 * Verification record returned by Vercel for a domain
 */
export const domainVerificationRecordSchema = z.object({
  type: z.string(),
  domain: z.string(),
  value: z.string(),
});

/**
 * A custom domain entry returned by Vercel project domain endpoints
 */
export const customDomainSchema = z.object({
  domain: z.string(),
  apexDomain: z.string(),
  verified: z.boolean(),
  misconfigured: z.boolean(),
  verification: z.array(domainVerificationRecordSchema),
  cnameTarget: z.string().nullable(),
  aRecordValue: z.string().nullable(),
});

/**
 * Request to add a custom domain
 */
export const addCustomDomainRequestSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      'Invalid domain format (e.g. myapp.com or www.myapp.com)'
    )
    .refine((domain) => !domain.toLowerCase().endsWith('.insforge.site'), {
      message: 'Domains ending with .insforge.site are reserved by InsForge',
    }),
});

/**
 * Response from adding a custom domain
 */
export const addCustomDomainResponseSchema = customDomainSchema;

/**
 * Response from listing custom domains
 */
export const listCustomDomainsResponseSchema = z.object({
  domains: z.array(customDomainSchema),
});

/**
 * Response from verifying a custom domain
 */
export const verifyCustomDomainResponseSchema = customDomainSchema;

export type DomainVerificationRecord = z.infer<typeof domainVerificationRecordSchema>;
export type CustomDomain = z.infer<typeof customDomainSchema>;
export type AddCustomDomainRequest = z.infer<typeof addCustomDomainRequestSchema>;
export type AddCustomDomainResponse = z.infer<typeof addCustomDomainResponseSchema>;
export type ListCustomDomainsResponse = z.infer<typeof listCustomDomainsResponseSchema>;
export type VerifyCustomDomainResponse = z.infer<typeof verifyCustomDomainResponseSchema>;
