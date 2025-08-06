import { z } from 'zod';

export const storageFileSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  size: z.number(),
  mimeType: z.string().optional(),
  uploadedAt: z.string(),
  url: z.string(),
});

export const storageBucketSchema = z.object({
  name: z.string(),
  public: z.boolean(),
  createdAt: z.string(),
});

export type StorageFileSchema = z.infer<typeof storageFileSchema>;
export type StorageBucketSchema = z.infer<typeof storageBucketSchema>;
