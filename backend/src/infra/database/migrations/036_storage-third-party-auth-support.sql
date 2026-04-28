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
-- or a team-shared bucket had no way to express that. This migration
-- moves access control into RLS on `storage.objects` so projects can
-- define their own policies.

-- 1. Drop the FK so non-native user IDs are accepted.
ALTER TABLE storage.objects
  DROP CONSTRAINT IF EXISTS objects_uploaded_by_fkey;

-- 2. Widen the column. UUIDs are valid text, so existing native-auth rows
-- convert losslessly and the btree index is preserved across the change.
ALTER TABLE storage.objects
  ALTER COLUMN uploaded_by TYPE TEXT;

-- 3. Path helpers. Let projects layer per-folder RLS on top of
-- column-based ownership: storage.foldername('a/b/c.txt') = {a, b}.
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

-- 4. auth.jwt() helper.
--
-- The existing auth.uid() returns uuid, which works for native InsForge
-- callers but errors on non-UUID subs from third-party providers. Ship
-- a jsonb helper alongside so policies can extract any claim as text:
-- `auth.jwt() ->> 'sub'` for ownership, `->> 'role'` for role checks,
-- `->> 'org_id'` or any custom claim. Reads both the legacy per-claim
-- GUC and the modern claims-jsonb GUC so the helper works whether the
-- caller is the app server (set_config of the dotted form) or PostgREST
-- (sets the jsonb form).
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- 5. Enable RLS, deny by default.
--
-- No policies are created — the table is RLS-enabled with zero policies,
-- so every authenticated read/write is denied until a project defines its
-- own policies. Admin connections (postgres / API key) bypass RLS because
-- they connect with elevated privileges, so the dashboard and server-side
-- code keep working out of the box.
--
-- Projects opt in to end-user access by writing policies suited to the
-- bucket: owner-only, path-scoped, public-read, team-shared, etc. A
-- starter owner-only set looks like:
--
--   CREATE POLICY <name> ON storage.objects
--     FOR SELECT TO authenticated
--     USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
--
-- The `(SELECT auth.jwt() ->> 'sub')` form hoists the call out of the
-- per-row evaluation so postgres caches it once per query.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, anon;
