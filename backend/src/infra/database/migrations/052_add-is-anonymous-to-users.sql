-- 1) Add the column as nullable first
ALTER TABLE auth.users
  ADD COLUMN is_anonymous BOOLEAN;

-- 2) Set default for existing rows
UPDATE auth.users
SET    is_anonymous = FALSE
WHERE  is_anonymous IS NULL;

-- 3) Make it NOT NULL
ALTER TABLE auth.users
  ALTER COLUMN is_anonymous SET NOT NULL;
