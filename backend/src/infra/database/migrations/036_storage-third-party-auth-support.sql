-- Migration: 036 - Storage support for third-party auth via RLS
--
-- Two changes that together let any auth provider (native InsForge,
-- Better Auth, Clerk, Auth0, WorkOS, Stytch, Kinde) own storage objects
-- with per-project RLS policies.
--
-- Background
-- ----------
-- Native InsForge identity is a UUID, but every third-party auth provider
-- uses non-UUID `sub` claims. The current `storage.objects.uploaded_by uuid`
-- column rejects them at INSERT time with
--   `invalid input syntax for type uuid: "user_2nQk..."`,
-- and the FK to `auth.users(id)` cannot be honored since those users
-- do not exist in `auth.users`.
--
-- Until now the storage routes also forced ownership in the application
-- layer (`WHERE uploaded_by = $userId`), which made every storage bucket
-- behave as user-scoped — a project that wanted a public photo gallery
-- or a team-shared bucket had no way to express that.
--
-- This migration mirrors the realtime team's earlier fix for
-- `realtime.messages.sender_id` (uuid -> text, no FK) and Supabase's
-- `storage.objects.owner_id` shape, and moves access control into RLS
-- on `storage.objects` so projects can define their own policies.

-- 1. Drop the FK so non-native user IDs are accepted.
ALTER TABLE storage.objects
  DROP CONSTRAINT IF EXISTS objects_uploaded_by_fkey;

-- 2. Widen the column. UUIDs are valid text, so existing native-auth rows
-- convert losslessly and the btree index is preserved across the change.
ALTER TABLE storage.objects
  ALTER COLUMN uploaded_by TYPE TEXT;

-- 3. Path helpers — mirror Supabase's `storage.foldername`, `storage.filename`,
-- `storage.extension`. They let projects layer per-folder RLS on top of
-- column-based ownership using a vocabulary Supabase users already know.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (regexp_split_to_array(name, '/'))[
    1 : array_upper(regexp_split_to_array(name, '/'), 1) - 1
  ]
$$;

CREATE OR REPLACE FUNCTION storage.filename(name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (regexp_split_to_array(name, '/'))[
    array_upper(regexp_split_to_array(name, '/'), 1)
  ]
$$;

CREATE OR REPLACE FUNCTION storage.extension(name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (regexp_match(name, '\.([^./\\]+)$'))[1]
$$;

-- 4. Enable RLS and ship safe defaults.
--
-- Default policies are owner-only on every CRUD operation, matching the
-- behavior the application layer used to enforce. Projects override these
-- with `DROP POLICY` + `CREATE POLICY` to express anything else
-- (public read, team-shared, path-based, etc.) without touching the
-- storage service. Admin connections (postgres / API key) bypass RLS
-- because they connect with elevated privileges.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = current_setting('request.jwt.claim.sub', true));

CREATE POLICY storage_objects_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = current_setting('request.jwt.claim.sub', true));

CREATE POLICY storage_objects_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (uploaded_by = current_setting('request.jwt.claim.sub', true))
  WITH CHECK (uploaded_by = current_setting('request.jwt.claim.sub', true));

CREATE POLICY storage_objects_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (uploaded_by = current_setting('request.jwt.claim.sub', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
