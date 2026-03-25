import { z } from 'zod';

export const containerSourceType = z.enum(['github', 'image']);

export const containerStatus = z.enum([
  'pending',
  'building',
  'deploying',
  'running',
  'stopped',
  'failed',
]);

export const deploymentStatus = z.enum([
  'pending',
  'building',
  'pushing',
  'deploying',
  'live',
  'failed',
]);

export const deploymentTrigger = z.enum([
  'manual',
  'git_push',
  'rollback',
  'config_change',
  'cron',
]);

// Valid Fargate CPU/memory combinations
export const fargateMemoryMap: Record<number, number[]> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  256: [512, 1024, 2048],
  // eslint-disable-next-line @typescript-eslint/naming-convention
  512: [1024, 2048, 3072, 4096],
  // eslint-disable-next-line @typescript-eslint/naming-convention
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
};

export const containerSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  sourceType: containerSourceType,
  githubRepo: z.string().nullable(),
  githubBranch: z.string().nullable(),
  imageUrl: z.string().nullable(),
  dockerfilePath: z.string().nullable(),
  cpu: z.number(),
  memory: z.number(),
  port: z.number(),
  healthCheckPath: z.string().nullable(),
  status: containerStatus,
  endpointUrl: z.string().nullable(),
  autoDeploy: z.boolean(),
  replicas: z.number(),
  customDomain: z.string().nullable(),
  region: z.string(),
  lastDeployedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const containerDeploymentSchema = z.object({
  id: z.string().uuid(),
  containerId: z.string().uuid(),
  commitSha: z.string().nullable(),
  imageTag: z.string().nullable(),
  buildLogUrl: z.string().nullable(),
  status: deploymentStatus,
  errorMessage: z.string().nullable(),
  triggeredBy: deploymentTrigger,
  isActive: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export type ContainerSchema = z.infer<typeof containerSchema>;
export type ContainerDeploymentSchema = z.infer<typeof containerDeploymentSchema>;
