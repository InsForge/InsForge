-- Migration: 019 - Add max_file_size column to storage.buckets table
-- This allows per-bucket file size limits to be configured

-- Add max_file_size column to storage.buckets table
ALTER TABLE storage.buckets 
ADD COLUMN IF NOT EXISTS max_file_size BIGINT DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN storage.buckets.max_file_size IS 
  'Maximum file size in bytes allowed for this bucket. NULL means use global MAX_FILE_SIZE from environment variable.';

