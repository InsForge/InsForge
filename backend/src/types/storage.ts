// Storage-related type definitions
import { StorageFileSchema, StorageBucketSchema } from '@insforge/shared-schemas';

// Base storage record from database
export type StorageRecord = Omit<StorageFileSchema, 'url'>;

// Bucket record from _storage_buckets table
export type BucketRecord = Omit<StorageBucketSchema, 'created_at'>;

// Storage configuration
export interface StorageConfig {
  buckets: StorageBucketSchema[];
}

// Form field types for file uploads
export type FormFieldValue = string | string[] | undefined;

// Processed form data from multipart requests
export interface ProcessedFormData {
  fields: Record<string, FormFieldValue>;
  files: Record<string, Express.Multer.File[]>;
}
