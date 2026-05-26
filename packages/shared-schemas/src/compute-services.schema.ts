import { z } from 'zod';

export const serviceStatusEnum = z.enum([
  'creating',
  'deploying',
  'running',
  'stopped',
  'failed',
  'destroying',
]);

// CPU tier accepts Fly.io's standard `<kind>-<N>x` format (e.g. shared-1x,
// performance-8x). No hardcoded allow-list — Fly.io is the source of truth
// for which sizes exist, so adding `performance-32x` (if/when Fly offers it)
// needs zero schema changes here.
export const cpuTierRegex = /^(shared|performance)-[1-9]\d*x$/;
export const cpuTierEnum = z
  .string()
  .regex(
    cpuTierRegex,
    'cpu must match `<shared|performance>-<N>x`, e.g. shared-2x or performance-8x'
  );

export const serviceSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  imageUrl: z.string(),
  port: z.number(),
  cpu: cpuTierEnum,
  memory: z.number(),
  region: z.string(),
  flyAppId: z.string().nullable(),
  flyMachineId: z.string().nullable(),
  status: serviceStatusEnum,
  endpointUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ServiceSchema = z.infer<typeof serviceSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusEnum>;
export type CpuTier = z.infer<typeof cpuTierEnum>;
