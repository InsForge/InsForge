import { z } from 'zod';

export const serviceStatusEnum = z.enum([
  'creating',
  'deploying',
  'running',
  'stopped',
  'failed',
  'destroying',
]);

export const cpuTierEnum = z.enum([
  'shared-1x',
  'shared-2x',
  'performance-1x',
  'performance-2x',
  'performance-4x',
]);

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
