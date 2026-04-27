-- Migration: 036 - Allow third-party auth providers to write/read storage
--
-- The native InsForge identity is a UUID, but every third-party auth
-- integration we ship (Better Auth, Clerk, Auth0, WorkOS, Stytch, Kinde)
-- uses non-UUID `sub` claims. The current `storage.objects.uploaded_by uuid`
-- column rejects those IDs at INSERT time with
--   `invalid input syntax for type uuid: "user_2nQk..."`,
-- and the FK to `auth.users(id)` cannot be honored either since those
-- users do not exist in `auth.users`.
--
-- This mirrors the realtime team's earlier fix for `realtime.messages.sender_id`
-- (uuid -> text, no FK to auth.users) and Supabase's `storage.objects.owner_id`
-- shape. UUIDs are valid text, so existing native-auth rows convert losslessly
-- and existing app-side filters (`WHERE uploaded_by = $userId`) continue to work.
--
-- Helper functions match Supabase's path helpers so users can write per-folder
-- RLS policies with the same pattern they may already know.

-- 1. Drop the FK so non-native user IDs are accepted.
ALTER TABLE storage.objects
  DROP CONSTRAINT IF EXISTS objects_uploaded_by_fkey;

-- 2. Widen the column. The btree index is preserved across the type change.
ALTER TABLE storage.objects
  ALTER COLUMN uploaded_by TYPE TEXT;

-- 3. Path helpers — mirror Supabase's `storage.foldername`, `storage.filename`,
-- `storage.extension`. They let users layer per-folder RLS on top of column-
-- based ownership without inventing project-specific helpers.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT regexp_split_to_array(name, '/')[
    1 : array_upper(regexp_split_to_array(name, '/'), 1) - 1
  ]
$$;

CREATE OR REPLACE FUNCTION storage.filename(name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT regexp_split_to_array(name, '/')[
    array_upper(regexp_split_to_array(name, '/'), 1)
  ]
$$;

CREATE OR REPLACE FUNCTION storage.extension(name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (regexp_match(name, '\.([^./\\]+)$'))[1]
$$;
