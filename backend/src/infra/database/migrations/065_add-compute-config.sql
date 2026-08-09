-- Compute settings that an operator can change from the dashboard.
--
-- Settings, not credentials: the Fly API token lives in system.secrets (encrypted)
-- while these are plain operational values, so they follow the singleton-config-table
-- shape that database_config, storage_config and auth_config already use.
--
-- Every column is nullable and NULL means "not set here, fall back to the environment
-- variable". That keeps an existing deployment behaving exactly as before this
-- migration, and makes clearing a value in the dashboard distinguishable from never
-- having set one.
--
-- Deliberately absent: COMPUTE_BIND_ADDRESS. It decides whether a published container
-- port is reachable only on loopback or from the internet, so it stays behind the same
-- barrier as the socket mount itself — host access, not a dashboard session.
CREATE TABLE IF NOT EXISTS system.compute_config (
  -- Single row, enforced by the primary key. Same trick as the other config tables.
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  CONSTRAINT compute_config_single_row CHECK (id),

  -- Ingress for services that do not choose their own.
  default_ingress TEXT,
  CONSTRAINT compute_config_default_ingress_check
    CHECK (default_ingress IS NULL OR default_ingress IN ('none', 'port', 'host')),

  -- Host that `port`-ingress URLs are built from. Empty means advertise nothing
  -- rather than guess an address that may not resolve.
  public_host TEXT,

  -- Base domain for `host` ingress.
  domain TEXT,

  -- Socket the Docker driver dials — for rootless Docker or Podman. Changing it only
  -- helps if the socket is actually mounted there; the mount is a compose concern.
  socket_path TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system.compute_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
