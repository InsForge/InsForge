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

-- 2. Widen the column. UUIDs are valid text so existing rows convert
-- losslessly and the btree index survives. Guarded by a column-type
-- check: once the owner-only policies below reference uploaded_by,
-- Postgres rejects ALTER TYPE — skip it on replay if already TEXT.
DO $widen$
BEGIN
  IF (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'objects'
      AND column_name = 'uploaded_by'
  ) <> 'text' THEN
    ALTER TABLE storage.objects ALTER COLUMN uploaded_by TYPE TEXT;
  END IF;
END
$widen$;

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
-- `->> 'org_id'` or any custom claim. Reads `request.jwt.claims`
-- (jsonb) which is set by withUserContext on the app server and by
-- PostgREST on its connections.
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- 5. Enable RLS. Install owner-only defaults only on existing projects.
--
-- Fresh installs ship deny-by-default (zero policies) — same shape
-- Supabase ships, projects opt in to end-user access by writing
-- policies suited to the bucket: owner-only, path-scoped, public-read,
-- team-shared, etc.
--
-- Existing projects (any rows in storage.buckets at migration time) get
-- the owner-only set installed automatically so the upgrade does not
-- silently break end-user uploads/reads. Projects can drop those
-- policies later when they want different semantics.
--
-- Admin connections (postgres / API key) bypass RLS regardless because
-- they connect with elevated privileges — dashboard and server-side
-- code keep working out of the box.
--
-- The `(SELECT auth.jwt() ->> 'sub')` form hoists the call out of the
-- per-row evaluation so postgres caches it once per query.
--
-- Caveat for projects mixing the user API and the S3 protocol: rows
-- written by the S3 gateway have `uploaded_by = NULL` (the S3 caller
-- isn't a JWT user). Under the owner-only policies below, `NULL = '<sub>'`
-- is never true, so authenticated end-users will not see S3-uploaded
-- rows via the user API. Admin (API key / project_admin) bypasses RLS
-- and sees them. Projects that need both surfaces visible to end-users
-- should drop these defaults and write a custom SELECT policy that
-- handles `uploaded_by IS NULL` (e.g. `uploaded_by IS NULL OR
-- uploaded_by = auth.jwt() ->> 'sub'`).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Postgres has no `CREATE POLICY IF NOT EXISTS` (any version through 17),
-- so each CREATE is guarded by a pg_policy lookup. Same pattern as the
-- e2e test setup in tests/local/test-storage-rls.sh — keeps the migration
-- safe to re-run (migrate:redo, manual replay, recovery scenarios).
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets LIMIT 1) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'storage_objects_owner_select'
        AND polrelid = 'storage.objects'::regclass
    ) THEN
      EXECUTE $sql$
        CREATE POLICY storage_objects_owner_select ON storage.objects
          FOR SELECT TO authenticated
          USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
      $sql$;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'storage_objects_owner_insert'
        AND polrelid = 'storage.objects'::regclass
    ) THEN
      EXECUTE $sql$
        CREATE POLICY storage_objects_owner_insert ON storage.objects
          FOR INSERT TO authenticated
          WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
      $sql$;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'storage_objects_owner_update'
        AND polrelid = 'storage.objects'::regclass
    ) THEN
      EXECUTE $sql$
        CREATE POLICY storage_objects_owner_update ON storage.objects
          FOR UPDATE TO authenticated
          USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
          WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
      $sql$;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = 'storage_objects_owner_delete'
        AND polrelid = 'storage.objects'::regclass
    ) THEN
      EXECUTE $sql$
        CREATE POLICY storage_objects_owner_delete ON storage.objects
          FOR DELETE TO authenticated
          USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
      $sql$;
    END IF;
  END IF;
END
$migration$;

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, anon;
