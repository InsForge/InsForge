-- Migration: 058 - Grant the anonymous runtime role access to storage.objects
--
-- Storage access control lives in RLS on storage.objects (migration 036), and
-- the runtime enforces it by running each end-user request under the matching
-- database role (`SET LOCAL ROLE anon | authenticated` in withUserContext).
--
-- The `authenticated` role has held USAGE on the storage schema plus DML on
-- storage.objects since migration 036, so projects can already write RLS
-- policies that let authenticated end-users reach storage. The `anon` role
-- never kept the same treatment: migration 044 briefly granted it, migration
-- 047 revoked it, and since then any anon request that reaches storage.objects
-- fails with `permission denied for schema storage` BEFORE RLS is evaluated.
-- Postgres checks table/schema privileges first and RLS only narrows what a
-- privileged role may see -- it never grants access -- so an anon policy
-- (`CREATE POLICY ... TO anon`) is dead code today: anon cannot reach the table
-- for the policy to run.
--
-- This migration makes anon symmetric with authenticated so RLS is the single
-- control surface for both roles. It grants schema/table privileges ONLY; it
-- creates no policy and does not change RLS enablement. Row access stays exactly
-- as the project's RLS posture dictates:
--   * RLS enabled, no anon policy -> anon denied. Projects opt in by writing a
--     policy suited to the bucket (public-read, path-scoped, etc.).
--   * RLS disabled -> anon has the same open access `authenticated` already has.
--     This matches the intentional "usable by default" posture from migration
--     047 and the Supabase model, where disabling RLS opens a table to the
--     anon key. Locking it down is done by enabling RLS and writing policies.
--
-- Buckets stay API-managed: anon receives no privileges on storage.buckets,
-- exactly like authenticated. Public-bucket downloads continue to be served
-- through the backend API via runWithRootAccess and do not depend on these
-- grants. auth.jwt() EXECUTE was already granted to anon in migration 036, so
-- anon RLS policies can read JWT claims once this schema USAGE lands.
--
-- Safety / idempotency:
--   * Guarded on the anon role and storage schema existing, so the migration is
--     a no-op (never errors) on databases where they are absent.
--   * GRANT is inherently idempotent, so re-running (migrate:redo) is safe.
--   * Forward-only: there is no down migration -- these grants are the intended
--     steady state and reverting them would restore the anon dead-policy gap.
--     This matches the repository convention (most migrations have no down).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND to_regnamespace('storage') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA storage TO anon;

    IF to_regclass('storage.objects') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;
    END IF;
  END IF;
END $$;
