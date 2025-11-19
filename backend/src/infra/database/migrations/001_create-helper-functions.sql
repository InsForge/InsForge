-- Migration: 001 - Create helper functions for RLS
-- These functions extract user information from JWT claims

-- Function to get current user ID from JWT
CREATE OR REPLACE FUNCTION public.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT
  nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- Function to get current user role from JWT
CREATE OR REPLACE FUNCTION public.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
  coalesce(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  )::text
$$;

-- Function to get current user email from JWT
CREATE OR REPLACE FUNCTION public.email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
  coalesce(
    current_setting('request.jwt.claim.email', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'email')
  )::text
$$;