-- Let compute.services be backed by more than one driver.
--
-- Until now the only option was Fly (directly, or cloud-proxied Fly), and the
-- table said so: the identifier columns were named after Fly's concepts, and
-- nothing recorded which driver owned a row. Adding a Docker driver that runs
-- containers on the operator's own host needs three changes:
--
--   1. fly_app_id     -> provider_app_id
--   2. fly_machine_id -> provider_instance_id
--   3. new `provider` and `ingress` columns
--
-- `provider` is the load-bearing one. Drivers coexist — a service is managed by
-- whichever driver created it — so without this column an operator who enables
-- Docker leaves Fly-backed rows that the reconcile sweep would try to heal
-- against the wrong daemon: at best a confusing 404, at worst marking a live,
-- billing machine as stopped with nothing left to reconcile it.
--
-- `ingress` records how a service is reachable, per service rather than per
-- deployment. Most compute takes no inbound traffic at all (queue workers,
-- background processors, inference loops, scrapers — the cases the compute docs
-- lead with), while an API or websocket server on the same deployment does. One
-- deployment-wide switch forces both into the same shape, and the safe global
-- default leaves the second case unreachable.
--
-- The API keeps serving `flyAppId` / `flyMachineId` as read-only aliases for one
-- minor version so the CLI, dashboard, and MCP server can migrate without a
-- lockstep release. See compute-services.schema.ts.

-- Renames are guarded on the old column still existing rather than run bare, so
-- re-running against a partially-migrated database is a no-op instead of an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'compute' AND table_name = 'services' AND column_name = 'fly_app_id'
  ) THEN
    ALTER TABLE compute.services RENAME COLUMN fly_app_id TO provider_app_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'compute' AND table_name = 'services' AND column_name = 'fly_machine_id'
  ) THEN
    ALTER TABLE compute.services RENAME COLUMN fly_machine_id TO provider_instance_id;
  END IF;
END $$;

-- ── provider ────────────────────────────────────────────────────────────────
-- Backfill existing rows as 'fly': every row that exists before this migration
-- was created by the Fly or cloud-proxied Fly path, since that was the only
-- option. Cloud mode is Fly behind a control plane and shares the same app and
-- machine identifiers, so one value covers both.
--
-- Split from the column add for the same reason as `ingress` below: on a rerun
-- against an existing nullable column, `ADD COLUMN IF NOT EXISTS ... NOT NULL
-- DEFAULT` applies neither the backfill nor the constraint.
ALTER TABLE compute.services
  ADD COLUMN IF NOT EXISTS provider TEXT;

UPDATE compute.services SET provider = 'fly' WHERE provider IS NULL;

ALTER TABLE compute.services ALTER COLUMN provider SET NOT NULL;

-- No default: new rows must state their driver explicitly — a Docker row
-- silently defaulting to 'fly' is exactly the corruption the column exists to
-- prevent. Dropping it covers a rerun over an earlier revision of this file,
-- which created the column with `DEFAULT 'fly'`.
ALTER TABLE compute.services ALTER COLUMN provider DROP DEFAULT;

ALTER TABLE compute.services DROP CONSTRAINT IF EXISTS compute_services_provider_check;
ALTER TABLE compute.services
  ADD CONSTRAINT compute_services_provider_check CHECK (provider IN ('fly', 'docker'));

-- Reconcile scans by driver, so it should not sequential-scan the table.
CREATE INDEX IF NOT EXISTS idx_compute_services_provider ON compute.services(provider);

-- ── ingress ─────────────────────────────────────────────────────────────────
--   'none' — reachable only on the project's internal network. No host port is
--            published and no URL is advertised.
--   'port' — published on a host port.
--   'host' — reachable at a hostname, routed by the operator's gateway.
--
-- Existing rows are all Fly-backed, and Fly allocates public IPs and a `.fly.dev`
-- hostname when the app is created — so every one of them is already reachable at
-- a hostname. Backfilling them to 'host' records what is true rather than
-- imposing a new default on services that are already running.
--
-- Split from the column add for the same reason as migrations 047 and 058:
-- `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT` does not apply the constraints
-- when the column already exists, only when it creates it.
ALTER TABLE compute.services
  ADD COLUMN IF NOT EXISTS ingress TEXT;

UPDATE compute.services SET ingress = 'host' WHERE ingress IS NULL;

ALTER TABLE compute.services ALTER COLUMN ingress SET NOT NULL;

-- New rows state their own ingress. This default is only a safety net for a
-- caller that predates the column; the service layer resolves it from the
-- driver's capabilities, which is why it is not 'host' — a driver that can offer
-- a private-only container should not publish one by accident.
ALTER TABLE compute.services ALTER COLUMN ingress SET DEFAULT 'none';

ALTER TABLE compute.services DROP CONSTRAINT IF EXISTS compute_services_ingress_check;
ALTER TABLE compute.services
  ADD CONSTRAINT compute_services_ingress_check CHECK (ingress IN ('none', 'port', 'host'));
