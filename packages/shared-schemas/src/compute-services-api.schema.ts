import { z } from 'zod';
import { serviceSchema, cpuTierEnum } from './compute-services.schema.js';

const envVarKeyRegex = /^[A-Z_][A-Z0-9_]*$/;

export const createServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
      message:
        'Name must be DNS-safe: lowercase letters, numbers, and dashes only, must start with a letter or number',
    }),
  imageUrl: z.string().min(1),
  port: z.number().min(1).max(65535),
  cpu: cpuTierEnum.default('shared-1x'),
  memory: z.coerce
    .number()
    .refine((v) => [256, 512, 1024, 2048, 4096, 8192].includes(v), {
      message: 'Memory must be one of: 256, 512, 1024, 2048, 4096, 8192',
    })
    .default(512),
  envVars: z
    .record(
      z.string().regex(envVarKeyRegex, { message: 'Env var keys must match [A-Z_][A-Z0-9_]*' }),
      z.string().max(4096)
    )
    .optional(),
  region: z.string().default('iad'),
});

export const updateServiceSchema = z.object({
  imageUrl: z.string().min(1).optional(),
  port: z.number().min(1).max(65535).optional(),
  cpu: cpuTierEnum.optional(),
  memory: z.coerce
    .number()
    .refine((v) => [256, 512, 1024, 2048, 4096, 8192].includes(v), {
      message: 'Memory must be one of: 256, 512, 1024, 2048, 4096, 8192',
    })
    .optional(),
  envVars: z
    .record(
      z.string().regex(envVarKeyRegex, { message: 'Env var keys must match [A-Z_][A-Z0-9_]*' }),
      z.string().max(4096)
    )
    .optional(),
  region: z.string().optional(),
});

export const listServicesResponseSchema = z.object({
  services: z.array(serviceSchema),
});

export type CreateServiceRequest = z.infer<typeof createServiceSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;
