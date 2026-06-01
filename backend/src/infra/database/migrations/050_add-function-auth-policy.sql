-- Migration: 050 - Add auth policy to function definitions
-- This migration adds an 'auth' column to control invocation access per function
-- Values: 'admin' (admins only), 'user' (authenticated users), 'none' (public)

ALTER TABLE functions.definitions
ADD COLUMN IF NOT EXISTS auth VARCHAR(50) NOT NULL DEFAULT 'user'
CHECK (auth IN ('admin', 'user', 'none'));

-- Create index for potential filtering by auth policy
CREATE INDEX IF NOT EXISTS idx_functions_definitions_auth
ON functions.definitions (auth);

-- Add comment documenting the auth policy
COMMENT ON COLUMN functions.definitions.auth IS 
'Function invocation auth policy: "admin" requires project admin, "user" requires any authenticated user, "none" allows public access';
