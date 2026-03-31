import { z } from 'zod';
import { containerSchema, containerDeploymentSchema, fargateMemoryMap } from './compute.schema.js';

export const createContainerSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(128),
    sourceType: z.enum(['github', 'image']),
    githubRepo: z.string().optional(),
    githubBranch: z.string().optional().default('main'),
    dockerfilePath: z.string().optional().default('./Dockerfile'),
    imageUrl: z.string().url().optional(),
    cpu: z.number().default(256),
    memory: z.number().default(512),
    port: z.number().min(1).max(65535).default(8080),
    healthCheckPath: z.string().default('/health'),
    autoDeploy: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.sourceType === 'github' && !data.githubRepo) {
        return false;
      }
      if (data.sourceType === 'image' && !data.imageUrl) {
        return false;
      }
      return true;
    },
    { message: 'githubRepo is required for github source, imageUrl is required for image source' }
  )
  .refine(
    (data) => {
      const validMemory = fargateMemoryMap.get(data.cpu);
      return validMemory?.includes(data.memory) ?? false;
    },
    { message: 'Invalid CPU/memory combination for Fargate' }
  );

export const updateContainerSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    githubBranch: z.string().optional(),
    imageUrl: z.string().url().optional(),
    dockerfilePath: z.string().optional(),
    cpu: z.number().optional(),
    memory: z.number().optional(),
    port: z.number().min(1).max(65535).optional(),
    healthCheckPath: z.string().optional(),
    autoDeploy: z.boolean().optional(),
    envVars: z.record(z.string()).optional(),
  })
  .refine(
    (data) => {
      if (data.cpu !== undefined || data.memory !== undefined) {
        if (data.cpu === undefined || data.memory === undefined) {
          return false;
        }
        const validMemory = fargateMemoryMap.get(data.cpu);
        return validMemory?.includes(data.memory) ?? false;
      }
      return true;
    },
    { message: 'cpu and memory must be updated together with a valid Fargate combination' }
  );

export const deployContainerSchema = z.object({
  triggeredBy: z.enum(['manual', 'config_change']).default('manual'),
  githubToken: z.string().optional(),
});

export const rollbackContainerSchema = z.object({
  deploymentId: z.string().uuid('Valid deployment ID is required'),
});

export const listComputeContainersResponseSchema = z.object({
  containers: z.array(containerSchema),
});

export const listComputeDeploymentsResponseSchema = z.object({
  deployments: z.array(containerDeploymentSchema),
});

export type CreateContainerRequest = z.infer<typeof createContainerSchema>;
export type UpdateContainerRequest = z.infer<typeof updateContainerSchema>;
export type DeployContainerRequest = z.infer<typeof deployContainerSchema>;
export type RollbackContainerRequest = z.infer<typeof rollbackContainerSchema>;
