import { z } from 'zod';

export const deploymentFileSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  content: z.string().min(1, 'File content is required'),
});

export const createDeploymentRequestSchema = z.object({
  projectName: z.string().min(1, 'Project name is required').max(255),
  files: z.array(deploymentFileSchema).min(1, 'At least one file is required'),
});

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  projectName: z.string(),
  subdomain: z.string(),
  status: z.enum(['pending', 'deploying', 'active', 'failed']),
  deploymentUrl: z.string().nullable(),
  createdAt: z.string(),
  deployedAt: z.string().nullable(),
});

export type DeploymentFile = z.infer<typeof deploymentFileSchema>;
export type CreateDeploymentRequest = z.infer<typeof createDeploymentRequestSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;
