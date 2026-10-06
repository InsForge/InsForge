// Storage-related type definitions

// Base storage record from database
export interface StorageRecord {
  key: string;
  bucket: string;
  size: number;
  mime_type?: string;
  uploaded_at: string;
  etag?: string | null;
}
