-- Migration: 033 - Create S3 access keys table
-- Stores credential pairs used to authenticate clients speaking the S3
-- protocol. Secrets are encrypted reversibly (AES-256-GCM via
-- EncryptionManager); we need plaintext-recoverable form because SigV4
-- verification recomputes HMAC signatures from the raw secret.

CREATE TABLE IF NOT EXISTS storage.s3_access_keys (
  id                           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  access_key_id                TEXT        NOT NULL UNIQUE,
  secret_access_key_encrypted  TEXT        NOT NULL,
  description                  TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_s3_access_keys_last_used_at
  ON storage.s3_access_keys (last_used_at);
