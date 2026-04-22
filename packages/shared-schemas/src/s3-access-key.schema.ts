import { z } from 'zod';

export const s3AccessKeySchema = z.object({
  id: z.string().uuid(),
  accessKeyId: z.string().regex(/^INSF[A-Z0-9]{16}$/, 'Invalid access key id format'),
  description: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

export const s3AccessKeyWithSecretSchema = s3AccessKeySchema.extend({
  secretAccessKey: z.string().length(40, 'Secret must be 40 characters'),
});

export const createS3AccessKeyRequestSchema = z.object({
  description: z.string().max(200).optional(),
});

export type S3AccessKeySchema = z.infer<typeof s3AccessKeySchema>;
export type S3AccessKeyWithSecretSchema = z.infer<typeof s3AccessKeyWithSecretSchema>;
export type CreateS3AccessKeyRequest = z.infer<typeof createS3AccessKeyRequestSchema>;
