// Storage-related type definitions

// Base storage record from database
export interface StorageRecord {
  bucket: string;
  key: string;
  size: number;
  mime_type: string | null;
  uploaded_at: string;
}

// Storage record with computed URL field
export interface StoredFile extends StorageRecord {
  url: string;
}

// Bucket record from _storage_buckets table
export interface BucketRecord {
  name: string;
  public: boolean;
}

// Bucket info returned by API (includes created_at)
export interface BucketInfo {
  name: string;
  public: boolean;
  created_at: string;
}

// Storage configuration
export interface StorageConfig {
  buckets: Array<{
    name: string;
    public: boolean;
    created_at?: string;
  }>;
}

// Form field types for file uploads
export type FormFieldValue = string | string[] | undefined;

// Processed form data from multipart requests
export interface ProcessedFormData {
  fields: Record<string, FormFieldValue>;
  files: Record<string, Express.Multer.File[]>;
}
