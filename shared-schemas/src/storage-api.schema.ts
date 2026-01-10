import { z } from 'zod';
import { storageFileSchema } from './storage.schema';

export const createBucketRequestSchema = z.object({
  bucketName: z.string().min(1, 'Bucket name cannot be empty'),
  isPublic: z.boolean().default(true),
  maxFileSize: z.number().positive().nullable().optional(), // Maximum file size in bytes, null/undefined means use global limit
});

export const updateBucketRequestSchema = z.object({
  isPublic: z.boolean().optional(),
  maxFileSize: z.number().positive().nullable().optional(), // Maximum file size in bytes, null means use global limit
});

export const listObjectsResponseSchema = z.object({
  objects: z.array(storageFileSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
});

// Upload strategy schemas
export const uploadStrategyRequestSchema = z.object({
  filename: z.string().min(1, 'Filename cannot be empty'),
  contentType: z.string().optional(),
  size: z.number().optional(),
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
export const downloadStrategyRequestSchema = z.object({
  expiresIn: z.number().optional().default(3600),
});

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

export type CreateBucketRequest = z.infer<typeof createBucketRequestSchema>;
export type UpdateBucketRequest = z.infer<typeof updateBucketRequestSchema>;
export type ListObjectsResponseSchema = z.infer<typeof listObjectsResponseSchema>;
export type UploadStrategyRequest = z.infer<typeof uploadStrategyRequestSchema>;
export type UploadStrategyResponse = z.infer<typeof uploadStrategyResponseSchema>;
export type DownloadStrategyRequest = z.infer<typeof downloadStrategyRequestSchema>;
export type DownloadStrategyResponse = z.infer<typeof downloadStrategyResponseSchema>;
export type ConfirmUploadRequest = z.infer<typeof confirmUploadRequestSchema>;
