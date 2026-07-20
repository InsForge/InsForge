import { z } from 'zod';
import { storageConfigSchema, storageFileSchema } from './storage.schema.js';

export const createBucketRequestSchema = z.object({
  bucketName: z.string().min(1, 'Bucket name cannot be empty'),
  isPublic: z.boolean().default(true),
});

export const updateBucketRequestSchema = z.object({
  isPublic: z.boolean(),
});

export const listObjectsResponseSchema = z.object({
  objects: z.array(storageFileSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
});

export const deleteObjectsRequestSchema = z.object({
  keys: z
    .array(z.string().min(1, 'Object key cannot be empty'))
    .min(1, 'At least one object key is required')
    .max(1000, 'Cannot delete more than 1000 objects at once'),
});

export const deleteObjectResultSchema = z.object({
  key: z.string(),
  status: z.enum(['deleted', 'notFound', 'failed']),
  message: z.string().optional(),
});

export const deleteObjectsResponseSchema = z.object({
  results: z.array(deleteObjectResultSchema),
});

// Upload strategy schemas
export const uploadStrategyRequestSchema = z.object({
  filename: z.string().min(1, 'Filename cannot be empty'),
  contentType: z.string().optional(),
  size: z.number().optional(),
  // Ask the server to mint a unique key from the filename instead of using
  // it verbatim (same semantics as the auto-key POST upload route).
  autoKey: z.boolean().optional(),
});

export const uploadStrategyResponseSchema = z.object({
  method: z.enum(['presigned', 'direct']),
  uploadUrl: z.string(),
  fields: z.record(z.string()).optional(),
  key: z.string(),
  confirmRequired: z.boolean(),
  confirmUrl: z.string().optional(),
  expiresAt: z.date().optional(),
});

// Download strategy schemas
// download-strategy is a GET endpoint with no request body; expiry is
// auto-calculated server-side from bucket visibility.
export const downloadStrategyResponseSchema = z.object({
  method: z.enum(['presigned', 'direct']),
  url: z.string(),
  expiresAt: z.date().optional(),
  headers: z.record(z.string()).optional(),
});

// Confirm upload schema
export const confirmUploadRequestSchema = z.object({
  size: z.number(),
  contentType: z.string().optional(),
  etag: z.string().optional(),
});

export const updateStorageConfigRequestSchema = z.object({
  maxFileSizeMb: z
    .number()
    .int()
    .min(1, 'Must be at least 1 MB')
    .max(200, 'Must be at most 200 MB'),
});

export const getStorageConfigResponseSchema = storageConfigSchema;

export type CreateBucketRequest = z.infer<typeof createBucketRequestSchema>;
export type UpdateBucketRequest = z.infer<typeof updateBucketRequestSchema>;
export type ListObjectsResponseSchema = z.infer<typeof listObjectsResponseSchema>;
export type DeleteObjectsRequest = z.infer<typeof deleteObjectsRequestSchema>;
export type DeleteObjectResult = z.infer<typeof deleteObjectResultSchema>;
export type DeleteObjectsResponse = z.infer<typeof deleteObjectsResponseSchema>;
export type UploadStrategyRequest = z.infer<typeof uploadStrategyRequestSchema>;
export type UploadStrategyResponse = z.infer<typeof uploadStrategyResponseSchema>;
export type DownloadStrategyResponse = z.infer<typeof downloadStrategyResponseSchema>;
export type ConfirmUploadRequest = z.infer<typeof confirmUploadRequestSchema>;
export type UpdateStorageConfigRequest = z.infer<typeof updateStorageConfigRequestSchema>;
export type GetStorageConfigResponse = z.infer<typeof getStorageConfigResponseSchema>;
