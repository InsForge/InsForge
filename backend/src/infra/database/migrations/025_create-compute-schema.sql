-- 025_create-compute-schema.sql
-- Create compute schema and tables for custom container deployment

CREATE SCHEMA IF NOT EXISTS compute;

-- Container definitions
CREATE TABLE IF NOT EXISTS compute.containers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL,
  name                  TEXT NOT NULL DEFAULT 'default',

  -- Source
  source_type           TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo           TEXT,
  github_branch         TEXT,
  image_url             TEXT,
  dockerfile_path       TEXT DEFAULT './Dockerfile',

  -- Runtime config
  cpu                   INTEGER NOT NULL DEFAULT 256,
  memory                INTEGER NOT NULL DEFAULT 512,
  port                  INTEGER NOT NULL DEFAULT 8080,
  health_check_path     TEXT DEFAULT '/health',
  env_vars_encrypted    TEXT,

  -- State
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'building', 'deploying',
                               'running', 'stopped', 'failed')),
  endpoint_url          TEXT,

  -- AWS references
  ecs_service_arn       TEXT,
  ecs_task_def_arn      TEXT,
  target_group_arn      TEXT,
  alb_rule_arn          TEXT,

  -- Scaling (future)
  replicas              INTEGER DEFAULT 1,

  -- Auto-deploy
  auto_deploy           BOOLEAN DEFAULT true,
  github_webhook_id     TEXT,
  github_webhook_secret TEXT, -- TODO(production): encrypt at rest; stored as plaintext for POC only

  -- Custom domains (future)
  custom_domain         TEXT,

  -- Region (future multi-region)
  region                TEXT DEFAULT 'us-east-1',

  -- Metadata
  last_deployed_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  -- Phase 1: one container per project
  CONSTRAINT unique_project_container UNIQUE (project_id)
);

-- Deployment history
CREATE TABLE IF NOT EXISTS compute.deployments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id      UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,

  commit_sha        TEXT,
  image_tag         TEXT,
  build_log_url     TEXT,

  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'building', 'pushing',
                           'deploying', 'live', 'failed')),
  error_message     TEXT,

  triggered_by      TEXT DEFAULT 'manual'
                    CHECK (triggered_by IN ('manual', 'git_push',
                           'rollback', 'config_change', 'cron')),

  is_active         BOOLEAN DEFAULT false,

  started_at        TIMESTAMPTZ DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

-- Container routes (ALB routing info per container)
CREATE TABLE IF NOT EXISTS compute.container_routes (
  container_id      UUID PRIMARY KEY REFERENCES compute.containers(id) ON DELETE CASCADE,
  target_group_arn  TEXT,
  rule_arn          TEXT,
  service_arn       TEXT,
  task_def_arn      TEXT,
  endpoint_url      TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compute_containers_project
  ON compute.containers(project_id);

CREATE INDEX IF NOT EXISTS idx_compute_deployments_container
  ON compute.deployments(container_id);

CREATE INDEX IF NOT EXISTS idx_compute_deployments_active
  ON compute.deployments(container_id, is_active) WHERE is_active = true;

-- Updated_at trigger (uses function from 018_schema-rework.sql)
DROP TRIGGER IF EXISTS set_compute_containers_updated_at ON compute.containers;
CREATE TRIGGER set_compute_containers_updated_at
  BEFORE UPDATE ON compute.containers
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- Concurrent deploy guard: prevent multiple in-progress deployments for the same container
CREATE UNIQUE INDEX IF NOT EXISTS idx_compute_deployments_in_progress
  ON compute.deployments (container_id)
  WHERE status IN ('pending', 'building', 'pushing', 'deploying');
