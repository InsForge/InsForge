-- Migration 066: Server-side refresh sessions (fix for issue #2117).
--
-- Refresh tokens were previously stateless JWTs validated only by signature and
-- expiry, so a token stayed usable for its full 7-day lifetime even after it was
-- rotated, after logout, or after a password reset.
--
-- This migration adds:
-- 1. auth.users.session_version - bumped on password reset so pre-reset refresh
--    tokens fail validation (global invalidation).
-- 2. auth.refresh_sessions - one row per issued refresh token so rotation can
--    consume the presented token exactly once, logout can revoke a single
--    session, and concurrent reuse of the same token cannot succeed twice.
--
-- Token storage note: only SHA-256 hashes of issued refresh tokens are stored
-- (token_hash). Raw tokens are never persisted and a row alone cannot be
-- exchanged for a session - presenting the signed JWT is still required.
--
-- Deployment note: tokens issued before this migration carry no jti /
-- sessionVersion claims and have no server-side record, so the new validation
-- rejects them. Existing refresh sessions are invalidated on deploy; users and
-- dashboard admins must sign in again. Unexpired access tokens (15m) are
-- unaffected until they expire.

-- 1. Per-user session version for password-reset invalidation.
-- Safe default 0 matches the sessionVersion claim minted for pre-existing users.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

-- 2. Server-side refresh-token records.
CREATE TABLE IF NOT EXISTS auth.refresh_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SHA-256 hex of the raw refresh JWT. The raw token is never stored.
  token_hash TEXT UNIQUE NOT NULL,
  -- Groups the rotation chain started by a single login. A fresh login starts a
  -- new family; each refresh inserts a successor row in the same family.
  family_id UUID NOT NULL,
  -- auth.users.id for user sessions; namespaced subject (e.g. local:admin,
  -- cloud:<userId>) for admin sessions, which have no auth.users row.
  -- TEXT (not a foreign key) so admin sessions can be tracked too.
  user_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('user', 'admin')),
  -- Matches the csrfNonce claim so CSRF stays stable across rotation.
  csrf_nonce TEXT NOT NULL,
  -- Copy of auth.users.session_version at mint time (0 for admin sessions).
  session_version INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set when the token is exchanged for its successor (single-use rotation).
  consumed_at TIMESTAMPTZ,
  -- Set on logout (or administrative revocation). Either timestamp being set
  -- makes the token unusable.
  revoked_at TIMESTAMPTZ,
  -- token_hash of the successor for audit / replay tracing.
  replaced_by_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_token_hash
  ON auth.refresh_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_family
  ON auth.refresh_sessions (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user
  ON auth.refresh_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_expires_at
  ON auth.refresh_sessions (expires_at);

-- Keep updated_at maintained like the other feature tables (convention since
-- migration 018 is system.update_updated_at(); the pre-018
-- public.update_updated_at_column() no longer exists).
DROP TRIGGER IF EXISTS update_refresh_sessions_updated_at ON auth.refresh_sessions;
CREATE TRIGGER update_refresh_sessions_updated_at
  BEFORE UPDATE ON auth.refresh_sessions
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- 3. Cleanup helper for expired records.
-- Removes rows that can no longer authorize anything: expired tokens whose
-- grace window for replay detection has also passed. Active, consumed-but-
-- unexpired (replay detection), and revoked-but-unexpired rows are kept.
-- Operators may call this directly or schedule it (e.g. via pg_cron where
-- available); it is intentionally not scheduled here.
CREATE OR REPLACE FUNCTION auth.cleanup_expired_refresh_sessions()
RETURNS INT AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM auth.refresh_sessions
  WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;
