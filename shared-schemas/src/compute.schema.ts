import { z } from 'zod';

export const containerSourceType = z.enum(['github', 'image']);

export const containerStatus = z.enum([
  'pending', 'building', 'deploying', 'running', 'stopped', 'failed',
]);

export const deploymentStatus = z.enum([
  'pending', 'building', 'pushing', 'deploying', 'live', 'failed',
]);

export const deploymentTrigger = z.enum([
  'manual', 'git_push', 'rollback', 'config_change', 'cron',
]);

// Valid Fargate CPU/memory combinations
export const FARGATE_CPU_MEMORY_MAP: Record<number, number[]> = {
  256: [512, 1024, 2048],
  512: [1024, 2048, 3072, 4096],
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
};

export const containerSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  source_type: containerSourceType,
  github_repo: z.string().nullable(),
  github_branch: z.string().nullable(),
  image_url: z.string().nullable(),
  dockerfile_path: z.string().nullable(),
  cpu: z.number(),
  memory: z.number(),
  port: z.number(),
  health_check_path: z.string().nullable(),
  status: containerStatus,
  endpoint_url: z.string().nullable(),
  auto_deploy: z.boolean(),
  replicas: z.number(),
  custom_domain: z.string().nullable(),
  region: z.string(),
  last_deployed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const containerDeploymentSchema = z.object({
  id: z.string().uuid(),
  container_id: z.string().uuid(),
  commit_sha: z.string().nullable(),
  image_tag: z.string().nullable(),
  build_log_url: z.string().nullable(),
  status: deploymentStatus,
  error_message: z.string().nullable(),
  triggered_by: deploymentTrigger,
  is_active: z.boolean(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type ContainerSchema = z.infer<typeof containerSchema>;
export type ContainerDeploymentSchema = z.infer<typeof containerDeploymentSchema>;
