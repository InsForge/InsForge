// Storage-related type definitions
import { StorageBucketSchema } from '@insforge/shared-schemas';

// Base storage record from database
export interface StorageRecord {
  key: string;
  bucket: string;
  size: number;
  mime_type?: string;
  uploaded_at: string;
}

// Bucket record from storage.buckets table
export type BucketRecord = Omit<StorageBucketSchema, 'created_at'>;

// Form field types for file uploads
export type FormFieldValue = string | string[] | undefined;

// Processed form data from multipart requests
export interface ProcessedFormData {
  fields: Record<string, FormFieldValue>;
  files: Record<string, Express.Multer.File[]>;
}
