import { z } from 'zod';
import { deploymentSchema } from './deployments.schema';

export const projectSettingsSchema = z.object({
  buildCommand: z.string().nullable().optional(),
  outputDirectory: z.string().nullable().optional(),
  installCommand: z.string().nullable().optional(),
  devCommand: z.string().nullable().optional(),
  rootDirectory: z.string().nullable().optional(),
});

export const deploymentFileSchema = z.object({
  file: z.string(),
  data: z.string(),
});

export const createDeploymentRequestSchema = z.object({
  name: z.string().optional(),
  files: z.array(deploymentFileSchema).optional(),
  target: z.enum(['production', 'preview']).optional(),
  projectSettings: projectSettingsSchema.optional(),
  meta: z.record(z.string()).optional(),
});

export const listDeploymentsResponseSchema = z.object({
  deployments: z.array(deploymentSchema),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type DeploymentFile = z.infer<typeof deploymentFileSchema>;
export type CreateDeploymentRequest = z.infer<typeof createDeploymentRequestSchema>;
export type ListDeploymentsResponse = z.infer<typeof listDeploymentsResponseSchema>;
