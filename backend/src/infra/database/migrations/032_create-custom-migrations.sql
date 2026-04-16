CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.custom_migrations (
  sequence_number INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  statements TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
