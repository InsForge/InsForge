import { z } from 'zod';
import { fargateMemoryMap } from './compute.schema';

export const createContainerSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens')
      .default('default'),
    sourceType: z.enum(['github', 'image']),
    githubRepo: z.string().optional(),
    githubBranch: z.string().optional(),
    imageUrl: z.string().url().optional(),
    dockerfilePath: z.string().default('./Dockerfile'),
    cpu: z.number().default(256),
    memory: z.number().default(512),
    port: z.number().min(1).max(65535).default(8080),
    healthCheckPath: z.string().default('/health'),
    autoDeploy: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.sourceType === 'github') {
        return !!data.githubRepo && !!data.githubBranch;
      }
      return !!data.imageUrl;
    },
    {
      message: 'GitHub source requires repo and branch; image source requires imageUrl',
    }
  )
  .refine(
    (data) => {
      const validMemory = fargateMemoryMap[data.cpu];
      return validMemory && validMemory.includes(data.memory);
    },
    {
      message: 'Invalid CPU/memory combination for Fargate',
    }
  );

export const updateContainerSchema = z.object({
  githubBranch: z.string().optional(),
  imageUrl: z.string().url().optional(),
  dockerfilePath: z.string().optional(),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  port: z.number().min(1).max(65535).optional(),
  healthCheckPath: z.string().optional(),
  autoDeploy: z.boolean().optional(),
  envVars: z.record(z.string()).optional(),
});

export const deployContainerSchema = z.object({
  triggeredBy: z.enum(['manual', 'config_change']).default('manual'),
});

export type CreateContainerRequest = z.input<typeof createContainerSchema>;
export type UpdateContainerRequest = z.infer<typeof updateContainerSchema>;
export type DeployContainerRequest = z.infer<typeof deployContainerSchema>;
