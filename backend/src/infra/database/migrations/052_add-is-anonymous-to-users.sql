-- 1) Add the column as nullable first (IF NOT EXISTS makes this idempotent)
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS isAnonymous BOOLEAN;

-- 2) Set default for existing rows
UPDATE auth.users
SET    isAnonymous = FALSE
WHERE  isAnonymous IS NULL;

-- 3) Make it NOT NULL with a permanent default so future inserts that omit the
--    column don't fail
ALTER TABLE auth.users
  ALTER COLUMN isAnonymous SET DEFAULT FALSE,
  ALTER COLUMN isAnonymous SET NOT NULL;

-- 4) Allow email to be NULL so anonymous users can be inserted without an email
ALTER TABLE auth.users
  ALTER COLUMN email DROP NOT NULL;
