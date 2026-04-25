-- Migration: 034 - Extend storage.objects for S3 protocol support
-- Adds columns that distinguish S3-protocol uploads from REST/Dashboard
-- uploads and caches the object's ETag so HeadObject does not need to
-- fall back to live S3.

ALTER TABLE storage.objects
  ADD COLUMN IF NOT EXISTS uploaded_via TEXT NOT NULL DEFAULT 'rest'
    CHECK (uploaded_via IN ('rest', 's3', 'dashboard')),
  ADD COLUMN IF NOT EXISTS s3_access_key_id TEXT,
  ADD COLUMN IF NOT EXISTS etag TEXT;

-- Index to accelerate per-credential audit queries and LIST filters.
CREATE INDEX IF NOT EXISTS idx_storage_objects_s3_access_key_id
  ON storage.objects (s3_access_key_id)
  WHERE s3_access_key_id IS NOT NULL;
