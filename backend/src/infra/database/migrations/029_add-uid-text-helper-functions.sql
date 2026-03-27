-- Migration: 029 - Add uid_text() helper functions for external JWT providers
-- External identity providers (Clerk, Auth0, etc.) may use non-UUID subject IDs
-- (e.g., "user_2xPnG8K..."). The existing uid() returns uuid and will fail for these.
-- uid_text() returns the raw sub claim as text, safe for any ID format.

-- public schema
CREATE OR REPLACE FUNCTION public.uid_text()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
  nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::text
$$;

-- auth schema
CREATE OR REPLACE FUNCTION auth.uid_text()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
  nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::text
$$;
