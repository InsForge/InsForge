-- Compute schema: containers, deployments, routes, task_runs
CREATE SCHEMA IF NOT EXISTS compute;

-- ── Containers ──
CREATE TABLE compute.containers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT NOT NULL DEFAULT 'default',
  name                TEXT NOT NULL,
  run_mode            TEXT NOT NULL DEFAULT 'service' CHECK (run_mode IN ('service', 'task')),
  source_type         TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo         TEXT,
  github_branch       TEXT DEFAULT 'main',
  dockerfile_path     TEXT DEFAULT './Dockerfile',
  image_url           TEXT,
  cpu                 INT NOT NULL DEFAULT 256 CHECK (cpu IN (256, 512, 1024, 2048, 4096)),
  memory              INT NOT NULL DEFAULT 512,
  port                INT NOT NULL DEFAULT 8080 CHECK (port BETWEEN 1 AND 65535),
  health_check_path   TEXT DEFAULT '/health',
  auto_deploy         BOOLEAN DEFAULT true,
  env_vars_encrypted  TEXT,
  status              TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'deploying', 'running', 'ready', 'failed', 'stopped', 'teardown_failed')),
  task_definition_arn TEXT,
  endpoint_url        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);

CREATE INDEX idx_compute_containers_project ON compute.containers(project_id);
CREATE INDEX idx_compute_containers_status ON compute.containers(status);

-- ── Deployments (services only) ──
CREATE TABLE compute.deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'building', 'pushing', 'deploying', 'live', 'failed', 'rolled_back')),
  image_uri       TEXT,
  image_tag       TEXT,
  triggered_by    TEXT NOT NULL DEFAULT 'manual',
  is_active       BOOLEAN DEFAULT false,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compute_deployments_container ON compute.deployments(container_id);
CREATE INDEX idx_compute_deployments_active ON compute.deployments(container_id) WHERE is_active = true;
CREATE UNIQUE INDEX idx_compute_deployments_inflight
  ON compute.deployments (container_id)
  WHERE status IN ('pending', 'building', 'pushing', 'deploying');

-- ── Container Routes (services only) ──
CREATE TABLE compute.container_routes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id      UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  service_arn       TEXT,
  task_def_arn      TEXT,
  target_group_arn  TEXT,
  rule_arn          TEXT,
  endpoint_url      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (container_id)
);

-- ── Task Runs (tasks only) ──
CREATE TABLE compute.task_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  ecs_task_arn    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'stopped')),
  exit_code       INTEGER,
  triggered_by    TEXT NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual', 'api')),
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_runs_container ON compute.task_runs(container_id);
CREATE INDEX idx_task_runs_container_status ON compute.task_runs(container_id, status);

-- ── Triggers ──
CREATE TRIGGER update_compute_containers_updated_at
  BEFORE UPDATE ON compute.containers
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER update_compute_deployments_updated_at
  BEFORE UPDATE ON compute.deployments
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER update_compute_container_routes_updated_at
  BEFORE UPDATE ON compute.container_routes
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
