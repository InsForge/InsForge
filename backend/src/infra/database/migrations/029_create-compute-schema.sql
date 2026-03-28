-- Create compute schema for container deployment management
CREATE SCHEMA IF NOT EXISTS compute;

-- Containers table: stores container configurations
CREATE TABLE IF NOT EXISTS compute.containers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            TEXT NOT NULL DEFAULT 'default',
  name                  TEXT NOT NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo           TEXT,
  github_branch         TEXT DEFAULT 'main',
  dockerfile_path       TEXT DEFAULT './Dockerfile',
  image_url             TEXT,
  cpu                   INT NOT NULL DEFAULT 256,
  memory                INT NOT NULL DEFAULT 512,
  port                  INT NOT NULL DEFAULT 8080,
  health_check_path     TEXT NOT NULL DEFAULT '/health',
  auto_deploy           BOOLEAN NOT NULL DEFAULT true,
  env_vars_encrypted    TEXT,
  status                TEXT NOT NULL DEFAULT 'created',
  endpoint_url          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compute_containers_project ON compute.containers (project_id);
CREATE INDEX IF NOT EXISTS idx_compute_containers_status ON compute.containers (status);

-- Deployments table: tracks each deployment attempt
CREATE TABLE IF NOT EXISTS compute.deployments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id          UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending',
  image_uri             TEXT,
  image_tag             TEXT,
  triggered_by          TEXT NOT NULL DEFAULT 'manual',
  is_active             BOOLEAN NOT NULL DEFAULT false,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compute_deployments_container ON compute.deployments (container_id);
CREATE INDEX IF NOT EXISTS idx_compute_deployments_active ON compute.deployments (container_id) WHERE is_active = true;

-- Partial unique index: only one in-flight deployment per container at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_compute_deployments_inflight
  ON compute.deployments (container_id)
  WHERE status IN ('pending', 'building', 'pushing', 'deploying');

-- Container routes table: stores AWS infrastructure references
CREATE TABLE IF NOT EXISTS compute.container_routes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id          UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  service_arn           TEXT,
  task_def_arn          TEXT,
  target_group_arn      TEXT,
  rule_arn              TEXT,
  endpoint_url          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (container_id)
);

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER update_compute_containers_updated_at
  BEFORE UPDATE ON compute.containers
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER update_compute_deployments_updated_at
  BEFORE UPDATE ON compute.deployments
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER update_compute_container_routes_updated_at
  BEFORE UPDATE ON compute.container_routes
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
