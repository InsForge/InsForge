-- Migration: 044 - Standardize auth helpers on canonical JSON JWT claims
--
-- The backend runtime now writes one request identity setting:
--   request.jwt.claims = '{"role":"authenticated","sub":"...","email":"..."}'
--
-- Recreate auth helpers so RLS reads only this canonical PostgREST claim
-- setting. No dotted JWT-claim GUC fallback is kept.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'role', '')::text
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'email', '')::text
$$;
