-- Compute Services: deploy Docker containers, get URLs (Fly.io)
CREATE SCHEMA IF NOT EXISTS compute;

CREATE TABLE compute.services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT NOT NULL,
  name                TEXT NOT NULL,
  image_url           TEXT NOT NULL,
  port                INT NOT NULL DEFAULT 8080 CHECK (port BETWEEN 1 AND 65535),
  cpu                 TEXT NOT NULL DEFAULT 'shared-1x',
  memory              INT NOT NULL DEFAULT 512,
  env_vars_encrypted  TEXT,
  region              TEXT NOT NULL DEFAULT 'iad',

  fly_app_id          TEXT,
  fly_machine_id      TEXT,

  status              TEXT NOT NULL DEFAULT 'creating'
                      CHECK (status IN ('creating', 'deploying', 'running', 'stopped', 'failed', 'destroying')),
  endpoint_url        TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (project_id, name)
);

CREATE INDEX idx_compute_services_project ON compute.services(project_id);
CREATE INDEX idx_compute_services_status ON compute.services(status);

CREATE TRIGGER update_compute_services_updated_at
  BEFORE UPDATE ON compute.services
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
