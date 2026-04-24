CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.custom_migrations (
  version TEXT PRIMARY KEY CHECK (version ~ '^[0-9]{14}$'),
  name TEXT NOT NULL,
  statements TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
