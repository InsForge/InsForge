import { z } from 'zod';
import { serviceSchema, cpuTierEnum } from './compute-services.schema.js';

const envVarKeyRegex = /^[A-Z_][A-Z0-9_]*$/;

export const createServiceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
        message:
          'Name must be DNS-safe: lowercase letters, numbers, and dashes only, must start with a letter or number',
      }),
    /**
     * Image-mode: pre-built image URL. Either `imageUrl` or
     * (`sourceKey` + `imageTag`) is required. Cannot provide both.
     */
    imageUrl: z.string().min(1).optional(),
    /**
     * Source-mode: S3 key where source.tgz was uploaded via the presigned
     * URL returned from POST /api/compute/services/:id/build-creds. Cloud
     * triggers a build before deploying.
     */
    sourceKey: z.string().min(1).optional(),
    /** ECR image tag the source-mode build will produce. Paired with sourceKey. */
    imageTag: z.string().min(1).optional(),
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
  })
  .refine((v) => Boolean(v.imageUrl) !== Boolean(v.sourceKey && v.imageTag), {
    message: 'Provide either imageUrl OR (sourceKey + imageTag), not both/neither',
  });

export const updateServiceSchema = z
  .object({
    /** Pre-built image URL. Mutually exclusive with sourceKey/imageTag. */
    imageUrl: z.string().min(1).optional(),
    /** S3 key from /build-creds. Triggers cloud-side build before update. */
    sourceKey: z.string().min(1).optional(),
    /** ECR tag the source-mode build will produce, paired with sourceKey. */
    imageTag: z.string().min(1).optional(),
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
  })
  .refine((v) => !(v.imageUrl && v.sourceKey), {
    message: 'Cannot provide both imageUrl and sourceKey',
  })
  .refine((v) => Boolean(v.sourceKey) === Boolean(v.imageTag), {
    message: 'sourceKey and imageTag must be provided together',
  });

export const listServicesResponseSchema = z.object({
  services: z.array(serviceSchema),
});

export type CreateServiceRequest = z.infer<typeof createServiceSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;
