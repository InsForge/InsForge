-- Migration: 066 - Give storage.objects owner policies and RLS on every project
--
-- 036 enabled RLS on storage.objects but created the owner policies only when
-- a bucket already existed. 047 then disabled RLS when there were no policies
-- and no buckets, so a fresh install stayed usable. Nothing turned either back
-- on when the first bucket was created later. Every project that ran its
-- migrations before it had a bucket therefore ended up with RLS off, no
-- policies, and the authenticated grants from 036: any signed-in end user
-- could insert, replace or delete any other user's object.
--
-- When storage.objects has no policies at all, create the owner defaults and
-- enable RLS. Writes stay owner-only, as in 036. Reads also allow objects in a
-- public bucket, so end-user listing of public buckets keeps working the way
-- it did while RLS was off. Projects that already have any policy on
-- storage.objects are left exactly as they are.

CREATE OR REPLACE FUNCTION storage.bucket_is_public(bucket_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE((SELECT b.public FROM storage.buckets b WHERE b.name = bucket_name), false)
$$;

REVOKE ALL ON FUNCTION storage.bucket_is_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.bucket_is_public(text) TO authenticated;

DO $migration$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass) THEN
    RETURN;
  END IF;

  CREATE POLICY storage_objects_owner_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      uploaded_by = (SELECT auth.jwt() ->> 'sub')
      OR storage.bucket_is_public(bucket)
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
