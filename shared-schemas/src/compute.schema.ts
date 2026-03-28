import { z } from 'zod';

export const containerStatusEnum = z.enum([
  'created',
  'deploying',
  'running',
  'failed',
  'stopped',
  'teardown_failed',
]);

export const deploymentStatusEnum = z.enum([
  'pending',
  'building',
  'pushing',
  'deploying',
  'live',
  'failed',
  'rolled_back',
]);

export const sourceTypeEnum = z.enum(['github', 'image']);

export const fargateMemoryMap = new Map<number, number[]>([
  [256, [512, 1024, 2048]],
  [512, [1024, 2048, 3072, 4096]],
  [1024, [2048, 3072, 4096, 5120, 6144, 7168, 8192]],
  [2048, [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384]],
  [
    4096,
    [
      8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432, 19456, 20480,
      21504, 22528, 23552, 24576, 25600, 26624, 27648, 28672, 29696, 30720,
    ],
  ],
]);

export const containerSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  sourceType: sourceTypeEnum,
  githubRepo: z.string().nullable(),
  githubBranch: z.string().nullable(),
  dockerfilePath: z.string().nullable(),
  imageUrl: z.string().nullable(),
  cpu: z.number(),
  memory: z.number(),
  port: z.number(),
  healthCheckPath: z.string(),
  autoDeploy: z.boolean(),
  status: containerStatusEnum,
  endpointUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const containerDeploymentSchema = z.object({
  id: z.string().uuid(),
  containerId: z.string().uuid(),
  status: deploymentStatusEnum,
  imageUri: z.string().nullable(),
  imageTag: z.string().nullable(),
  triggeredBy: z.string(),
  isActive: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ContainerSchema = z.infer<typeof containerSchema>;
export type ContainerDeploymentSchema = z.infer<typeof containerDeploymentSchema>;
export type ContainerStatus = z.infer<typeof containerStatusEnum>;
export type DeploymentStatus = z.infer<typeof deploymentStatusEnum>;
export type SourceType = z.infer<typeof sourceTypeEnum>;
