-- Migration: 028 - Create external JWT providers table
-- Stores configuration for third-party JWT issuers (e.g., Clerk, Auth0, Firebase Auth)
-- whose tokens InsForge should accept for database access and RLS

CREATE TABLE IF NOT EXISTS auth._jwt_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable name for the provider (e.g., "Clerk Production")
  name TEXT NOT NULL,
  -- A unique slug used in API paths and logs (e.g., "clerk", "auth0")
  provider_key TEXT NOT NULL UNIQUE,
  -- Expected `iss` claim value in incoming JWTs
  issuer TEXT NOT NULL,
  -- Expected `aud` claim value (nullable if the provider doesn't set audience)
  audience TEXT,
  -- JWKS endpoint URL for signature verification
  jwks_url TEXT NOT NULL,
  -- Mapping from external JWT claim paths to InsForge user shape
  -- Default maps standard OIDC claims: { "sub": "sub", "email": "email" }
  claim_mappings JSONB NOT NULL DEFAULT '{"sub": "sub", "email": "email"}',
  -- Role to assign to externally authenticated users
  -- Must be one of: 'anon', 'authenticated', 'project_admin'
  default_role TEXT NOT NULL DEFAULT 'authenticated'
    CHECK (default_role IN ('anon', 'authenticated', 'project_admin')),
  -- Expected format of the provider's subject (sub) claim.
  -- 'text' (default): arbitrary string IDs (e.g., Clerk "user_2x...", Auth0 "auth0|abc").
  --   Use uid_text() in RLS policies and TEXT columns for user-linked fields.
  -- 'uuid': provider guarantees sub is a valid UUID.
  --   Use uid() in RLS policies and UUID columns for user-linked fields.
  subject_type TEXT NOT NULL DEFAULT 'text'
    CHECK (subject_type IN ('text', 'uuid')),
  -- Whether this provider is actively accepting tokens
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups by issuer during token verification
CREATE INDEX IF NOT EXISTS idx_jwt_providers_issuer ON auth._jwt_providers (issuer);
