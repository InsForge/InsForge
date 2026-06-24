-- Migration: 052 - Add S3 CORS, tagging, and versioning support
-- Stores CORS rules and versioning status per bucket, and key-value tags
-- per object, enabling browser SDK uploads, Terraform, and AWS CLI workflows.

ALTER TABLE storage.buckets
  ADD COLUMN IF NOT EXISTS cors_rules         JSONB,
  ADD COLUMN IF NOT EXISTS versioning_status  TEXT NOT NULL DEFAULT 'Disabled'
    CHECK (versioning_status IN ('Enabled', 'Disabled', 'Suspended'));

CREATE TABLE IF NOT EXISTS storage.object_tags (
  bucket    TEXT NOT NULL,
  key       TEXT NOT NULL,
  tag_key   TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  PRIMARY KEY (bucket, key, tag_key),
  FOREIGN KEY (bucket, key) REFERENCES storage.objects(bucket, key) ON DELETE CASCADE
);
