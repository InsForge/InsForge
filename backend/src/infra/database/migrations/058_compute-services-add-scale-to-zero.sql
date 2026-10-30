-- Add `scale_to_zero` column to compute.services.
--
-- true (default) is the existing behaviour — machines are launched with
-- Fly autostop 'stop' + min_machines_running 0, so Fly's edge proxy stops
-- them when idle and cold-starts them on the next request. false keeps the
-- machine running 24/7 (autostop 'off' + min_machines_running 1) for
-- services that can't tolerate cold-start latency.
--
-- Idempotent four-step pattern (same as 047_compute-services-add-protocol):
-- `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT true` does not apply the
-- constraints when the column already exists — only when it creates it —
-- so we split.

ALTER TABLE compute.services
  ADD COLUMN IF NOT EXISTS scale_to_zero BOOLEAN;

-- Backfill any rows where scale_to_zero is NULL (only possible if the
-- column pre-existed without our DEFAULT). The NOT NULL constraint at the
-- end would otherwise fail.
UPDATE compute.services SET scale_to_zero = true WHERE scale_to_zero IS NULL;

ALTER TABLE compute.services
  ALTER COLUMN scale_to_zero SET DEFAULT true;

ALTER TABLE compute.services
  ALTER COLUMN scale_to_zero SET NOT NULL;
