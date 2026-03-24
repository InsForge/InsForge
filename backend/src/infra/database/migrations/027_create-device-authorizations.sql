-- Migration: 027 - Create device authorization sessions
--
-- Stores headless device login sessions for browser-confirmed authorization flows.
-- Device and user codes are stored as hashes only.

CREATE TABLE IF NOT EXISTS auth.device_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_authorization',
  expires_at TIMESTAMPTZ NOT NULL,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 5,
  approved_by_user_id UUID NULL,
  consumed_at TIMESTAMPTZ NULL,
  client_context JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_authorizations_status_check CHECK (
    status IN (
      'pending_authorization',
      'authenticated',
      'approved',
      'denied',
      'expired',
      'consumed'
    )
  ),
  CONSTRAINT device_authorizations_poll_interval_check CHECK (poll_interval_seconds > 0)
);

ALTER TABLE auth.device_authorizations
DROP CONSTRAINT IF EXISTS device_authorizations_approved_by_user_id_fkey;

ALTER TABLE auth.device_authorizations
ADD CONSTRAINT device_authorizations_approved_by_user_id_fkey
FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS device_authorizations_status_expires_at_idx
  ON auth.device_authorizations (status, expires_at);

CREATE INDEX IF NOT EXISTS device_authorizations_approved_by_user_id_idx
  ON auth.device_authorizations (approved_by_user_id);

DROP TRIGGER IF EXISTS update_device_authorizations_updated_at ON auth.device_authorizations;
CREATE TRIGGER update_device_authorizations_updated_at
  BEFORE UPDATE ON auth.device_authorizations
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
