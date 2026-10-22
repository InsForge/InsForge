-- Migration: 066 - Give storage.objects owner policies and RLS on every project
--
-- 036 enabled RLS on storage.objects but created the owner policies only when
-- a bucket already existed, and 047 disabled RLS when there were no policies
-- and no buckets, so a fresh install stayed usable. Nothing added the defaults
-- once the first bucket was created, so projects that migrated before having a
-- bucket never got them.
--
-- When storage.objects has no policies at all, create the owner defaults and
-- enable RLS. Writes are owner-only, as in 036. Reads also allow objects in a
-- public bucket, so end-user listing of public buckets keeps working. Projects
-- that already have any policy on storage.objects are left exactly as they are,
-- and do not get the helper function below either.
--
-- The public-bucket check goes through storage.public_buckets(), a SECURITY
-- DEFINER helper, so authenticated does not need a grant on storage.buckets.
-- It returns the whole set once per query (an InitPlan) rather than being
-- called for every row, which keeps large public-bucket listings cheap.
--
-- As with the 036 defaults, rows written through the S3 protocol have
-- uploaded_by = NULL and match no owner check: end users cannot see them in a
-- private bucket, and cannot replace, update or delete them in any bucket
-- (they can still see them in a public bucket). API-key / project_admin
-- callers bypass RLS and are unaffected. Projects that mix the user API and
-- the S3 protocol on the same keys need a custom policy for those rows.

DO $migration$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass) THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION storage.public_buckets()
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
    SELECT COALESCE(array_agg(b.name), '{}'::text[]) FROM storage.buckets b WHERE b.public
  $fn$;

  REVOKE ALL ON FUNCTION storage.public_buckets() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION storage.public_buckets() TO authenticated;

  CREATE POLICY storage_objects_owner_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      uploaded_by = (SELECT auth.jwt() ->> 'sub')
      OR (SELECT storage.public_buckets()) @> ARRAY[bucket]
    );
  CREATE POLICY storage_objects_owner_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
  CREATE POLICY storage_objects_owner_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
    WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
  CREATE POLICY storage_objects_owner_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));

  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
END
$migration$;
