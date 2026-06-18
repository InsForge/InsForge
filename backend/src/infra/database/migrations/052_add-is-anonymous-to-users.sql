-- 1) Add the column as nullable first (IF NOT EXISTS makes this idempotent)
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN;

-- 2) Set default for existing rows
UPDATE auth.users
SET    is_anonymous = FALSE
WHERE  is_anonymous IS NULL;

-- 3) Make it NOT NULL with a permanent default so future inserts that omit the
--    column don't fail
ALTER TABLE auth.users
  ALTER COLUMN is_anonymous SET DEFAULT FALSE,
  ALTER COLUMN is_anonymous SET NOT NULL;

-- 4) Allow email to be NULL so anonymous users can be inserted without an email
ALTER TABLE auth.users
  ALTER COLUMN email DROP NOT NULL;
