import { z } from 'zod';
import { deploymentSchema } from './deployments.schema';

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
 * Response from creating a deployment - includes presigned upload info
 */
export const createDeploymentResponseSchema = z.object({
  id: z.string().uuid(),
  uploadUrl: z.string().url(),
  uploadFields: z.record(z.string()), // Required for S3 presigned POST (policy, signature, key, etc.)
});

/**
 * Request to start a deployment (step 2)
 * Triggers upload to Vercel and creates the actual deployment
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

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type CreateDeploymentResponse = z.infer<typeof createDeploymentResponseSchema>;
export type StartDeploymentRequest = z.infer<typeof startDeploymentRequestSchema>;
export type StartDeploymentResponse = z.infer<typeof startDeploymentResponseSchema>;
export type ListDeploymentsResponse = z.infer<typeof listDeploymentsResponseSchema>;
