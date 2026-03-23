import { z } from 'zod';
import { FARGATE_CPU_MEMORY_MAP } from './compute.schema';

export const createContainerSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens').default('default'),
  source_type: z.enum(['github', 'image']),
  github_repo: z.string().optional(),
  github_branch: z.string().optional(),
  image_url: z.string().url().optional(),
  dockerfile_path: z.string().default('./Dockerfile'),
  cpu: z.number().default(256),
  memory: z.number().default(512),
  port: z.number().min(1).max(65535).default(8080),
  health_check_path: z.string().default('/health'),
  auto_deploy: z.boolean().default(true),
}).refine((data) => {
  if (data.source_type === 'github') {
    return !!data.github_repo && !!data.github_branch;
  }
  return !!data.image_url;
}, {
  message: 'GitHub source requires repo and branch; image source requires image_url',
}).refine((data) => {
  const validMemory = FARGATE_CPU_MEMORY_MAP[data.cpu];
  return validMemory && validMemory.includes(data.memory);
}, {
  message: 'Invalid CPU/memory combination for Fargate',
});

export const updateContainerSchema = z.object({
  github_branch: z.string().optional(),
  image_url: z.string().url().optional(),
  dockerfile_path: z.string().optional(),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  port: z.number().min(1).max(65535).optional(),
  health_check_path: z.string().optional(),
  auto_deploy: z.boolean().optional(),
  env_vars: z.record(z.string()).optional(),
});

export const deployContainerSchema = z.object({
  triggered_by: z.enum(['manual', 'config_change']).default('manual'),
});

export type CreateContainerRequest = z.input<typeof createContainerSchema>;
export type UpdateContainerRequest = z.infer<typeof updateContainerSchema>;
export type DeployContainerRequest = z.infer<typeof deployContainerSchema>;
