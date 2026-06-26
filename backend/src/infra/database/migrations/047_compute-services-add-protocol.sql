-- INS-271: add `protocol` column to compute.services.
--
-- 'http' (default) is the existing behaviour — Fly terminates TLS at its
-- anycast edge and proxies HTTP/1.1+H2 to the container. 'tcp' is for raw
-- TCP services (Redis, Postgres-wire-protocol, custom binary protocols) —
-- the container's port is exposed directly with empty L7 handlers so bytes
-- flow end-to-end without HTTP inspection.
--
-- Idempotent four-step pattern so re-running the migration on a database
-- that already has the column (from a partial prior run or a hot-fix) still
-- ends with the column NOT NULL + DEFAULT 'http' applied. `ADD COLUMN IF NOT
-- EXISTS protocol TEXT NOT NULL DEFAULT 'http'` does not apply the constraints
-- when the column already exists — only when it creates it — so we split.

ALTER TABLE compute.services
  ADD COLUMN IF NOT EXISTS protocol TEXT;

-- Backfill any rows where protocol is NULL (only possible if the column
-- pre-existed without our DEFAULT). The NOT NULL constraint at the end
-- would otherwise fail.
UPDATE compute.services SET protocol = 'http' WHERE protocol IS NULL;

ALTER TABLE compute.services
  ALTER COLUMN protocol SET DEFAULT 'http';

ALTER TABLE compute.services
  ALTER COLUMN protocol SET NOT NULL;

-- CHECK constraint isolated from the ADD so re-running the migration on a
-- DB that already has the column (but not the constraint) still applies it.
-- The IF NOT EXISTS form for constraints arrived in PG 18; this DO block
-- is the portable equivalent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_compute_services_protocol'
      AND conrelid = 'compute.services'::regclass
  ) THEN
    ALTER TABLE compute.services
      ADD CONSTRAINT chk_compute_services_protocol
        CHECK (protocol IN ('http', 'tcp'));
  END IF;
END$$;
